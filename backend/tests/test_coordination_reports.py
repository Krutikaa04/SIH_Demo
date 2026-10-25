"""Recorded outcomes must reflect explicit actions within the selected case cohort."""
import csv
import io
import json

import pytest

from app import db


def report(client, as_role, role="SENIOR", region=None, query=""):
    response = client.get("/api/reports/coordination" + query, headers=as_role(role, region))
    assert response.status_code == 200
    return response.json()


def values(data):
    return {r["key"]: r["value"] for r in data["rows"]}


@pytest.fixture
def hero(client, as_role):
    clusters = client.get("/api/overlaps", headers=as_role("SENIOR")).json()["items"]
    return next(c for c in clusters if c["institution"]["aicte_id"] == "1-4520311")


def review(client, as_role, hero, decision="CONFIRMED"):
    result = client.post(f"/api/overlaps/{hero['pairs'][0]['id']}/review", headers=as_role("SENIOR"),
                         json={"decision": decision, "rationale": "Checked both case records"})
    assert result.status_code == 200


def room(client, as_role, hero, outcome=None):
    result = client.post("/api/rooms", headers=as_role("SENIOR"), json={"cluster_id": hero["cluster_id"]})
    assert result.status_code == 200
    data = result.json()
    if outcome:
        result = client.post(f"/api/rooms/{data['id']}/decision", headers=as_role("SENIOR"),
                             json={"outcome": outcome, "lead_bureau": "RB", "note": "One coordinated response"})
        assert result.status_code == 200
        data = result.json()
    return data


def test_empty_measured_report_uses_no_fabricated_savings(client, as_role):
    result = report(client, as_role)
    metrics = values(result)
    assert metrics["reviewed_pairs"] == metrics["recorded_decisions"] == metrics["pending_followers"] == 0
    assert metrics["median_decision_days"] is None
    assert result["evidence"] == []
    assert len(result["summary"]) == 4
    assert "not measured hours saved" in result["methodology"]
    assert all(row["rooms"] == 0 for row in result["chart"]["rows"])


def test_review_deduplicates_both_ledgers_and_survives_room_decision(client, as_role, hero):
    review(client, as_role, hero)
    assert values(report(client, as_role))["reviewed_pairs"] == 1
    room(client, as_role, hero, "MERGE")
    metrics = values(report(client, as_role))
    assert metrics["reviewed_pairs"] == metrics["confirmed_pairs"] == 1
    assert metrics["merged_rooms"] == metrics["recorded_decisions"] == 1
    assert metrics["pending_followers"] == 2


def test_only_latest_explicit_review_is_counted(client, as_role, hero):
    for decision in ("CONFIRMED", "REJECTED", "DEFERRED"):
        review(client, as_role, hero, decision)
    metrics = values(report(client, as_role))
    assert metrics["reviewed_pairs"] == metrics["deferred_pairs"] == 1
    assert metrics["confirmed_pairs"] == metrics["rejected_pairs"] == 0


def test_creating_a_room_is_not_an_officer_review(client, as_role, hero):
    room(client, as_role, hero)
    metrics = values(report(client, as_role))
    assert metrics["reviewed_pairs"] == 0
    assert metrics["open_rooms"] == 1


def test_manual_link_metadata_does_not_count_as_an_explicit_review(client, as_role, conn):
    by_inst = {}
    for c in db.rows(conn, "SELECT case_id,institution_id,bureau_code FROM cases WHERE cluster_id IS NULL AND status!='Disposed' ORDER BY case_id"):
        by_inst.setdefault(c["institution_id"], []).append(c)
    a, b = next((a, b) for group in by_inst.values() for a in group for b in group if a["bureau_code"] != b["bureau_code"])
    response = client.post("/api/links", headers=as_role("SENIOR"),
                           json={"case_a": a["case_id"], "case_b": b["case_id"], "rationale": "Shared case files"})
    assert response.status_code == 200
    assert values(report(client, as_role))["reviewed_pairs"] == 0


@pytest.mark.parametrize("outcome,key", [("MERGE", "merged_rooms"), ("RESOLVE", "resolved_rooms"), ("KEEP_SEPARATE", "separate_rooms")])
def test_distinct_room_outcomes_do_not_dispose_cases(client, as_role, hero, conn, outcome, key):
    before = conn.execute("SELECT COUNT(*) FROM cases WHERE status='Disposed'").fetchone()[0]
    item = room(client, as_role, hero, outcome)
    client.post(f"/api/rooms/{item['id']}/decision", headers=as_role("SENIOR"),
                json={"outcome": outcome, "lead_bureau": "RB", "note": "Reaffirmed"})
    data = report(client, as_role)
    metrics = values(data)
    assert metrics[key] == metrics["recorded_decisions"] == 1
    assert len(data["evidence"]) == 1
    assert conn.execute("SELECT COUNT(*) FROM cases WHERE status='Disposed'").fetchone()[0] == before
    if outcome != "MERGE":
        assert metrics["pending_followers"] == 0


