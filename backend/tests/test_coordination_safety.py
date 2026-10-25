"""Coordination ownership remains enforced during retries, errors and concurrent writes."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from urllib.parse import quote

import pytest
from fastapi import HTTPException

from app import coordination_policy, db, main, roles, services


@pytest.fixture
def room(client, as_role):
    hero = next(c for c in client.get("/api/overlaps", headers=as_role("SENIOR")).json()["items"]
                if c["institution"]["aicte_id"] == "1-4520311")
    response = client.post("/api/rooms", headers=as_role("SENIOR"), json={"cluster_id": hero["cluster_id"]})
    assert response.status_code == 200
    result = response.json()
    assert client.post(f"/api/rooms/{result['id']}/lead", headers=as_role("SENIOR"),
                       json={"lead_bureau": "RB"}).status_code == 200
    return result


def decide(client, as_role, room, outcome="MERGE", **extra):
    return client.post(f"/api/rooms/{room['id']}/decision", headers=as_role("SENIOR"),
                       json={"outcome": outcome, "lead_bureau": "RB", "note": "One agreed response", **extra})


@pytest.mark.parametrize("endpoint", ["lead", "decision"])
@pytest.mark.parametrize("lead", ["VIG", "=1+1", ["RB"]])
def test_lead_must_be_a_recognized_current_participant(client, as_role, room, endpoint, lead):
    response = client.post(f"/api/rooms/{room['id']}/{endpoint}", headers=as_role("SENIOR"),
                           json={"lead_bureau": lead, "outcome": "MERGE"})
    assert response.status_code == 400
    result = client.get(f"/api/rooms/{room['id']}", headers=as_role("SENIOR")).json()
    assert result["lead_bureau"] == "RB" and result["decision"] is None


@pytest.mark.parametrize("role", ["LC", "VIG", "REGIONAL"])
@pytest.mark.parametrize("endpoint", ["lead", "decision"])
def test_nonparticipants_cannot_take_room_ownership(client, as_role, room, role, endpoint):
    response = client.post(f"/api/rooms/{room['id']}/{endpoint}", headers=as_role(role, "Western"),
                           json={"lead_bureau": "PGRC", "outcome": "MERGE"})
    assert response.status_code == 403


@pytest.mark.parametrize("outcome", ["MERGE", "RESOLVE", "KEEP_SEPARATE"])
@pytest.mark.parametrize("role", ["PGRC", "RB", "SENIOR"])
def test_lead_cannot_change_after_a_decision(client, as_role, room, outcome, role):
    assert decide(client, as_role, room, outcome).status_code == 200
    response = client.post(f"/api/rooms/{room['id']}/lead", headers=as_role(role), json={"lead_bureau": "PGRC"})
    assert response.status_code == 409
    assert client.get(f"/api/rooms/{room['id']}").json()["lead_bureau"] == "RB"


@pytest.mark.parametrize("outcome", ["bad", None, ["MERGE"]])
def test_invalid_outcomes_leave_room_unchanged(client, as_role, room, outcome):
    assert decide(client, as_role, room, outcome).status_code == 400
    assert client.get(f"/api/rooms/{room['id']}").json()["decision"] is None


def test_identical_decision_retry_has_no_events_or_duplicate_history(client, as_role, room, conn, monkeypatch):
    first = decide(client, as_role, room)
    assert first.status_code == 200
    before = conn.execute("SELECT COUNT(*) FROM action_history").fetchone()[0]
    comments = conn.execute("SELECT COUNT(*) FROM room_comments").fetchone()[0]
    published = []
    monkeypatch.setattr(main.events, "publish", lambda *args: published.append(args))
    repeated = decide(client, as_role, room, note="  One agreed response  ")
    assert repeated.status_code == 200
    assert repeated.json()["decision"] == first.json()["decision"]
    assert conn.execute("SELECT COUNT(*) FROM action_history").fetchone()[0] == before
    assert conn.execute("SELECT COUNT(*) FROM room_comments").fetchone()[0] == comments
    assert published == [] and db.verify_chain(conn)["ok"]


@pytest.mark.parametrize("change", [{"outcome": "KEEP_SEPARATE"}, {"lead_bureau": "PGRC"}, {"note": "Different plan"}])
def test_conflicting_decision_retry_is_rejected(client, as_role, room, change):
    first = decide(client, as_role, room).json()["decision"]
    assert decide(client, as_role, room, **change).status_code == 409
    assert client.get(f"/api/rooms/{room['id']}").json()["decision"] == first


def test_follower_cannot_promote_itself_then_transfer(client, as_role, room):
    assert decide(client, as_role, room).status_code == 200
    assert client.post(f"/api/rooms/{room['id']}/lead", headers=as_role("PGRC"),
                       json={"lead_bureau": "PGRC"}).status_code == 409
    case = next(c for c in room["cases"] if c["bureau"] == "PGRC")
    response = client.post(f"/api/cases/{quote(case['case_id'], safe='')}/actions", headers=as_role("PGRC"),
                           json={"type": "transfer", "to_bureau": "LC", "acknowledge_overlap": True})
    assert response.status_code == 403


def test_last_open_lead_case_cannot_be_transferred_away(client, as_role, room, conn):
    assert decide(client, as_role, room).status_code == 200
    case = next(c for c in room["cases"] if c["bureau"] == "RB")
    before = conn.execute("SELECT COUNT(*) FROM action_history").fetchone()[0]
    response = client.post(f"/api/cases/{quote(case['case_id'], safe='')}/actions", headers=as_role("RB"),
                           json={"type": "transfer", "to_bureau": "LC", "acknowledge_overlap": True})
    assert response.status_code == 409 and "last open lead case" in response.json()["detail"]
    assert conn.execute("SELECT COUNT(*) FROM action_history").fetchone()[0] == before
    assert db.one(conn, "SELECT bureau_code FROM cases WHERE case_id=?", (case["case_id"],))["bureau_code"] == "RB"


def test_lead_can_transfer_when_another_open_lead_case_remains(client, as_role, room, conn):
    other = next(c for c in room["cases"] if c["bureau"] == "AB")
    conn.execute("UPDATE cases SET bureau_code='RB' WHERE case_id=?", (other["case_id"],))
    conn.commit()
    assert decide(client, as_role, room).status_code == 200
    case = next(c for c in room["cases"] if c["bureau"] == "RB")
    response = client.post(f"/api/cases/{quote(case['case_id'], safe='')}/actions", headers=as_role("RB"),
                           json={"type": "transfer", "to_bureau": "LC"})
    assert response.status_code == 200


def test_failed_policy_mutation_releases_its_transaction(client, as_role, room, conn):
    ctx = roles.Ctx(role="SENIOR", region="", persona=roles.PERSONAS["SENIOR"])
    with pytest.raises(HTTPException):
        main.set_lead(room["id"], {"lead_bureau": "VIG"}, conn, ctx)
    assert not conn.in_transaction
    assert main.set_lead(room["id"], {"lead_bureau": "PGRC"}, conn, ctx)["lead_bureau"] == "PGRC"
    assert not conn.in_transaction


def test_case_guard_is_read_only_after_the_writer_lock_is_acquired(client, as_role, room, monkeypatch):
    deciding, release, guard_read = Event(), Event(), Event()
    original_decision, original_guard = coordination_policy.decision_request, services.coordination_guard
    follower = next(c for c in room["cases"] if c["bureau"] == "PGRC")

    def hold_decision(*args):
        result = original_decision(*args)
        deciding.set()
        assert release.wait(5)
        return result

    def record_guard(conn, case):
        if case["case_id"] == follower["case_id"]:
            assert conn.in_transaction
            guard_read.set()
        return original_guard(conn, case)

    monkeypatch.setattr(coordination_policy, "decision_request", hold_decision)
    monkeypatch.setattr(services, "coordination_guard", record_guard)
    with ThreadPoolExecutor(max_workers=2) as executor:
        decision = executor.submit(decide, client, as_role, room)
        assert deciding.wait(5)
        action = executor.submit(client.post, f"/api/cases/{quote(follower['case_id'], safe='')}/actions",
                                 headers=as_role("PGRC"),
                                 json={"type": "transfer", "to_bureau": "AB", "acknowledge_overlap": True})
        try:
            assert not guard_read.wait(0.15)
        finally:
            release.set()
        assert decision.result(timeout=5).status_code == 200
        assert action.result(timeout=5).status_code == 403
    assert guard_read.is_set()


def test_regional_room_read_rejects_another_region(client, as_role, room):
    assert client.get(f"/api/rooms/{room['id']}", headers=as_role("REGIONAL", "Northern")).status_code == 403
    assert client.get(f"/api/rooms/{room['id']}", headers=as_role("REGIONAL", "Western")).status_code == 200


def test_concurrent_room_open_reuses_one_room_and_one_set_of_audit_entries(client, as_role, conn):
    hero = next(c for c in client.get("/api/overlaps").json()["items"]
                if c["institution"]["aicte_id"] == "1-4520311")
    before = conn.execute("SELECT COUNT(*) FROM action_history").fetchone()[0]
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(client.post, "/api/rooms", headers=as_role("SENIOR"),
                                   json={"cluster_id": hero["cluster_id"]}) for _ in range(4)]
        responses = [future.result(timeout=5) for future in futures]
    assert all(response.status_code == 200 for response in responses)
    assert len({response.json()["id"] for response in responses}) == 1
    assert conn.execute("SELECT COUNT(*) FROM coordination_rooms WHERE cluster_id=?",
                        (hero["cluster_id"],)).fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM action_history").fetchone()[0] == before + len(hero["cases"])
    assert db.verify_chain(conn)["ok"]
