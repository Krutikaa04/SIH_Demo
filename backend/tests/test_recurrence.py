"""Aftercare uses recorded chronology and never changes the complaint records."""
import hashlib
import sqlite3
from datetime import timedelta

import pytest
from fastapi import HTTPException

from app import db, recurrence, roles

HERO = "1-4520311"
CATEGORY = "Faculty Deficiency"


def senior():
    return roles.Ctx(role="SENIOR", region="", persona=roles.PERSONAS["SENIOR"])


@pytest.fixture
def records(conn):
    conn.execute("DELETE FROM action_history")
    conn.execute("DELETE FROM cases")
    today = db.now(conn).date()

    def create(case_id, received_days, *, closed_days=None, category=CATEGORY,
               institution=HERO, bureau="RB", final_action=True):
        received = str(today - timedelta(days=received_days))
        disposed = str(today - timedelta(days=closed_days)) if closed_days is not None else None
        conn.execute("INSERT INTO cases(case_id,institution_id,category,bureau_code,status,received_on,disposed_on,outcome) "
                     "VALUES(?,?,?,?,?,?,?,?)", (case_id, institution, category, bureau,
                     "Disposed" if disposed else "Received", received, disposed,
                     "Institution supplied a compliance reply" if disposed else None))
        db.append_action(conn, case_id, received + "T10:00:00", "OFF-RB-01", "Officer", bureau,
                         "RECEIVED", remarks="Complaint recorded")
        if disposed and final_action:
            db.append_action(conn, case_id, disposed + "T11:00:00", "OFF-RB-01", "Officer", bureau,
                             "DISPOSE", remarks="Compliance reply examined; file closed")
        conn.commit()
        return case_id

    return create


def test_seeded_hero_has_evidence_and_116_day_gap(client, as_role):
    response = client.get(f"/api/institutions/{HERO}/aftercare", headers=as_role("SENIOR"))
    assert response.status_code == 200
    report = response.json()
    assert report["institution_id"] == HERO
    assert report["institution"]["aicte_id"] == HERO
    assert report["scope"] == {"role": "SENIOR", "region": ""}
    row = next(item for item in report["items"] if item["category"] == CATEGORY)
    assert row["elapsed_days"] == 116
    assert row["label"] == "New concern after closure"
    assert row["previous"]["outcome"]
    assert row["previous"]["final_action"]["seq"] > 1
    assert row["previous"]["final_action"]["hash"]
    assert row["current"]["url"] == "/cases/" + row["current"]["case_id"]
    assert row["previous"]["url"] == "/cases/" + row["previous"]["case_id"]
    assert "do not establish a repeated violation" in report["limitation"]


def test_each_open_case_uses_only_latest_preceding_closure(conn, records):
    records("OLD/1", 200, closed_days=150)
    records("RECENT/1", 100, closed_days=80)
    records("NEW/1", 20, bureau="PGRC")
    records("NEW/2", 15, bureau="AB")
    report = recurrence.aftercare(conn, HERO, senior())
    assert report["total"] == 2
    assert {row["previous"]["case_id"] for row in report["items"]} == {"RECENT/1"}
    assert {row["elapsed_days"] for row in report["items"]} == {60, 65}
    assert {row["current"]["case_id"] for row in report["items"]} == {"NEW/1", "NEW/2"}


def test_later_closure_does_not_hide_valid_earlier_one(conn, records):
    records("OLD/1", 200, closed_days=150)
    records("LATER/1", 60, closed_days=5)
    records("NEW/1", 20)
    row = recurrence.aftercare(conn, HERO, senior())["items"][0]
    assert row["previous"]["case_id"] == "OLD/1"
    assert row["elapsed_days"] == 130


@pytest.mark.parametrize("received_days", [80, 81, 150])
def test_same_day_or_earlier_receipt_is_not_aftercare(conn, records, received_days):
    records("OLD/1", 200, closed_days=80)
    records("NEW/1", received_days)
    assert recurrence.aftercare(conn, HERO, senior())["items"] == []


def test_category_match_is_exact_and_institution_isolated(conn, records):
    other = conn.execute("SELECT aicte_id FROM institutions WHERE aicte_id!=? LIMIT 1", (HERO,)).fetchone()[0]
    records("OLD/1", 200, closed_days=80)
    records("CASE/OTHER-CATEGORY", 20, category="Academic Quality")
    records("CASE/CASE-MISMATCH", 20, category="faculty deficiency")
    records("CASE/OTHER-INSTITUTION", 20, institution=other)
    assert recurrence.aftercare(conn, HERO, senior())["items"] == []


def test_closed_current_case_is_not_an_open_concern(conn, records):
    records("OLD/1", 200, closed_days=80)
    records("NEW/1", 20, closed_days=10)
    assert recurrence.aftercare(conn, HERO, senior())["items"] == []


