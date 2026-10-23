"""Regression tests for the demo: overlap engine (positives AND decoys), hash chain, SLA engine, NL parser, roles.

Run:  python -m pytest backend/tests -q      (or: python -m unittest discover backend/tests)
Uses a throw-away database, never data/demo.db.
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["AICTE_DB"] = str(Path(_tmp) / "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db, intel, nlsearch, risk, roles, seed, services, sla  # noqa: E402

HERO = "1-4520311"


def setUpModule():
    conn = db.connect()
    seed.seed(conn)
    conn.close()


class Base(unittest.TestCase):
    def setUp(self):
        self.conn = db.connect()

    def tearDown(self):
        self.conn.close()


class TestEntityResolution(Base):
    VARIANTS = ["Sahyadri Government College of Engineering, Pune", "Sahyadri Govt. College of Engg Pune",
                "SAHYADRI GOVT COLLEGE OF ENGG PUNE", "Sahyadri Govt College of Engineering Poona",
                "sahyadri government coll. of engg., pune", "Sahyadri Goverment College of Engineering Pune"]

    def test_hero_variants_all_resolve_to_same_master(self):
        reg = intel.Registry(self.conn)
        for v in self.VARIANTS:
            r = reg.resolve(v)
            self.assertIsNotNone(r, v)
            self.assertEqual(r["institution_id"], HERO, v)

    def test_aicte_id_wins(self):
        r = intel.Registry(self.conn).resolve("completely different name", HERO)
        self.assertEqual((r["institution_id"], r["method"]), (HERO, "ID"))

    def test_same_name_different_city_is_not_confused(self):
        reg = intel.Registry(self.conn)
        a = reg.resolve("Vidyasagar Inst of Tech Coimbatore")
        b = reg.resolve("Vidyasagar Inst of Technology Tirupati")
        self.assertIsNotNone(a)
        self.assertIsNotNone(b)
        self.assertNotEqual(a["institution_id"], b["institution_id"])

    def test_bangalore_alias(self):
        r = intel.Registry(self.conn).resolve("Kaveri Inst. of Tech Bangalore")
        self.assertEqual(r["method"], "NAME")
        self.assertIn("Bengaluru", db.one(self.conn, "SELECT name FROM institutions WHERE aicte_id=?", (r["institution_id"],))["name"])


class TestOverlapEngine(Base):
    def test_hero_cluster_is_high_and_spans_three_bureaus(self):
        cl = [c for c in services.clusters_view(self.conn) if c["institution"]["aicte_id"] == HERO]
        self.assertEqual(len(cl), 1)
        self.assertEqual(set(cl[0]["bureaus"]), {"RB", "PGRC", "AB"})
        self.assertEqual(cl[0]["band"], "HIGH")
        self.assertTrue(all(p["score"] >= 70 for p in cl[0]["pairs"]))

    def test_every_planted_cluster_is_high(self):
        clusters = services.clusters_view(self.conn)
        self.assertEqual(len(clusters), 11)
        self.assertTrue(all(c["band"] == "HIGH" for c in clusters))

    def test_breakdown_is_explainable(self):
        p = db.one(self.conn, "SELECT * FROM overlap_pairs WHERE institution_id=? ORDER BY score DESC", (HERO,))
        view = services.pair_view(p)
        self.assertEqual([s["signal"] for s in view["breakdown"]], ["identity", "name", "text", "category", "time"])
        self.assertAlmostEqual(sum(s["points"] for s in view["breakdown"]), p["score"], delta=1)
        self.assertIn("Potential Overlapping Cases", view["headline"])

    def test_decoys_are_not_linked(self):
        for city, idx in (("Coimbatore", 1), ("Tirupati", 1), ("Mangaluru", 0), ("Mysuru", 1)):
            inst = db.rows(self.conn, "SELECT aicte_id FROM institutions WHERE city=? ORDER BY rowid", (city,))[idx]["aicte_id"]
            linked = db.rows(self.conn, "SELECT 1 FROM cases WHERE institution_id=? AND cluster_id IS NOT NULL", (inst,))
            self.assertEqual(linked, [], f"decoy at {city} was wrongly linked")


class TestAuditChain(Base):
    def test_chain_verifies_then_detects_tamper(self):
        self.assertTrue(db.verify_chain(self.conn)["ok"])
        row = self.conn.execute("SELECT case_id FROM action_history GROUP BY case_id HAVING COUNT(*)>=3 LIMIT 1").fetchone()
        orig = self.conn.execute("SELECT remarks FROM action_history WHERE case_id=? AND seq=2", (row[0],)).fetchone()[0]
        self.conn.execute("UPDATE action_history SET remarks='edited' WHERE case_id=? AND seq=2", (row[0],))
        self.conn.commit()
        r = db.verify_chain(self.conn)
        self.assertFalse(r["ok"])
        self.assertEqual((r["first_break"]["case_id"], r["first_break"]["seq"]), (row[0], 2))
        self.conn.execute("UPDATE action_history SET remarks=? WHERE case_id=? AND seq=2", (orig, row[0]))
        self.conn.commit()
        self.assertTrue(db.verify_chain(self.conn)["ok"])


class TestSlaEngine(Base):
    def test_idempotent_then_time_machine_escalates(self):
        first = sla.tick(self.conn, notify=False)
        second = sla.tick(self.conn, notify=False)
        self.assertEqual(second["escalated"] + second["severe"] + second["near"], 0)
        db.set_setting(self.conn, "clock_offset_days", 7)
        self.conn.commit()
        moved = sla.tick(self.conn, notify=False)
        self.assertGreaterEqual(moved["escalated"], 5)
        again = sla.tick(self.conn, notify=False)
        self.assertEqual(again["escalated"] + again["severe"], 0)
        db.set_setting(self.conn, "clock_offset_days", 0)
        self.conn.commit()
        self.assertTrue(db.verify_chain(self.conn)["ok"], "auto-escalations must keep the hash chain valid")


class TestNaturalLanguage(Base):
    def test_headline_query(self):
        r = nlsearch.parse(self.conn, "pending RB cases in Western region older than 30 days")
        self.assertEqual(r["params"], {"age_gt": 30, "status": "Pending", "bureau": "RB", "region": "Western"})

    def test_south_western_is_not_western(self):
        self.assertEqual(nlsearch.parse(self.conn, "overdue PGRC cases in south western region")["params"]["region"], "South-Western")

    def test_institution_by_name(self):
        r = nlsearch.parse(self.conn, "cases for Sahyadri Government College of Engineering Pune")
        self.assertEqual(r["params"].get("institution_id"), HERO)

    def test_unknown_text_falls_back_to_keywords(self):
        r = nlsearch.parse(self.conn, "zzzz")
        self.assertEqual(r["params"], {"q": "zzzz"})


class TestRiskAndRoles(Base):
    def test_hero_is_high_risk(self):
        self.assertEqual(risk.compute_all(self.conn)[HERO]["band"], "HIGH")

    def test_permission_matrix(self):
        rb = roles.Ctx(role="RB", region="", persona=roles.PERSONAS["RB"])
        pg = roles.Ctx(role="PGRC", region="", persona=roles.PERSONAS["PGRC"])
        ro = roles.Ctx(role="REGIONAL", region="Western", persona=("x", "x", "REGIONAL"))
        sm = roles.Ctx(role="SENIOR", region="", persona=roles.PERSONAS["SENIOR"])
        self.assertIn("transfer", roles.allowed_actions(rb, "RB", "Western", "Under Process"))
        self.assertEqual(roles.allowed_actions(pg, "RB", "Western", "Under Process"), [])
        self.assertEqual(roles.allowed_actions(ro, "RB", "Western", "Under Process"), ["remark"])
        self.assertEqual(roles.allowed_actions(ro, "RB", "Southern", "Under Process"), [])
        self.assertNotIn("transfer", roles.allowed_actions(sm, "RB", "Western", "Under Process"))
        self.assertEqual(roles.allowed_actions(rb, "RB", "Western", "Disposed"), [])


class TestZSimulation(Base):
    """Runs last: it adds cases and overlap clusters to the shared test DB."""

    def test_all_simulation_scenarios_fire_a_high_alert(self):
        for n in range(1, 7):
            res = services.simulate_complaint(self.conn, n)
            self.assertTrue(res["overlaps"], f"scenario {n} found no overlap")
            self.assertEqual(res["overlaps"][0]["band"], "HIGH", f"scenario {n}")


if __name__ == "__main__":
    unittest.main()