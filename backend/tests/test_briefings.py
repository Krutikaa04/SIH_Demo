"""Executable coordination recommendations, honest counts and regional evidence isolation."""
import json
from datetime import timedelta
from urllib.parse import unquote

import pytest
from fastapi import HTTPException

from app import briefings, db, roles


@pytest.fixture
def briefing_db(conn):
    for table in ("room_cases", "room_comments", "coordination_rooms", "overlap_pairs", "documents", "action_history", "cases", "institutions"):
        conn.execute(f"DELETE FROM {table}")
    conn.commit()
    return conn


def institution(conn, iid="INST-W", region="Western"):
    conn.execute("INSERT OR IGNORE INTO institutions(aicte_id,name,region,city) VALUES(?,?,?,?)",
                 (iid, f"Test Institute {iid}", region, "Test City"))
    return iid


def case(conn, cid, iid="INST-W", bureau="RB", due_in=20, status="Under Process", transfers=0, level=0):
    today = db.now(conn).date()
    conn.execute("INSERT INTO cases(case_id,institution_id,bureau_code,origin_bureau,status,received_on,"
                 "due_date,sla_days,category,severity,transfer_count,escalation_level) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                 (cid, iid, bureau, bureau, status, str(today - timedelta(days=40)),
                  str(today + timedelta(days=due_in)), 60, "Fees", 3, transfers, level))
    return cid


def pair(conn, cluster, a, b, iid="INST-W", status="OPEN"):
    conn.execute("INSERT INTO overlap_pairs(id,cluster_id,case_a,case_b,institution_id,status,score,band,"
                 "breakdown,explanation) VALUES(?,?,?,?,?,?,90,'HIGH','[]','Test evidence')",
                 (f"PAIR-{cluster}", cluster, a, b, iid, status))
    conn.execute("UPDATE cases SET cluster_id=? WHERE case_id IN (?,?)", (cluster, a, b))


def room(conn, rid, ids, iid="INST-W", state="OPEN", outcome=None, lead="RB"):
    conn.execute("INSERT INTO coordination_rooms(id,cluster_id,institution_id,lead_bureau,status,decision,created_at) "
                 "VALUES(?,?,?,?,?,?,?)", (rid, f"CL-{rid}", iid, lead, state,
                                          json.dumps({"outcome": outcome}) if outcome else None,
                                          db.iso(db.now(conn))))
    for cid in ids:
        conn.execute("INSERT INTO room_cases VALUES(?,?)", (rid, cid))
        conn.execute("UPDATE cases SET room_id=? WHERE case_id=?", (rid, cid))


def actions(conn):
    return briefings.generate_executive_briefing(conn)["action_agenda"]


def test_fresh_seed_has_an_actionable_agenda_without_preexisting_rooms(conn):
    result = briefings.generate_executive_briefing(conn)
    assert result["active_rooms"] == conn.execute(
        "SELECT COUNT(*) FROM coordination_rooms WHERE status='OPEN'").fetchone()[0]
    assert result["region"] == ""
    overlap_reviews = [item for item in result["action_agenda"] if item["kind"] == "REVIEW_OVERLAP"]
    assert overlap_reviews
    for review in overlap_reviews:
        case_ids = [item["label"] for item in review["evidence"] if item["kind"] == "case"]
        assert len(case_ids) >= 2
        assert all(db.one(conn, "SELECT status FROM cases WHERE case_id=?", (cid,))["status"] != "Disposed"
                   for cid in case_ids)


def test_prioritizes_overdue_coordination_then_due_soon_then_other_reviews(briefing_db):
    conn = briefing_db
    institution(conn)
    pair(conn, "CL-NEW", case(conn, "RB/2026/00001", due_in=-3),
         case(conn, "PGRC/2026/00002", bureau="PGRC", due_in=-2))
    room(conn, "ROOM-OPEN", [case(conn, "RB/2026/00003", due_in=-1),
                             case(conn, "AB/2026/00004", bureau="AB")])
    room(conn, "ROOM-MERGED", [case(conn, "RB/2026/00005"),
                               case(conn, "VIG/2026/00006", bureau="VIG", due_in=3)],
         state="MERGED", outcome="MERGE")
    case(conn, "LC/2026/00007", bureau="LC", transfers=4)
    result = briefings.generate_executive_briefing(conn)
    agenda = result["action_agenda"]
    assert [item["kind"] for item in agenda] == ["REVIEW_OVERLAP", "DECIDE_ROOM", "FOLLOW_UP_MERGE", "FIX_OWNERSHIP"]
    assert [item["urgency"] for item in agenda] == ["OVERDUE", "OVERDUE", "DUE_SOON", "REVIEW"]
    assert [item["rank"] for item in agenda] == [1, 2, 3, 4]
    assert agenda[0]["next_action"]["url"] == "/overlaps?open=CL-NEW"
    assert agenda[0]["owner"]["bureau"] is None
    assert agenda[1]["owner"]["bureau"] == "RB"
    assert agenda[2]["counts"]["open_cases"] == 1
    assert agenda[2]["next_action"]["url"] == "/rooms/ROOM-MERGED"
    assert agenda[3]["owner"]["bureau"] == "LC"
    assert result["active_rooms"] == 1
    assert result["overdue_rate"] == round(3 / 7 * 100, 1)
    assert agenda == actions(conn)


