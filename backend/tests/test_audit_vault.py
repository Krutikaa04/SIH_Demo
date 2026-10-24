"""Unit tests for the Audit Vault ledger, pagination, filters, and tamper verification (Issue #20)."""
import pytest
from app import db


def test_audit_ledger_default_structure_and_pagination(client, as_role):
    res = client.get("/api/audit/ledger", headers=as_role("SENIOR"))
    assert res.status_code == 200
    data = res.json()

    assert "items" in data
    assert "total" in data
    assert "page" in data
    assert "page_size" in data
    assert "action_counts" in data

    assert data["total"] > 1000  # Seeded database has ~1,200 action history events
    assert data["page"] == 1
    assert data["page_size"] == 50
    assert len(data["items"]) == 50

    # Verify item fields
    item = data["items"][0]
    for key in ("case_id", "seq", "ts", "action_type", "actor_bureau", "prev_hash", "hash", "institution_name"):
        assert key in item

    # Verify descending timestamp ordering
    timestamps = [it["ts"] for it in data["items"]]
    assert timestamps == sorted(timestamps, reverse=True)


def test_audit_ledger_filters(client, as_role, conn):
    # Pick a specific case
    case = db.one(conn, "SELECT case_id FROM cases LIMIT 1")
    cid = case["case_id"]

    # 1. Filter by case_id
    res_case = client.get(f"/api/audit/ledger?case_id={cid}", headers=as_role("SENIOR"))
    assert res_case.status_code == 200
    case_data = res_case.json()
    assert case_data["total"] >= 1
    assert all(it["case_id"] == cid for it in case_data["items"])

    # 2. Filter by action_type
    res_action = client.get("/api/audit/ledger?action_type=AUTO_ESCALATE", headers=as_role("SENIOR"))
    assert res_action.status_code == 200
    action_data = res_action.json()
    assert action_data["total"] >= 1
    assert all(it["action_type"] == "AUTO_ESCALATE" for it in action_data["items"])

    # 3. Filter by actor_bureau
    res_bureau = client.get("/api/audit/ledger?actor_bureau=RB", headers=as_role("SENIOR"))
    assert res_bureau.status_code == 200
    bureau_data = res_bureau.json()
    assert bureau_data["total"] >= 1
    assert all(it["actor_bureau"] == "RB" for it in bureau_data["items"])

    # 4. Out of range date filter returns 0 items cleanly
    res_date = client.get("/api/audit/ledger?date_from=2099-01-01&date_to=2099-12-31", headers=as_role("SENIOR"))
    assert res_date.status_code == 200
    assert res_date.json()["total"] == 0
    assert len(res_date.json()["items"]) == 0


def test_audit_ledger_page_size_cap(client, as_role):
    # Requesting > 200 items is capped at 200
    res = client.get("/api/audit/ledger?page_size=500", headers=as_role("SENIOR"))
    assert res.status_code == 200
    data = res.json()
    assert data["page_size"] == 200
    assert len(data["items"]) == 200


def test_audit_ledger_regional_scoping(client, as_role, conn):
    # Check total events for Western region institutions
    western_total = conn.execute("""
        SELECT COUNT(*)
        FROM action_history a
        JOIN cases c ON a.case_id = c.case_id
        JOIN institutions i ON c.institution_id = i.aicte_id
        WHERE i.region = 'Western'
    """).fetchone()[0]
    assert western_total > 0

    # Query ledger as REGIONAL Western
    res_reg = client.get("/api/audit/ledger?page_size=200", headers=as_role("REGIONAL", "Western"))
    assert res_reg.status_code == 200
    reg_data = res_reg.json()
    assert reg_data["total"] == western_total

    # Verify that every item belongs strictly to Western region
    for it in reg_data["items"]:
        assert it["region"] == "Western"


def test_tamper_detection_in_verify_and_ledger(client, as_role, conn):
    # Initially chain is valid
    res_verify = client.get("/api/audit/verify", headers=as_role("SENIOR"))
    assert res_verify.status_code == 200
    assert res_verify.json()["ok"] is True

    # Tamper with a record via admin tamper endpoint
    res_tamper = client.post("/api/admin/tamper", headers=as_role("SENIOR"))
    assert res_tamper.status_code == 200

    # Verification detects break
    res_verify_broken = client.get("/api/audit/verify", headers=as_role("SENIOR"))
    assert res_verify_broken.status_code == 200
    verify_data = res_verify_broken.json()
    assert verify_data["ok"] is False
    assert verify_data["first_break"] is not None

    broken_cid = verify_data["first_break"]["case_id"]
    broken_seq = verify_data["first_break"]["seq"]

    # Ledger returns the modified record
    res_ledger = client.get(f"/api/audit/ledger?case_id={broken_cid}", headers=as_role("SENIOR"))
    assert res_ledger.status_code == 200
    ledger_items = res_ledger.json()["items"]
    tampered_row = next((r for r in ledger_items if r["seq"] == broken_seq), None)
    assert tampered_row is not None
    assert tampered_row["remarks"] == "Complaint closed without any action"
