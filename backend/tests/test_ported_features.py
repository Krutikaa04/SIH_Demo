"""Unit tests for the ported JANSETU features: Galaxy graph, per-pair review, tamper restore, briefings, entities."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["AICTE_DB"] = str(Path(_tmp) / "test_ported.db")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db, intel, seed, services, galaxy, briefings  # noqa: E402

def setUpModule():
    conn = db.connect()
    seed.seed(conn)
    conn.close()

class TestPortedFeatures(unittest.TestCase):
    def setUp(self):
        self.conn = db.connect()

    def tearDown(self):
        self.conn.close()

    def test_galaxy_graph_generation(self):
        g = galaxy.generate_galaxy_graph(self.conn)
        self.assertIn("nodes", g)
        self.assertIn("edges", g)
        self.assertGreater(len(g["nodes"]), 0)
        self.assertGreater(len(g["edges"]), 0)
        # Check node types
        types = {n["type"] for n in g["nodes"]}
        self.assertIn("institutionNode", types)
        self.assertIn("caseNode", types)
        self.assertIn("bureauNode", types)

    def test_executive_briefing_generation(self):
        b = briefings.generate_executive_briefing(self.conn)
        self.assertIn("sections", b)
        self.assertIn("citations", b)
        self.assertGreaterEqual(len(b["sections"]), 3)
        # Verify citations exist
        self.assertGreater(len(b["citations"]), 0)

    def test_entity_extraction(self):
        sample = "Student paid ₹45,000 for exam fee as per Circular No. AICTE/2026/04. Roll no: ENR-99214."
        entities = intel.extract_entities(sample)
        self.assertTrue(any("45,000" in a for a in entities["amounts"]))
        self.assertTrue(len(entities["circulars"]) > 0)
        self.assertTrue(len(entities["roll_numbers"]) > 0)

    def test_per_pair_review_and_audit_logging(self):
        pair = db.one(self.conn, "SELECT id, case_a, case_b FROM overlap_pairs LIMIT 1")
        self.assertIsNotNone(pair)
        pid = pair["id"]
        
        # Update with rationale
        rationale = "Verified common capitation fee demand across admissions cell."
        now_iso = db.iso(db.now(self.conn))
        self.conn.execute("UPDATE overlap_pairs SET status='CONFIRMED', review_rationale=?, review_by='Inspector Sharma', review_at=? WHERE id=?",
                          (rationale, now_iso, pid))
        db.append_action(self.conn, pair["case_a"], now_iso, "OFFICER-01", "Inspector Sharma", "AICTE",
                         "OVERLAP_CONFIRMED", None, None, f"Overlap reviewed: {rationale}")
        self.conn.commit()

        updated = db.one(self.conn, "SELECT * FROM overlap_pairs WHERE id=?", (pid,))
        self.assertEqual(updated["status"], "CONFIRMED")
        self.assertEqual(updated["review_rationale"], rationale)
        # Check audit trail verifies
        self.assertTrue(db.verify_chain(self.conn, pair["case_a"])["ok"])

    def test_tamper_and_restore(self):
        # 1. Start healthy
        self.assertTrue(db.verify_chain(self.conn)["ok"])
        row = self.conn.execute("SELECT id, case_id, seq, remarks FROM action_history GROUP BY case_id HAVING COUNT(*)>=3 LIMIT 1").fetchone()
        row_id, cid, seq, orig = row["id"], row["case_id"], row["seq"], row["remarks"]
        
        # 2. Tamper
        db.set_setting(self.conn, f"tamper_backup_{row_id}", orig)
        db.set_setting(self.conn, "tampered_row_id", str(row_id))
        self.conn.execute("UPDATE action_history SET remarks='Unauthorized modification' WHERE id=?", (row_id,))
        self.conn.commit()
        self.assertFalse(db.verify_chain(self.conn)["ok"])

        # 3. Restore
        backup = db.get_setting(self.conn, f"tamper_backup_{row_id}")
        self.conn.execute("UPDATE action_history SET remarks=? WHERE id=?", (backup, row_id))
        self.conn.commit()
        self.assertTrue(db.verify_chain(self.conn)["ok"])
