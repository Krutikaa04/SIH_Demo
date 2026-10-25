"""Role-targeted alerts (issue #12): who sees which alert, unread counts, per-role read state, producers."""
import pytest

from app import db, services, sla

BUREAUS = ["RB", "PGRC", "AB", "LC", "VIG"]


def alerts_for(client, as_role, role, region=None, **query):
    qs = "&".join(f"{k}={v}" for k, v in {"limit": 400, **query}.items())
    response = client.get(f"/api/alerts?{qs}", headers=as_role(role, region))
    assert response.status_code == 200
    return response.json()


def make_alert(conn, targets, message="Test alert", case_id=None, institution_id=None, type_="SLA_NEAR"):
    alert_id = services.create_alert(conn, type_, "MEDIUM", message, case_id, institution_id, target_bureaus=targets)
    conn.commit()
    return alert_id


def ids(payload):
    return {a["id"] for a in payload["items"]}


# ---- helpers ---------------------------------------------------------------------------------

def test_target_encoding_round_trip():
    assert db.fmt_targets(["RB", "PGRC", "RB", None, ""]) == ",PGRC,RB,"
    assert db.fmt_targets([]) == "" and db.fmt_targets(None) == ""
    assert db.parse_targets(",PGRC,RB,") == ["PGRC", "RB"]
    assert db.parse_targets(None) == [] and db.parse_targets("") == []


# ---- visibility matrix -------------------------------------------------------------------------

def test_targeted_alert_is_visible_only_to_its_bureaus_and_senior(conn, client, as_role):
    only_rb = make_alert(conn, ["RB"], "RB only")
    rb_and_pgrc = make_alert(conn, ["PGRC", "RB"], "Shared by RB and PGRC")
    expect = {"RB": {only_rb, rb_and_pgrc}, "PGRC": {rb_and_pgrc}, "AB": set(), "LC": set(), "VIG": set(),
              "SENIOR": {only_rb, rb_and_pgrc}}
    for role, wanted in expect.items():
        seen = ids(alerts_for(client, as_role, role))
        assert wanted <= seen, role
        assert (({only_rb, rb_and_pgrc} - wanted) & seen) == set(), role


def test_untargeted_legacy_alert_is_visible_to_every_bureau(conn, client, as_role):
    alert_id = make_alert(conn, None, "Global alert")
    for role in BUREAUS + ["SENIOR"]:
        assert alert_id in ids(alerts_for(client, as_role, role)), role


def test_regional_sees_only_alerts_for_its_region(conn, client, as_role):
    western = conn.execute("SELECT aicte_id FROM institutions WHERE region='Western' LIMIT 1").fetchone()[0]
    southern = conn.execute("SELECT aicte_id FROM institutions WHERE region='Southern' LIMIT 1").fetchone()[0]
    in_west = make_alert(conn, ["RB"], "Western institution", institution_id=western)
    in_south = make_alert(conn, ["RB"], "Southern institution", institution_id=southern)
    seen = ids(alerts_for(client, as_role, "REGIONAL", "Western"))
    assert in_west in seen and in_south not in seen


def test_overlap_alert_targets_the_bureaus_of_both_cases(conn, client, as_role):
    result = services.simulate_complaint(conn, 1)  # scenario 1: staged RB case + new PGRC complaint, same institution
    assert result["overlaps"], "scenario 1 must raise an overlap"
    pair = result["overlaps"][0]
    alert = conn.execute("SELECT * FROM alerts WHERE pair_id=?", (pair["pair_id"],)).fetchone()
    assert db.parse_targets(alert["target_bureaus"]) == ["PGRC", "RB"]
    for role, visible in {"RB": True, "PGRC": True, "SENIOR": True, "AB": False, "LC": False, "VIG": False}.items():
        assert (alert["id"] in ids(alerts_for(client, as_role, role))) is visible, role


def test_sla_alerts_target_the_cases_own_bureau(conn):
    db.set_setting(conn, "clock_offset_days", 10)
    conn.commit()
    sla.tick(conn, notify=False)
    rows = conn.execute("SELECT a.*, c.bureau_code FROM alerts a JOIN cases c ON c.case_id=a.case_id "
                        "WHERE a.type IN ('SLA_NEAR','ESCALATION','PING_PONG') AND a.case_id IS NOT NULL").fetchall()
    assert rows, "the time machine must have produced case-level SLA alerts"
    for r in rows:
        assert db.parse_targets(r["target_bureaus"]) == [r["bureau_code"]], r["message"]


