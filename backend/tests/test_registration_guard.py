"""Tests for complaint registration (form + CSV import) and the coordination guard.

Each test receives an isolated copy of the seeded database from conftest.py.
Run:  python -m pytest backend/tests -q
"""
import unittest

import pytest
from fastapi import HTTPException

from app import db, intel, roles, seed, services

from app.routers import admin, cases, dashboard, overlaps, rooms

HERO = "1-4520311"
TEXT = "Students say regular teachers are missing for months and the faculty strength is far below norms."


def _ctx(role):
    persona = roles.PERSONAS[role]
    return roles.Ctx(role=role, region="", persona=persona)


class TestRegistrationAndGuard(unittest.TestCase):
    @pytest.fixture(autouse=True)
    def setup_database(self, conn):
        self.conn = conn
        self.sm, self.pg, self.rb = _ctx("SENIOR"), _ctx("PGRC"), _ctx("RB")

    def _register(self, **over):
        data = {"institution_name": "Sahyadri Govt Coll of Engg Poona", "bureau": "PGRC", "category": "Academic Quality",
                "description": TEXT, "severity": 4, "source": "Email"}
        data.update(over)
        d = services.clean_complaint(self.conn, data, self.sm)
        return services.register_complaint(self.conn, d, self.sm)

    # ---- item 1: registration -----------------------------------------------------------

    def test_a_preview_writes_nothing_and_finds_the_overlap(self):
        before = self.conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
        pv = services.preview_complaint(self.conn, {"institution_name": "Sahyadri Govt Coll of Engg Poona", "bureau": "PGRC",
                                                    "category": "Academic Quality", "description": TEXT}, self.sm)
        self.assertEqual(pv["resolution"]["institution_id"], HERO)
        self.assertTrue(pv["ready"])
        self.assertTrue(pv["open_cases"])
        self.assertTrue(any(o["band"] == "HIGH" for o in pv["potential_overlaps"]))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0], before)

    def test_b_unresolved_name_gives_suggestions(self):
        reg = intel.Registry(self.conn)
        self.assertIsNone(reg.resolve("Sahyadri"))
        sug = reg.suggest("Sahyadri")
        self.assertTrue(sug and "Sahyadri" in sug[0]["name"])
        d = services.clean_complaint(self.conn, {"institution_name": "Sahyadri", "bureau": "RB",
                                                  "category": "Faculty Deficiency", "description": TEXT}, None)
        with self.assertRaises(services.Unresolved):
            services.register_complaint(self.conn, d)

    def test_c_validation_messages(self):
        base = {"institution_name": "Kaveri Institute of Technology, Bengaluru", "bureau": "RB",
                "category": "Faculty Deficiency", "description": TEXT}
        for bad, msg in [({"category": "Nonsense"}, "category"), ({"description": "short"}, "10 characters"),
                         ({"received_on": "2999-01-01"}, "future"), ({"severity": 9}, "Severity"), ({"bureau": "XX"}, "Bureau")]:
            with self.assertRaises(ValueError) as cm:
                services.clean_complaint(self.conn, {**base, **bad}, None)
            self.assertIn(msg, str(cm.exception))

    def test_d_csv_import_dry_run_then_real(self):
        csv_text = (
            "institution_name,bureau,category,description,severity,source,received_on\n"
            "Kaveri Inst of Tech Bangalore,AB,Unapproved Programme,Institute is running a course without any approval from AICTE,3,Letter,\n"
            "Totally Unknown Place of Learning Atlantis,RB,Faculty Deficiency,Shortage of teachers in the department reported,3,Letter,\n"
            "Kaveri Inst of Tech Bangalore,RB,Not A Category,Some text that is long enough here,3,Letter,\n")
        before = self.conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
        dry = services.import_complaints(self.conn, csv_text, self.sm, dry_run=True)
        self.assertEqual((dry["counts"]["ok"], dry["counts"]["needs_review"], dry["counts"]["error"]), (1, 1, 1))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0], before)
        real = services.import_complaints(self.conn, csv_text, self.sm, dry_run=False)
        self.assertEqual(real["counts"]["created"], 1)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0], before + 1)
        self.assertTrue(db.verify_chain(self.conn)["ok"])

    def test_e_exact_duplicate_is_rejected(self):
        first = self._register(description=TEXT + " Duplicate probe.")
        with self.assertRaises(ValueError) as cm:
            self._register(description=TEXT + " Duplicate probe.")
        self.assertIn(first["case"]["case_id"], str(cm.exception))

    # ---- item 2: coordination guard -----------------------------------------------------

    def test_z_guard_ack_block_and_senior_bypass(self):
        out = self._register(description=TEXT + " Registered for the guard test.")
        self.assertTrue(out["overlaps"], "registration must detect the overlap")
        cid = out["case"]["case_id"]
        cluster = out["overlaps"][0]["cluster_id"]

        # open overlap -> acknowledgement required for transfer/escalate/dispose, never for remarks
        g = services.coordination_guard(self.conn, db.one(self.conn, "SELECT * FROM cases WHERE case_id=?", (cid,)))
        self.assertEqual((g["level"], g["code"]), ("ack", "OPEN_OVERLAP"))
        with self.assertRaises(HTTPException) as cm:
            cases.case_action(cid, {"type": "transfer", "to_bureau": "AB", "remarks": "x"}, self.conn, self.pg)
        self.assertEqual(cm.exception.status_code, 409)
        cases.case_action(cid, {"type": "remark", "remarks": "Remarks never need acknowledgement"}, self.conn, self.pg)

        # merge the cluster under RB
        room = rooms.create_room({"cluster_id": cluster}, self.conn, self.sm)
        rooms.decide(room["id"], {"outcome": "MERGE", "lead_bureau": "RB", "note": "RB leads"}, self.conn, self.sm)
        g = services.coordination_guard(self.conn, db.one(self.conn, "SELECT * FROM cases WHERE case_id=?", (cid,)))
        self.assertEqual((g["level"], g["code"]), ("block", "FOLLOWS_LEAD"))

        # follower (PGRC) is blocked but may still remark; Senior must acknowledge
        for kind in ("transfer", "escalate", "dispose"):
            with self.assertRaises(HTTPException) as cm:
                cases.case_action(cid, {"type": kind, "to_bureau": "AB", "remarks": "x"}, self.conn, self.pg)
            self.assertEqual(cm.exception.status_code, 403, kind)
        cases.case_action(cid, {"type": "remark", "remarks": "Statements forwarded to the lead"}, self.conn, self.pg)
        self.assertNotIn("escalate", cases.get_case(cid, self.conn, self.pg)["allowed_actions"])
        with self.assertRaises(HTTPException) as cm:
            cases.case_action(cid, {"type": "escalate", "remarks": "x"}, self.conn, self.sm)
        self.assertEqual(cm.exception.status_code, 409)
        res = cases.case_action(cid, {"type": "escalate", "remarks": "Competent Authority intervenes",
                                     "acknowledge_overlap": True}, self.conn, self.sm)
        self.assertEqual(res["status"], "Escalated")
        self.assertIn("acknowledged", services.history_for(self.conn, cid)[-1]["remarks"])

        # the lead Bureau cannot dispose silently while followers are still open
        lead = db.one(self.conn, "SELECT * FROM cases WHERE cluster_id=? AND bureau_code='RB' AND status!='Disposed' LIMIT 1", (cluster,))
        g = services.coordination_guard(self.conn, lead)
        self.assertEqual(g["code"], "LEAD_WITH_OPEN_FOLLOWERS")
        with self.assertRaises(HTTPException) as cm:
            cases.case_action(lead["case_id"], {"type": "dispose", "remarks": "Closed"}, self.conn, self.rb)
        self.assertEqual(cm.exception.status_code, 409)
        self.assertTrue(db.verify_chain(self.conn)["ok"])


if __name__ == "__main__":
    unittest.main()