def test_followers_are_current_selected_open_cases(client, as_role, hero, conn):
    item = room(client, as_role, hero, "MERGE")
    follower = next(c for c in item["cases"] if c["bureau"] != "RB")
    conn.execute("UPDATE cases SET status='Disposed' WHERE case_id=?", (follower["case_id"],))
    conn.commit()
    assert values(report(client, as_role))["pending_followers"] == 1
    assert values(report(client, as_role, query="?bureau=RB"))["pending_followers"] == 0
    filtered = report(client, as_role, query="?bureau=PGRC")
    assert all(c["label"].startswith("PGRC/") for e in filtered["evidence"] for c in e["cases"])


@pytest.mark.parametrize("end", [None, "broken-date", "2020-01-01T00:00:00"])
def test_invalid_decision_times_are_excluded(client, as_role, hero, conn, end):
    item = room(client, as_role, hero, "MERGE")
    conn.execute("UPDATE coordination_rooms SET created_at='2026-01-01T00:00:00',resolved_at=? WHERE id=?", (end, item["id"]))
    conn.commit()
    metrics = values(report(client, as_role))
    assert metrics["recorded_decisions"] == 1
    assert metrics["excluded_timings"] == 1
    assert metrics["median_decision_days"] is None


def test_decision_duration_uses_elapsed_calendar_days(client, as_role, hero, conn):
    item = room(client, as_role, hero, "RESOLVE")
    conn.execute("UPDATE coordination_rooms SET created_at='2026-01-01T00:00:00Z',resolved_at='2026-01-03T12:00:00+00:00' WHERE id=?", (item["id"],))
    conn.commit()
    assert values(report(client, as_role))["median_decision_days"] == 2.5


def test_invalid_decision_json_is_flagged_without_inventing_outcomes(client, as_role, hero, conn):
    item = room(client, as_role, hero)
    conn.execute("UPDATE coordination_rooms SET status='MERGED',decision='invalid' WHERE id=?", (item["id"],))
    conn.commit()
    metrics = values(report(client, as_role))
    assert metrics["invalid_decisions"] == 1
    assert metrics["recorded_decisions"] == metrics["pending_followers"] == 0


def test_regional_and_received_cohort_filters_cover_all_evidence(client, as_role, hero):
    review(client, as_role, hero)
    item = room(client, as_role, hero, "MERGE")
    for data in [report(client, as_role, "REGIONAL", "Northern"), report(client, as_role, query="?date_from=2099-01-01")]:
        assert values(data)["recorded_decisions"] == values(data)["reviewed_pairs"] == 0
        assert data["evidence"] == data["reviews"] == []
        assert item["id"] not in json.dumps(data)
    rb = values(report(client, as_role, query="?bureau=RB"))
    assert rb["recorded_decisions"] == 1
    assert rb["reviewed_pairs"] == 0


@pytest.mark.parametrize("region", [None, "Not a region"])
@pytest.mark.parametrize("format", ["json", "csv"])
def test_regional_reports_fail_closed_without_a_valid_region(client, corrupt_regional, region, format):
    response = client.get(f"/api/reports/coordination?format={format}", headers=corrupt_regional(region))
    assert response.status_code == 400
    assert "valid region" in response.json()["detail"]


def test_csv_exports_the_same_metrics_and_scoped_room_evidence(client, as_role, hero):
    item = room(client, as_role, hero, "MERGE")
    data = report(client, as_role)
    response = client.get("/api/reports/coordination?format=csv", headers=as_role("SENIOR"))
    assert response.status_code == 200
    rows = list(csv.reader(io.StringIO(response.text.lstrip("\ufeff"))))
    actual = {r[0]: r[1] for r in rows[2:2 + len(data["rows"])]}
    for row in data["rows"]:
        assert actual[row["measure"]] == (str(row["value"]) if row["value"] is not None else "")
    assert item["id"] in response.text
    hidden = client.get("/api/reports/coordination?format=csv", headers=as_role("REGIONAL", "Northern"))
    assert hidden.status_code == 200
    assert item["id"] not in hidden.text


@pytest.mark.parametrize("prefix", ["=", "+", "-", "@", " \t=", "\r@", "\n+", "\x00="])
def test_csv_neutralizes_formula_prefixes_in_room_evidence(client, as_role, hero, conn, prefix):
    item = room(client, as_role, hero, "MERGE")
    value = prefix + "1+1"
    conn.execute("UPDATE coordination_rooms SET lead_bureau=? WHERE id=?", (value, item["id"]))
    conn.commit()
    response = client.get("/api/reports/coordination?format=csv", headers=as_role("SENIOR"))
    assert response.status_code == 200
    rows = list(csv.reader(io.StringIO(response.text.lstrip("\ufeff"))))
    evidence = next(row for row in rows if row and row[0] == item["id"])
    assert evidence[2] == "'" + value
    assert evidence[4] == "3"


@pytest.mark.parametrize("decision", [None, ""])
@pytest.mark.parametrize("status", ["MERGED", "RESOLVED"])
def test_completed_rooms_without_decision_records_need_attention(client, as_role, hero, conn, status, decision):
    item = room(client, as_role, hero)
    conn.execute("UPDATE coordination_rooms SET status=?,decision=? WHERE id=?", (status, decision, item["id"]))
    conn.commit()
    metrics = values(report(client, as_role))
    assert metrics["invalid_decisions"] == 1
    assert metrics["recorded_decisions"] == metrics["pending_followers"] == 0
