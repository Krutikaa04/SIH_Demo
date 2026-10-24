"""Regression tests for per-pair review and tamper-restore, calling the REAL endpoint functions.

Covers the review-status bug (CONFIRMED / DEFERRED made a cluster look DISMISSED, which dropped it from the
coordination list and switched the coordination guard off) and the double-tamper restore bug.
"""
import unittest

import pytest
from fastapi import HTTPException

from app import db, main, roles, seed, services

HERO = "1-4520311"


def _ctx(role, region=""):
    persona = roles.PERSONAS.get(role, ("OFF-RO-01", "Regional Officer", "REGIONAL"))
    return roles.Ctx(role=role, region=region, persona=persona)


class TestReviewAndRestore(unittest.TestCase):
    @pytest.fixture(autouse=True)
    def setup_database(self, conn):
        self.conn = conn
        self.sm = _ctx("SENIOR")

    def _hero(self):
        cl = [c for c in services.clusters_view(self.conn) if c["institution"]["aicte_id"] == HERO][0]
        return cl

    def _review(self, pair_id, decision, role=None):
        return main.review_overlap_pair(pair_id, {"decision": decision, "rationale": "Checked the dockets"},
                                        self.conn, role or self.sm)

    def _guard(self, case_id, role):
        row = db.one(self.conn, "SELECT * FROM cases WHERE case_id=?", (case_id,))
        return services.coordination_guard(self.conn, row)

    def test_confirmed_pairs_keep_the_overlap_active_and_the_guard_on(self):
        cl = self._hero()
        case = cl["cases"][0]["case_id"]
        for p in cl["pairs"]:
            self._review(p["id"], "CONFIRMED")
        active = [c for c in services.clusters_view(self.conn) if c["cluster_id"] == cl["cluster_id"]]
        self.assertEqual(len(active), 1, "a confirmed overlap must stay in the coordination list")
        self.assertEqual(active[0]["status"], "LINKED")
        g = self._guard(case, None)
        self.assertEqual((g["level"], g["code"]), ("ack", "OPEN_OVERLAP"))
        self.assertEqual(main.dashboard(self.conn, self.sm)["overlap"]["open_clusters"], 11)

    def test_deferred_pairs_stay_open(self):
        cl = self._hero()
        for p in cl["pairs"]:
            self._review(p["id"], "DEFERRED")
        active = [c for c in services.clusters_view(self.conn) if c["cluster_id"] == cl["cluster_id"]]
        self.assertEqual(active[0]["status"], "OPEN")
        self.assertIsNotNone(self._guard(cl["cases"][0]["case_id"], None))

    def test_rejecting_every_pair_frees_the_cases(self):
        cl = self._hero()
        for p in cl["pairs"]:
            self._review(p["id"], "REJECTED")
        self.assertFalse([c for c in services.clusters_view(self.conn) if c["institution"]["aicte_id"] == HERO])
        for c in cl["cases"]:
            row = db.one(self.conn, "SELECT cluster_id FROM cases WHERE case_id=?", (c["case_id"],))
            self.assertIsNone(row["cluster_id"])
            self.assertIsNone(self._guard(c["case_id"], None))
        graph = __import__("app.galaxy", fromlist=["galaxy"]).generate_galaxy_graph(self.conn)
        rejected = {p["id"] for p in cl["pairs"]}
        self.assertFalse([e for e in graph["edges"] if e["id"].replace("overlap-", "") in rejected])

    def test_rejecting_one_link_in_a_chain_detaches_only_the_isolated_case(self):
        cl = self._hero()  # 3 cases, 3 pairs (a triangle): rejecting one keeps all three connected
        first = cl["pairs"][0]
        self._review(first["id"], "REJECTED")
        again = [c for c in services.clusters_view(self.conn) if c["institution"]["aicte_id"] == HERO][0]
        self.assertEqual(len(again["cases"]), 3)
        self.assertEqual(len(again["pairs"]), 2)

    def test_resolve_decision_does_not_resurrect_a_rejected_pair(self):
        cl = self._hero()
        rejected = cl["pairs"][0]["id"]
        self._review(rejected, "REJECTED")
        room = main.create_room({"cluster_id": cl["cluster_id"]}, self.conn, self.sm)
        main.decide(room["id"], {"outcome": "RESOLVE", "lead_bureau": room["lead_bureau"], "note": "ok"}, self.conn, self.sm)
        self.assertEqual(db.one(self.conn, "SELECT status FROM overlap_pairs WHERE id=?", (rejected,))["status"], "REJECTED")

    def test_review_needs_a_rationale_and_a_non_regional_role(self):
        cl = self._hero()
        pid = cl["pairs"][0]["id"]
        with self.assertRaises(HTTPException) as cm:
            main.review_overlap_pair(pid, {"decision": "CONFIRMED", "rationale": "  "}, self.conn, self.sm)
        self.assertEqual(cm.exception.status_code, 422)
        with self.assertRaises(HTTPException) as cm:
            self._review(pid, "CONFIRMED", role=_ctx("REGIONAL", "Western"))
        self.assertEqual(cm.exception.status_code, 403)

    def test_review_is_written_to_both_cases_and_the_chain_stays_valid(self):
        cl = self._hero()
        p = cl["pairs"][0]
        self._review(p["id"], "CONFIRMED")
        for cid in (p["case_a"], p["case_b"]):
            self.assertEqual(services.history_for(self.conn, cid)[-1]["action_type"], "OVERLAP_CONFIRMED")
        self.assertTrue(db.verify_chain(self.conn)["ok"])

    def test_double_tamper_then_restore_repairs_the_chain(self):
        self.assertTrue(db.verify_chain(self.conn)["ok"])
        main.tamper({}, self.conn)
        main.tamper({}, self.conn)  # a second click used to overwrite the pristine backup
        self.assertFalse(db.verify_chain(self.conn)["ok"])
        out = main.restore_tamper(self.conn)
        self.assertTrue(out["restored"])
        self.assertTrue(out["verification"]["ok"])

    def test_tampering_two_different_records_restores_both(self):
        main.tamper({"case_id": self._hero()["cases"][0]["case_id"], "seq": 2}, self.conn)
        main.tamper({"case_id": self._hero()["cases"][1]["case_id"], "seq": 2}, self.conn)
        self.assertFalse(db.verify_chain(self.conn)["ok"])
        self.assertTrue(main.restore_tamper(self.conn)["verification"]["ok"])


if __name__ == "__main__":
    unittest.main()