def test_aggregate_digest_targets_every_bureau_it_lists(conn):
    db.set_setting(conn, "clock_offset_days", 30)  # large jump: more than 4 cases cross a threshold -> digest alert
    conn.commit()
    sla.tick(conn, notify=False)
    digests = conn.execute("SELECT * FROM alerts WHERE type IN ('SLA_NEAR','ESCALATION') AND case_id IS NULL").fetchall()
    assert digests, "expected at least one aggregate digest after a 30-day jump"
    for d in digests:
        assert db.parse_targets(d["target_bureaus"]), d["message"]


def test_every_seeded_alert_has_targets(conn):
    missing = conn.execute("SELECT type, message FROM alerts WHERE target_bureaus IS NULL OR target_bureaus=''").fetchall()
    assert [tuple(r) for r in missing] == []


# ---- unread counts and per-role read state -----------------------------------------------------

@pytest.mark.parametrize("role,region", [(b, None) for b in BUREAUS] + [("SENIOR", None), ("REGIONAL", "Western")])
def test_unread_count_equals_the_visible_unread_alerts(client, as_role, role, region):
    payload = alerts_for(client, as_role, role, region)
    assert payload["unread"] == sum(1 for a in payload["items"] if not a["read"])
    only_unread = alerts_for(client, as_role, role, region, unread=1)
    assert len(only_unread["items"]) == payload["unread"]


def test_reading_a_shared_alert_is_per_role(conn, client, as_role):
    shared = make_alert(conn, ["PGRC", "RB"], "Shared alert")
    before = {r: alerts_for(client, as_role, r)["unread"] for r in ("RB", "PGRC", "SENIOR")}
    assert client.post(f"/api/alerts/{shared}/read", headers=as_role("RB")).status_code == 200
    after = {r: alerts_for(client, as_role, r)["unread"] for r in ("RB", "PGRC", "SENIOR")}
    assert after["RB"] == before["RB"] - 1
    assert after["PGRC"] == before["PGRC"] and after["SENIOR"] == before["SENIOR"]
    rb_view = {a["id"]: a for a in alerts_for(client, as_role, "RB")["items"]}
    pgrc_view = {a["id"]: a for a in alerts_for(client, as_role, "PGRC")["items"]}
    assert rb_view[shared]["read"] is True and pgrc_view[shared]["read"] is False


def test_mark_read_twice_is_idempotent(conn, client, as_role):
    shared = make_alert(conn, ["RB"], "Once")
    for _ in range(2):
        assert client.post(f"/api/alerts/{shared}/read", headers=as_role("RB")).status_code == 200
    assert conn.execute("SELECT read_roles FROM alerts WHERE id=?", (shared,)).fetchone()[0] == ",RB,"


def test_read_all_only_touches_alerts_the_role_can_see(conn, client, as_role):
    make_alert(conn, ["RB"], "RB only")
    make_alert(conn, ["PGRC"], "PGRC only")
    before_rb = alerts_for(client, as_role, "RB")["unread"]
    assert client.post("/api/alerts/read-all", headers=as_role("PGRC")).status_code == 200
    assert alerts_for(client, as_role, "PGRC")["unread"] == 0
    assert alerts_for(client, as_role, "RB")["unread"] == before_rb


def test_cannot_mark_an_invisible_alert_read(conn, client, as_role):
    only_rb = make_alert(conn, ["RB"], "RB only")
    assert client.post(f"/api/alerts/{only_rb}/read", headers=as_role("PGRC")).status_code == 404
    assert client.post("/api/alerts/999999/read", headers=as_role("RB")).status_code == 404
    assert conn.execute("SELECT read_roles FROM alerts WHERE id=?", (only_rb,)).fetchone()[0] in (None, "")


def test_globally_read_legacy_alert_counts_as_read_for_everyone(conn, client, as_role):
    alert_id = make_alert(conn, ["RB"], "Old")
    conn.execute("UPDATE alerts SET is_read=1 WHERE id=?", (alert_id,))
    conn.commit()
    view = {a["id"]: a for a in alerts_for(client, as_role, "RB")["items"]}
    assert view[alert_id]["read"] is True


# ---- notifications respect visibility -----------------------------------------------------------

def test_reminder_dispatch_requires_a_visible_alert(conn, client, as_role):
    only_rb = make_alert(conn, ["RB"], "RB digest without a case", type_="PENDING_REMINDER")
    assert client.post(f"/api/alerts/{only_rb}/notify", json={"channel": "email"}, headers=as_role("PGRC")).status_code == 403
    assert client.get(f"/api/alerts/{only_rb}/notify/preview", headers=as_role("PGRC")).status_code == 403
    assert client.get(f"/api/alerts/{only_rb}/notify/preview", headers=as_role("RB")).status_code == 200
    assert client.post(f"/api/alerts/{only_rb}/notify", json={"channel": "email"}, headers=as_role("RB")).status_code == 200