def test_no_agenda_for_empty_scope_and_no_fabricated_escalations(briefing_db):
    result = briefings.generate_executive_briefing(briefing_db)
    assert result["action_agenda"] == []
    assert result["citations"] == {}
    assert result["total_cases"] == result["pending_cases"] == result["overdue_cases"] == result["active_rooms"] == 0
    assert result["overdue_rate"] == 0
    assert "Level 2: 0; Level 3 or above: 0" in result["sections"][-1]["content"]
    assert "No Coordination Rooms" in result["sections"][1]["content"]
    assert "No institution complaints" in result["sections"][2]["content"]


def test_due_today_is_due_soon_and_disposed_cases_do_not_inflate_overdue_rate(briefing_db):
    conn = briefing_db
    institution(conn)
    case(conn, "RB/2026/OPEN", due_in=-1, level=2)
    case(conn, "RB/2026/TODAY", due_in=0, transfers=3)
    case(conn, "RB/2026/CLOSED", due_in=-10, status="Disposed", level=3)
    result = briefings.generate_executive_briefing(conn)
    assert result["total_cases"] == 3 and result["pending_cases"] == 2
    assert result["overdue_cases"] == 1 and result["overdue_rate"] == 50
    assert "50.0% of open cases" in result["sections"][0]["content"]
    assert result["action_agenda"][0]["urgency"] == "DUE_SOON"
    assert "Level 2: 1; Level 3 or above: 0" in result["sections"][-1]["content"]


def test_opening_a_room_replaces_overlap_review_and_recording_decision_removes_it(briefing_db, client, as_role):
    conn = briefing_db
    institution(conn)
    a, b = case(conn, "RB/2026/A"), case(conn, "PGRC/2026/B", bureau="PGRC")
    pair(conn, "CL-A", a, b)
    assert [a["kind"] for a in actions(conn)] == ["REVIEW_OVERLAP"]
    room(conn, "ROOM-A", [a, b])
    conn.execute("UPDATE coordination_rooms SET cluster_id='CL-A' WHERE id='ROOM-A'")
    conn.commit()
    assert [a["kind"] for a in actions(conn)] == ["DECIDE_ROOM"]
    response = client.post("/api/rooms/ROOM-A/decision", headers=as_role("SENIOR"),
                           json={"outcome": "KEEP_SEPARATE", "note": "Different grievances verified"})
    assert response.status_code == 200
    assert actions(conn) == []
    assert briefings.generate_executive_briefing(conn)["active_rooms"] == 0


def test_merged_followup_uses_only_pending_followers_and_disappears_when_closed(briefing_db):
    conn = briefing_db
    institution(conn)
    lead = case(conn, "RB/2026/LEAD", due_in=-10)
    follower = case(conn, "AB/2026/FOLLOW", bureau="AB", due_in=4)
    closed = case(conn, "PGRC/2026/CLOSED", bureau="PGRC", status="Disposed", due_in=-15)
    room(conn, "ROOM-M", [lead, follower, closed], state="MERGED", outcome="MERGE")
    action = actions(conn)[0]
    assert action["kind"] == "FOLLOW_UP_MERGE" and action["urgency"] == "DUE_SOON"
    assert action["counts"]["overdue_cases"] == 0
    assert {e["label"] for e in action["evidence"] if e["kind"] == "case"} == {follower}
    conn.execute("UPDATE cases SET status='Disposed' WHERE case_id=?", (follower,))
    assert actions(conn) == []


@pytest.mark.parametrize("state,outcome", [("RESOLVED", "KEEP_SEPARATE"), ("RESOLVED", "RESOLVE"),
                                           ("MERGED", "KEEP_SEPARATE"), ("MERGED", None)])
def test_never_infers_a_merge_followup_from_other_or_missing_decisions(briefing_db, state, outcome):
    conn = briefing_db
    institution(conn)
    room(conn, "ROOM-X", [case(conn, "RB/2026/A"), case(conn, "AB/2026/B", bureau="AB")],
         state=state, outcome=outcome)
    assert actions(conn) == []