@pytest.mark.parametrize("mutation", [
    "UPDATE cases SET disposed_on='not-a-date' WHERE case_id='OLD/1'",
    "UPDATE cases SET disposed_on='2999-01-01' WHERE case_id='OLD/1'",
    "UPDATE cases SET received_on='2999-01-01' WHERE case_id='OLD/1'",
    "UPDATE cases SET received_on='2026-99-99' WHERE case_id='OLD/1'",
    "UPDATE action_history SET ts='invalid' WHERE case_id='OLD/1' AND action_type='DISPOSE'",
    "UPDATE action_history SET ts='2026-01-01T11:00:00+05:30' WHERE case_id='OLD/1' AND action_type='DISPOSE'",
    "UPDATE action_history SET ts='1999-01-01T11:00:00' WHERE case_id='OLD/1' AND action_type='DISPOSE'",
    "DELETE FROM action_history WHERE case_id='OLD/1' AND action_type='DISPOSE'",
])
def test_invalid_closure_evidence_is_excluded(conn, records, mutation):
    records("OLD/1", 200, closed_days=80)
    records("NEW/1", 20)
    conn.execute(mutation)
    conn.commit()
    report = recurrence.aftercare(conn, HERO, senior())
    assert report["items"] == []
    assert report["summary"]["excluded_records"] == 1


def test_disposal_before_original_receipt_is_excluded(conn, records):
    records("OLD/1", 80, closed_days=100)
    records("NEW/1", 20)
    assert recurrence.aftercare(conn, HERO, senior())["items"] == []


@pytest.mark.parametrize("kind", ["REMARK", "COORDINATION", "COMMITMENT_CREATED", "COMMITMENT_COMPLETED"])
def test_later_annotations_preserve_recorded_disposal(conn, records, kind):
    records("OLD/1", 200, closed_days=80)
    records("NEW/1", 20)
    db.append_action(conn, "OLD/1", db.iso(db.now(conn) - timedelta(days=70)), "OFF-RB-01", "Officer", "RB",
                     kind, remarks="Later supporting evidence")
    conn.commit()
    result = recurrence.aftercare(conn, HERO, senior())
    assert len(result["items"]) == 1
    assert result["items"][0]["previous"]["final_action"]["remarks"] == "Compliance reply examined; file closed"


@pytest.mark.parametrize("received", ["invalid", "2999-01-01", "2026-W01-1", None])
def test_invalid_current_receipt_is_excluded(conn, records, received):
    records("OLD/1", 200, closed_days=80)
    records("NEW/1", 20)
    conn.execute("UPDATE cases SET received_on=? WHERE case_id='NEW/1'", (received,))
    conn.commit()
    assert recurrence.aftercare(conn, HERO, senior())["items"] == []


@pytest.mark.parametrize("region", ["", "Unknown", "western", " Western "])
def test_invalid_regional_identity_fails_closed(client, corrupt_regional, region):
    response = client.get(f"/api/institutions/{HERO}/aftercare", headers=corrupt_regional(region))
    assert response.status_code == 403
    assert "items" not in response.json()


def test_valid_region_can_only_read_its_institution(client, as_role):
    assert client.get(f"/api/institutions/{HERO}/aftercare", headers=as_role("REGIONAL", "Western")).status_code == 200
    response = client.get(f"/api/institutions/{HERO}/aftercare", headers=as_role("REGIONAL", "Southern"))
    assert response.status_code == 403
    assert "Sahyadri" not in response.text


def test_unknown_institution_is_404(client, as_role):
    assert client.get("/api/institutions/unknown/aftercare", headers=as_role("SENIOR")).status_code == 404


def test_empty_history_is_explicit(conn, records):
    report = recurrence.aftercare(conn, HERO, senior())
    assert report["total"] == 0
    assert report["items"] == []
    assert report["summary"] == {"open_cases_checked": 0, "valid_closures": 0, "excluded_records": 0}


def test_reads_do_not_change_database_or_audit_chain(client, conn, db_path, as_role):
    sessions = [as_role(role, region) for role, region in [("SENIOR", ""), ("RB", ""), ("REGIONAL", "Western")]]
    before = hashlib.sha256(db_path.read_bytes()).hexdigest()
    before_dump = list(conn.iterdump())
    before_chain = db.verify_chain(conn)
    for headers in sessions:
        assert client.get(f"/api/institutions/{HERO}/aftercare", headers=headers).status_code == 200
    assert list(conn.iterdump()) == before_dump
    assert db.verify_chain(conn) == before_chain
    assert hashlib.sha256(db_path.read_bytes()).hexdigest() == before


def test_connection_enforces_read_only_mode(db_path):
    dependency = recurrence.read_connection()
    conn = next(dependency)
    try:
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            conn.execute("UPDATE settings SET value='99' WHERE key='clock_offset_days'")
    finally:
        dependency.close()


def test_missing_database_returns_service_unavailable(tmp_path, monkeypatch):
    path = tmp_path / "never-created.db"
    monkeypatch.setattr(db, "DB_PATH", str(path))
    with pytest.raises(HTTPException) as exc:
        next(recurrence.read_connection())
    assert exc.value.status_code == 503
    assert not path.exists()


def test_busy_reset_returns_service_unavailable(monkeypatch):
    monkeypatch.setattr(db.READY, "wait", lambda timeout: False)
    with pytest.raises(HTTPException) as exc:
        next(recurrence.read_connection())
    assert exc.value.status_code == 503
