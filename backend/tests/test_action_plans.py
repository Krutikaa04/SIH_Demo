"""Concrete room commitments, owner accountability and evidence-backed completion."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

from app import action_plans, db, events, seed
from app.constants import BUREAUS


def make_room(conn, client, as_role, region="Western"):
    rows = db.rows(conn, "SELECT c.case_id,c.institution_id,c.bureau_code FROM cases c JOIN institutions i "
                         "ON i.aicte_id=c.institution_id WHERE i.region=? AND c.status!='Disposed' "
                         "AND c.cluster_id IS NULL ORDER BY c.institution_id,c.case_id", (region,))
    for a in rows:
        b = next((r for r in rows if r["institution_id"] == a["institution_id"] and r["bureau_code"] != a["bureau_code"]), None)
        if b:
            linked = client.post("/api/links", headers=as_role("SENIOR"),
                                 json={"case_a": a["case_id"], "case_b": b["case_id"], "rationale": "Joint follow-up"})
            assert linked.status_code == 200
            response = client.post("/api/rooms", headers=as_role("SENIOR"), json={"cluster_id": linked.json()["cluster_id"]})
            assert response.status_code == 200
            return response.json(), a, b
    pytest.fail("No suitable pair in demo fixture")


@pytest.fixture
def room_data(conn, client, as_role):
    return make_room(conn, client, as_role)


def url(room):
    return f"/api/rooms/{room['id']}/commitments"


def add(conn, client, as_role, room, source_case_id, role="SENIOR", **updates):
    body = {"case_id": source_case_id, "title": "Share the original fee circular", "due_on": str(db.now(conn).date())}
    body.update(updates)
    return client.post(url(room), headers=as_role(role), json=body)


def complete(client, as_role, room, commitment_id, role="SENIOR", note="Document DOC-1 and the response are recorded in the case history"):
    return client.post(f"{url(room)}/{commitment_id}/complete", headers=as_role(role), json={"completion_note": note})


def ledger(conn, case_id, action):
    return db.rows(conn, "SELECT * FROM action_history WHERE case_id=? AND action_type=?", (case_id, action))


def test_additive_schema_and_case_derived_owner_with_real_audit(room_data, conn, client, as_role):
    room, a, _ = room_data
    assert not db.one(conn, "SELECT name FROM sqlite_master WHERE name=?", (action_plans.TABLE_NAME,))
    empty = client.get(url(room), headers=as_role("SENIOR"))
    assert empty.status_code == 200 and empty.json()["items"] == []
    before = db.one(conn, "SELECT status FROM cases WHERE case_id=?", (a["case_id"],))["status"]
    response = add(conn, client, as_role, room, a["case_id"])
    assert response.status_code == 200
    plan = response.json()["plan"]
    item = plan["items"][0]
    assert item["owner_bureau"] == a["bureau_code"] and item["status"] == "OPEN"
    assert item["case_id"] == a["case_id"] and "%2F" in item["case_url"]
    assert client.get("/api" + item["case_url"], headers=as_role("SENIOR")).json()["case_id"] == a["case_id"]
    assert plan["counts"] == {"open": 1, "done": 0, "overdue": 0}
    assert plan["role"] == "SENIOR" and plan["scope_region"] == "" and plan["region"] == "Western"
    events_ = ledger(conn, a["case_id"], "COMMITMENT_CREATED")
    assert len(events_) == 1 and item["title"] in events_[0]["remarks"]
    assert item["owner_bureau"] in events_[0]["remarks"] and item["due_on"] in events_[0]["remarks"]
    assert db.one(conn, "SELECT status FROM cases WHERE case_id=?", (a["case_id"],))["status"] == before
    assert db.verify_chain(conn, a["case_id"])["ok"]


def test_only_senior_or_current_lead_can_create(room_data, conn, client, as_role):
    room, a, b = room_data
    lead = room["lead_bureau"]
    follower = next(c["bureau_code"] for c in (a, b) if c["bureau_code"] != lead)
    outsider = next(code for code in BUREAUS if code not in (a["bureau_code"], b["bureau_code"]))
    assert add(conn, client, as_role, room, b["case_id"], role=lead).status_code == 200
    assert add(conn, client, as_role, room, a["case_id"], role=follower).status_code == 403
    assert add(conn, client, as_role, room, a["case_id"], role=outsider).status_code == 403
    regional = client.post(url(room), headers=as_role("REGIONAL", "Western"),
                           json={"case_id": a["case_id"], "title": "Follow-up", "due_on": str(db.now(conn).date())})
    assert regional.status_code == 403


@pytest.mark.parametrize("change", [
    {"title": " "}, {"title": "x" * 161}, {"title": ["invalid"]}, {"title": "A\nB"},
    {"due_on": "bad"}, {"due_on": "20260230"}, {"due_on": "2026-02-30"}, {"due_on": None},
    {"case_id": "NO/SUCH/CASE"}, {"owner_bureau": "LC"},
])
def test_rejects_invalid_or_forged_fields_without_audit(room_data, conn, client, as_role, change):
    room, a, _ = room_data
    response = add(conn, client, as_role, room, a["case_id"], **change)
    assert response.status_code == 422
    assert ledger(conn, a["case_id"], "COMMITMENT_CREATED") == []
    assert client.get(url(room), headers=as_role("SENIOR")).json()["items"] == []


def test_rejects_nonmember_case_and_past_date(room_data, conn, client, as_role):
    room, a, _ = room_data
    outside = conn.execute("SELECT case_id FROM cases WHERE institution_id!=? LIMIT 1", (a["institution_id"],)).fetchone()[0]
    assert add(conn, client, as_role, room, outside).status_code == 422
    yesterday = str(db.now(conn).date() - timedelta(days=1))
    assert add(conn, client, as_role, room, a["case_id"], due_on=yesterday).status_code == 422


def test_completion_requires_owner_and_evidence_is_idempotent_and_preserves_case(room_data, conn, client, as_role):
    room, a, b = room_data
    commitment_id = add(conn, client, as_role, room, a["case_id"]).json()["id"]
    assert complete(client, as_role, room, commitment_id, role=b["bureau_code"]).status_code == 403
    assert complete(client, as_role, room, commitment_id, note="  ").status_code == 422
    assert complete(client, as_role, room, commitment_id, note="x" * 2001).status_code == 422
    before = db.one(conn, "SELECT status,outcome,disposed_on FROM cases WHERE case_id=?", (a["case_id"],))
    completed = complete(client, as_role, room, commitment_id, role=a["bureau_code"], note="Circular attached as DOC-1; response noted.")
    assert completed.status_code == 200 and completed.json()["already_completed"] is False
    item = completed.json()["plan"]["items"][0]
    assert item["status"] == "DONE" and item["completed_at"] and item["completed_by"]
    assert item["completion_note"] == "Circular attached as DOC-1; response noted."
    again = complete(client, as_role, room, commitment_id, role=a["bureau_code"], note="Overwrite attempt")
    assert again.status_code == 200 and again.json()["already_completed"] is True
    assert again.json()["plan"]["items"][0]["completion_note"] == item["completion_note"]
    assert len(ledger(conn, a["case_id"], "COMMITMENT_COMPLETED")) == 1
    assert db.one(conn, "SELECT status,outcome,disposed_on FROM cases WHERE case_id=?", (a["case_id"],)) == before
    assert db.one(conn, "SELECT decision FROM coordination_rooms WHERE id=?", (room["id"],))["decision"] is None
    assert db.verify_chain(conn, a["case_id"])["ok"]


def test_owner_snapshot_survives_transfer_and_membership_change(room_data, conn, client, as_role):
    room, a, b = room_data
    commitment_id = add(conn, client, as_role, room, a["case_id"]).json()["id"]
    new_bureau = b["bureau_code"]
    conn.execute("UPDATE cases SET bureau_code=? WHERE case_id=?", (new_bureau, a["case_id"]))
    conn.execute("DELETE FROM room_cases WHERE room_id=? AND case_id=?", (room["id"], a["case_id"]))
    conn.commit()
    item = client.get(url(room), headers=as_role("SENIOR")).json()["items"][0]
    assert item["owner_bureau"] == a["bureau_code"] and item["current_bureau"] == new_bureau
    assert item["is_room_member"] is False
    assert complete(client, as_role, room, commitment_id, role=new_bureau).status_code == 403
    assert complete(client, as_role, room, commitment_id, role=a["bureau_code"]).status_code == 200


def test_concurrent_completion_records_only_one_actor_note_and_audit(room_data, conn, client, as_role):
    room, a, _ = room_data
    item_id = add(conn, client, as_role, room, a["case_id"]).json()["id"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda note: complete(client, as_role, room, item_id, note=note),
                                ["Evidence from response A", "Evidence from response B"]))
    assert all(result.status_code == 200 for result in results)
    assert sorted(result.json()["already_completed"] for result in results) == [False, True]
    assert len(ledger(conn, a["case_id"], "COMMITMENT_COMPLETED")) == 1
    notes = {result.json()["plan"]["items"][0]["completion_note"] for result in results}
    assert len(notes) == 1
    assert db.verify_chain(conn, a["case_id"])["ok"]


@pytest.mark.parametrize("outcome,allowed", [("MERGE", True), ("RESOLVE", True), ("KEEP_SEPARATE", False)])
def test_recorded_decisions_remain_unchanged_and_control_new_joint_work(room_data, conn, client, as_role, outcome, allowed):
    room, a, _ = room_data
    decision = client.post(f"/api/rooms/{room['id']}/decision", headers=as_role("SENIOR"),
                           json={"outcome": outcome, "note": "Bureaus recorded the outcome"})
    assert decision.status_code == 200
    before = db.one(conn, "SELECT status,decision FROM coordination_rooms WHERE id=?", (room["id"],))
    response = add(conn, client, as_role, room, a["case_id"])
    assert response.status_code == (200 if allowed else 409)
    assert client.get(url(room), headers=as_role("SENIOR")).json()["can_create"] is allowed
    assert db.one(conn, "SELECT status,decision FROM coordination_rooms WHERE id=?", (room["id"],)) == before


def test_regional_reads_are_scoped_and_read_only(room_data, conn, client, as_role):
    room, a, _ = room_data
    item_id = add(conn, client, as_role, room, a["case_id"]).json()["id"]
    valid = client.get(url(room), headers=as_role("REGIONAL", "Western"))
    assert valid.status_code == 200
    payload = valid.json()
    assert payload["role"] == "REGIONAL" and payload["scope_region"] == "Western"
    assert payload["can_create"] is False and payload["items"][0]["can_complete"] is False
    for region in ("", "Unknown", "Northern"):
        response = client.get(url(room), headers=as_role("REGIONAL", region))
        assert response.status_code == 403 and a["case_id"] not in response.text
    denied = client.post(f"{url(room)}/{item_id}/complete", headers=as_role("REGIONAL", "Western"), json={"completion_note": "Done"})
    assert denied.status_code == 403


def test_due_today_is_open_then_overdue_and_done_exits_overdue_count(room_data, conn, client, as_role):
    room, a, _ = room_data
    item_id = add(conn, client, as_role, room, a["case_id"]).json()["id"]
    db.set_setting(conn, "clock_offset_days", "1")
    conn.commit()
    plan = client.get(url(room), headers=as_role("SENIOR")).json()
    assert plan["counts"] == {"open": 1, "overdue": 1, "done": 0}
    assert plan["items"][0]["overdue"] is True
    complete(client, as_role, room, item_id)
    assert client.get(url(room), headers=as_role("SENIOR")).json()["counts"] == {"open": 0, "overdue": 0, "done": 1}


def test_events_publish_only_after_committed_writes_and_not_on_repeat(room_data, conn, client, as_role, monkeypatch):
    room, a, _ = room_data
    published = []
    def capture(name, payload):
        other = db.connect()
        try:
            assert other.execute("SELECT COUNT(*) FROM coordination_commitments").fetchone()[0] == 1
            published.append((name, payload, other.execute("SELECT status FROM coordination_commitments").fetchone()[0]))
        finally:
            other.close()
    monkeypatch.setattr(events, "publish", capture)
    item_id = add(conn, client, as_role, room, a["case_id"]).json()["id"]
    assert {name for name, _, _ in published} == {"room.updated", "case.updated", "dashboard.invalidate"}
    assert all(status == "OPEN" for _, _, status in published)
    complete(client, as_role, room, item_id)
    assert len(published) == 6
    assert all(status == "DONE" for _, _, status in published[3:])
    complete(client, as_role, room, item_id)
    assert len(published) == 6


def test_missing_room_and_mismatched_commitment_do_not_mutate(room_data, conn, client, as_role):
    room, a, _ = room_data
    item_id = add(conn, client, as_role, room, a["case_id"]).json()["id"]
    assert client.get("/api/rooms/NO-ROOM/commitments", headers=as_role("SENIOR")).status_code == 404
    assert complete(client, as_role, {"id": "NO-ROOM"}, item_id).status_code == 404
    assert complete(client, as_role, room, item_id + 999).status_code == 404
    assert ledger(conn, a["case_id"], "COMMITMENT_COMPLETED") == []


def test_demo_reset_removes_commitments_and_reinitializes_cleanly(room_data, conn, client, as_role):
    room, a, _ = room_data
    add(conn, client, as_role, room, a["case_id"])
    seed.seed(conn)
    assert not db.one(conn, "SELECT name FROM sqlite_master WHERE name=?", (action_plans.TABLE_NAME,))
    new_room, _, _ = make_room(conn, client, as_role)
    response = client.get(url(new_room), headers=as_role("SENIOR"))
    assert response.status_code == 200 and response.json()["items"] == []