def test_completed_cases_and_inactive_pair_reviews_are_excluded(briefing_db):
    conn = briefing_db
    institution(conn)
    a = case(conn, "RB/2026/A", status="Disposed", transfers=5)
    b = case(conn, "AB/2026/B", bureau="AB")
    pair(conn, "CL-OLD", a, b)
    room(conn, "ROOM-DONE", [a])
    assert actions(conn) == []
    conn.execute("UPDATE cases SET status='Under Process' WHERE case_id=?", (a,))
    conn.execute("UPDATE overlap_pairs SET status='REJECTED'")
    conn.execute("UPDATE cases SET transfer_count=0")
    conn.execute("DELETE FROM coordination_rooms")
    assert actions(conn) == []


@pytest.mark.parametrize("status", ["RESOLVED", "DISMISSED", "REJECTED"])
def test_inactive_cluster_pairs_do_not_reopen_coordination_work(briefing_db, status):
    conn = briefing_db
    institution(conn)
    pair(conn, "CL-DONE", case(conn, "RB/2026/A"), case(conn, "LC/2026/B", bureau="LC"), status=status)
    assert actions(conn) == []


def test_regional_api_excludes_other_regions_from_every_count_action_and_citation(briefing_db, client, as_role):
    conn = briefing_db
    institution(conn)
    institution(conn, "INST-N", "Northern")
    western = case(conn, "RB/2026/WEST", transfers=3)
    room(conn, "ROOM-WEST", [western])
    northern = case(conn, "VIG/2026/NORTH", iid="INST-N", bureau="VIG", due_in=-100, transfers=10)
    north_other = case(conn, "LC/2026/NORTH", iid="INST-N", bureau="LC")
    pair(conn, "CL-NORTH", northern, north_other, iid="INST-N")
    room(conn, "ROOM-NORTH", [northern, north_other], iid="INST-N")
    conn.commit()
    response = client.get("/api/briefings/executive", headers=as_role("REGIONAL", "Western"))
    assert response.status_code == 200
    result = response.json()
    assert result["scope"] == "Western region"
    assert result["region"] == "Western"
    assert result["total_cases"] == result["pending_cases"] == result["active_rooms"] == 1
    assert result["overdue_cases"] == 0
    serialized = json.dumps(result)
    assert "NORTH" not in serialized and "INST-N" not in serialized and "Northern" not in serialized
    for item in result["action_agenda"]:
        for evidence in item["evidence"]:
            if evidence["kind"] == "case":
                assert evidence["label"] == western
    assert "[RB/2026/WEST]" in result["citations"]
    assert client.get("/api/briefings/executive", headers=as_role("SENIOR")).json()["total_cases"] == 3
    empty_region = client.get("/api/briefings/executive", headers=as_role("REGIONAL", "Eastern")).json()
    assert empty_region["total_cases"] == empty_region["active_rooms"] == 0
    assert empty_region["region"] == "Eastern"
    assert empty_region["citations"] == {} and empty_region["action_agenda"] == []


@pytest.mark.parametrize("region", ["", "Unknown", "western"])
def test_regional_missing_or_unknown_region_fails_closed(briefing_db, client, as_role, region):
    conn = briefing_db
    institution(conn)
    case(conn, "RB/2026/PRIVATE", transfers=3)
    conn.commit()
    response = client.get("/api/briefings/executive", headers=as_role("REGIONAL", region))
    assert response.status_code == 403
    assert "recognized region" in response.json()["detail"]
    assert "PRIVATE" not in response.text
    with pytest.raises(HTTPException) as exc:
        briefings.generate_executive_briefing(conn, roles.Ctx(role="REGIONAL", region=region))
    assert exc.value.status_code == 403


def test_slash_case_citations_and_ownership_links_open_the_actual_case(briefing_db, client, as_role):
    conn = briefing_db
    institution(conn)
    cid = case(conn, "PGRC/2026/00042", bureau="PGRC", transfers=3, due_in=-1)
    conn.commit()
    result = client.get("/api/briefings/executive", headers=as_role("SENIOR")).json()
    link = result["citations"][f"[{cid}]"]
    assert link == "/cases/PGRC%2F2026%2F00042"
    assert result["action_agenda"][0]["next_action"]["url"] == link
    response = client.get("/api" + link, headers=as_role("SENIOR"))
    assert response.status_code == 200 and response.json()["case_id"] == cid
    assert unquote(result["action_agenda"][0]["evidence"][0]["url"]).endswith(cid)
