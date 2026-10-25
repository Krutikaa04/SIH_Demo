import json
import unittest

from check_recording import HERO, demo_reader, inspect


class RecordingPreflightTests(unittest.TestCase):
    def setUp(self):
        self.responses = {
            "/": ("text/html", b'<div id="root"></div><script src="/assets/app.js"></script>', 2),
            "/assets/app.js": ("text/javascript", b"compiled entry", 2),
            "/api/meta": {"bureaus": [{"code": c} for c in ("RB", "PGRC", "AB", "LC", "VIG")], "regions": [0] * 8},
            "/api/clock": {"offset_days": 0, "now": "2026-10-25"},
            "/api/audit/verify": {"ok": True, "checked": 200, "first_break": None},
            "/api/dashboard/summary": {"role": "SENIOR", "totals": {"received": 300, "pending": 179}},
            "/api/overlaps": {"items": [{"institution": {"aicte_id": HERO}, "cluster_id": "OVL-0001", "status": "OPEN", "bureaus": ["RB", "PGRC", "AB"]}]},
            "/openapi.json": {"paths": {p: {} for p in ("/api/reports/{kind}", "/api/briefings/executive", "/api/institutions/{institution_id}/aftercare", "/api/rooms/{room_id}/commitments")}},
            "/api/briefings/executive": {"region": "", "action_agenda": []},
            "/api/reports/coordination": {"kind": "coordination", "methodology": "Measured"},
            f"/api/institutions/{HERO}/aftercare": {"institution_id": HERO},
        }
        self.paths = []

    def get(self, path):
        self.paths.append(path)
        value = self.responses[path]
        return value if isinstance(value, tuple) else ("application/json", json.dumps(value).encode(), 2)

    def test_ready_recording_reads_only_expected_endpoints(self):
        result = inspect(self.get, True)
        self.assertTrue(result["ready"])
        self.assertEqual(len(result["checks"]), 7)
        self.assertFalse(any(p.startswith("/api/admin") for p in self.paths))

    def test_core_check_does_not_require_optional_features(self):
        del self.responses["/openapi.json"]
        self.assertTrue(inspect(self.get)["ready"])

    def test_independent_failures_are_all_reported(self):
        self.responses["/api/clock"]["offset_days"] = 7
        self.responses["/api/audit/verify"].update(ok=False, first_break={"case_id": "RB/2026/001"})
        result = inspect(self.get)
        self.assertFalse(result["ready"])
        self.assertEqual([c["name"] for c in result["checks"] if c["status"] == "FAIL"], ["Demo clock", "Audit integrity"])

    def test_html_fallback_cannot_impersonate_a_script_or_json_api(self):
        self.responses["/assets/app.js"] = ("text/html", b"fallback", 2)
        self.responses["/api/meta"] = ("text/html", b"fallback", 2)
        result = inspect(self.get)
        self.assertEqual(sum(c["status"] == "FAIL" for c in result["checks"]), 2)

    def test_a_settled_hero_is_not_a_fresh_take(self):
        self.responses["/api/overlaps"]["items"][0]["status"] = "RESOLVED"
        self.assertFalse(inspect(self.get)["ready"])

    def test_empty_audit_is_not_reported_as_ready(self):
        self.responses["/api/audit/verify"]["checked"] = 0
        self.assertFalse(inspect(self.get)["ready"])

    def test_missing_innovation_feature_fails_without_breaking_other_checks(self):
        self.responses["/openapi.json"]["paths"].pop("/api/rooms/{room_id}/commitments")
        result = inspect(self.get, True)
        self.assertFalse(result["ready"])
        self.assertEqual(result["checks"][-1]["name"], "Innovation features")

    def test_slow_responses_warn_without_inventing_a_failure(self):
        value = self.responses["/api/clock"]
        self.responses["/api/clock"] = ("application/json", json.dumps(value).encode(), 1800)
        result = inspect(self.get)
        self.assertTrue(result["ready"])
        self.assertTrue(any(c["status"] == "WARN" for c in result["checks"]))

    def test_automatic_demo_signin_refuses_remote_hosts(self):
        with self.assertRaisesRegex(ValueError, "loopback"):
            with demo_reader("https://example.com"):
                self.fail("Remote credentials must never be attempted")


if __name__ == "__main__":
    unittest.main()
