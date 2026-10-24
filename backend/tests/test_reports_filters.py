"""Unit tests for reports filtering, status-wise report, and institution history CSV (Issue #15)."""
import pytest
from app import db, reports, services


def test_status_report_structure_and_totals(client, as_role):
    res = client.get("/api/reports/status", headers=as_role("SENIOR"))
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "status"
    assert "rows" in data
    assert "columns" in data
    assert "chart" in data
    assert data["chart"]["stacked"] is True

    # Assert all statuses are present
    statuses = [r["status"] for r in data["rows"]]
    assert "Received" in statuses
    assert "Disposed" in statuses

    # Total of row totals must match total received
    total_cases = sum(r["total"] for r in data["rows"])
    assert total_cases == 300  # Seeded 300 cases

    # Bureau breakdown sum must equal total for each status row
    for r in data["rows"]:
        bureau_sum = r["rb"] + r["pgrc"] + r["ab"] + r["lc"] + r["vig"]
        assert bureau_sum == r["total"]


def test_report_filters_by_bureau(client, as_role):
    # Get total RB cases directly
    cases_res = client.get("/api/cases?bureau=RB&page_size=200", headers=as_role("SENIOR"))
    rb_count = cases_res.json()["total"]

    # Status report filtered by bureau=RB
    rep_res = client.get("/api/reports/status?bureau=RB", headers=as_role("SENIOR"))
    assert rep_res.status_code == 200
    rep_data = rep_res.json()
    assert rep_data["filters"]["bureau"] == "RB"
    total_in_report = sum(r["total"] for r in rep_data["rows"])
    assert total_in_report == rb_count
    # All non-RB bureaus should have 0 counts
    for r in rep_data["rows"]:
        assert r["pgrc"] == 0
        assert r["ab"] == 0
        assert r["lc"] == 0
        assert r["vig"] == 0
        assert r["rb"] == r["total"]


def test_report_filters_by_region(client, as_role):
    cases_res = client.get("/api/cases?region=Western&page_size=200", headers=as_role("SENIOR"))
    western_count = cases_res.json()["total"]

    rep_res = client.get("/api/reports/bureau?region=Western", headers=as_role("SENIOR"))
    assert rep_res.status_code == 200
    rep_data = rep_res.json()
    assert rep_data["filters"]["region"] == "Western"
    total_in_report = sum(r["total"] for r in rep_data["rows"])
    assert total_in_report == western_count


def test_report_date_filters_and_validation(client, as_role):
    # Filter with future dates (no matches) should return 0 rows/totals without crashing
    rep_res = client.get("/api/reports/status?date_from=2099-01-01&date_to=2099-12-31", headers=as_role("SENIOR"))
    assert rep_res.status_code == 200
    rep_data = rep_res.json()
    assert sum(r["total"] for r in rep_data["rows"]) == 0

    # Invalid date format should return 400
    bad_res = client.get("/api/reports/status?date_from=invalid-date", headers=as_role("SENIOR"))
    assert bad_res.status_code == 400
    assert "Invalid date_from format" in bad_res.json()["detail"]


def test_regional_role_scope_and_guard(client, as_role):
    # Regional role gets its own region automatically
    rep_res = client.get("/api/reports/bureau", headers=as_role("REGIONAL", "Northern"))
    assert rep_res.status_code == 200
    assert rep_res.json()["filters"]["region"] == "Northern"

    # Regional role attempting to widen/change region gets 400
    bad_res = client.get("/api/reports/bureau?region=Western", headers=as_role("REGIONAL", "Northern"))
    assert bad_res.status_code == 400


def test_status_report_csv_export(client, as_role):
    res = client.get("/api/reports/status?format=csv&bureau=RB", headers=as_role("SENIOR"))
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    content = res.text
    # Must have UTF-8 BOM
    assert content.startswith("\ufeff")
    # Must contain filter header and columns
    assert "bureau=RB" in content
    assert "Status" in content
    assert "Received" in content


def test_institution_history_csv_export(client, as_role, conn):
    # Pick an institution in Western region
    inst = db.one(conn, "SELECT aicte_id, name, region FROM institutions WHERE region='Western' LIMIT 1")
    assert inst is not None
    iid = inst["aicte_id"]

    # Senior management can download history CSV
    res = client.get(f"/api/institutions/{iid}/history.csv", headers=as_role("SENIOR"))
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    content = res.text
    assert content.startswith("\ufeff")
    assert inst["name"] in content
    assert "History events count" in content

    # Regional role matching region can download
    res_reg_ok = client.get(f"/api/institutions/{iid}/history.csv", headers=as_role("REGIONAL", "Western"))
    assert res_reg_ok.status_code == 200

    # Regional role from another region is blocked (403)
    res_reg_bad = client.get(f"/api/institutions/{iid}/history.csv", headers=as_role("REGIONAL", "Northern"))
    assert res_reg_bad.status_code == 403

    # Non-existent institution returns 404
    res_404 = client.get("/api/institutions/NON_EXISTENT_ID/history.csv", headers=as_role("SENIOR"))
    assert res_404.status_code == 404
