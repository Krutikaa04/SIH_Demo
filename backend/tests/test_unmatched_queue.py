"""Review queue for complaints whose institution cannot be matched (issue #14)."""
from urllib.parse import quote

import pytest

from app import db

GARBLED = "Zzyzx Quorlfplat Institute of Nothing"
DESCRIPTION = "Students report that the faculty positions are vacant and visiting teachers take the classes."


def complaint(role_body=None, **over):
    body = {"institution_name": GARBLED, "bureau": "RB", "category": "Faculty Deficiency", "description": DESCRIPTION,
            "severity": 3, "source": "Letter"}
    body.update(over)
    return body


def park(client, as_role, role="RB", **over):
    return client.post("/api/complaints", json=complaint(park_unmatched=True, **over), headers=as_role(role))


def queue(client, as_role, role="SENIOR", region=None, status="OPEN"):
    response = client.get(f"/api/unmatched?status={status}", headers=as_role(role, region))
    assert response.status_code == 200
    return response.json()


def an_institution(conn):
    return conn.execute("SELECT aicte_id,name FROM institutions ORDER BY aicte_id LIMIT 1").fetchone()


def case_count(conn):
    return conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]


# ---- parking -------------------------------------------------------------------------------

def test_unmatched_name_is_rejected_unless_parking_is_requested(client, as_role):
    response = client.post("/api/complaints", json=complaint(), headers=as_role("RB"))
    assert response.status_code == 422 and response.json()["detail"]["code"] == "UNRESOLVED_INSTITUTION"
    assert queue(client, as_role)["total"] == 0


def test_parking_stores_the_complaint_with_suggestions(conn, client, as_role):
    before = case_count(conn)
    response = park(client, as_role)
    assert response.status_code == 200
    out = response.json()
    assert out["status"] == "PARKED" and out["queue_id"].startswith("UNM-")
    assert case_count(conn) == before  # nothing entered the case table
    items = queue(client, as_role)["items"]
    assert [i["id"] for i in items] == [out["queue_id"]]
    item = items[0]
    assert item["status"] == "OPEN" and item["bureau"] == "RB" and item["institution_name"] == GARBLED
    assert item["complaint"]["category"] == "Faculty Deficiency"
    assert isinstance(item["suggestions"], list)
    assert item["created_by"]


def test_parking_the_same_complaint_twice_is_refused(client, as_role):
    assert park(client, as_role).status_code == 200
    again = park(client, as_role)
    assert again.status_code == 400 and "UNM-" in again.json()["detail"]
    assert queue(client, as_role)["total"] == 1


def test_parking_still_validates_the_complaint(client, as_role):
    assert park(client, as_role, category="Not a category").status_code == 400
    assert park(client, as_role, description="too short").status_code == 400
    assert queue(client, as_role)["total"] == 0


def test_a_matchable_complaint_is_registered_even_when_parking_is_requested(conn, client, as_role):
    inst = an_institution(conn)
    response = client.post("/api/complaints", json=complaint(park_unmatched=True, institution_name=inst["name"]),
                           headers=as_role("RB"))
    assert response.status_code == 200 and response.json()["case"]["case_id"]
    assert queue(client, as_role)["total"] == 0


def test_regional_office_cannot_park(client, as_role):
    assert park(client, as_role, role="REGIONAL", bureau="RB").status_code == 403


# ---- resolving -----------------------------------------------------------------------------

def test_resolve_creates_a_case_through_the_normal_pipeline(conn, client, as_role):
    queue_id = park(client, as_role).json()["queue_id"]
    inst = an_institution(conn)
    before = case_count(conn)
    response = client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": inst["aicte_id"]},
                           headers=as_role("RB"))
    assert response.status_code == 200
    out = response.json()
    case = out["case"]
    assert out["already_resolved"] is False and case_count(conn) == before + 1
    assert case["institution"]["aicte_id"] == inst["aicte_id"] and case["bureau"] == "RB"
    assert case["submitted_institution_name"] == GARBLED
    assert case["resolution"]["method"] == "MANUAL"
    history = [r["action_type"] for r in conn.execute(
        "SELECT action_type FROM action_history WHERE case_id=? ORDER BY seq", (case["case_id"],))]
    assert history == ["RECEIVED", "ASSIGNED", "INSTITUTION_MATCHED"]
    item = queue(client, as_role, status="RESOLVED")["items"][0]
    assert item["resolved_case_id"] == case["case_id"] and item["resolved_by"]
    assert queue(client, as_role)["total"] == 0
    assert db.verify_chain(conn)["ok"]


def test_resolve_runs_overlap_detection_and_alerts(conn, client, as_role):
    # a complaint about an institution that already has an open RB case of the same kind overlaps with it
    twin = conn.execute("SELECT institution_id,bureau_code,category,description FROM cases "
                        "WHERE status!='Disposed' AND cluster_id IS NOT NULL LIMIT 1").fetchone()
    other_bureau = next(b for b in ("RB", "PGRC", "AB", "LC", "VIG") if b != twin["bureau_code"])
    queue_id = park(client, as_role, role=other_bureau, bureau=other_bureau, category=twin["category"],
                    description=twin["description"] + " Reported again by parents.").json()["queue_id"]
    alerts_before = conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
    out = client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": twin["institution_id"]},
                      headers=as_role(other_bureau)).json()
    assert out["overlaps"], "the normal pipeline must score the new case against the institution's open cases"
    assert conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0] > alerts_before


def test_resolve_is_idempotent(conn, client, as_role):
    queue_id = park(client, as_role).json()["queue_id"]
    inst = an_institution(conn)
    first = client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": inst["aicte_id"]},
                        headers=as_role("RB")).json()
    before = case_count(conn)
    again = client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": inst["aicte_id"]},
                        headers=as_role("RB"))
    assert again.status_code == 200 and again.json()["already_resolved"] is True
    assert again.json()["case"]["case_id"] == first["case"]["case_id"] and case_count(conn) == before


def test_resolve_with_unknown_or_missing_institution_is_refused(conn, client, as_role):
    queue_id = park(client, as_role).json()["queue_id"]
    assert client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": "9-9999999"},
                       headers=as_role("RB")).status_code == 400
    assert client.post(f"/api/unmatched/{queue_id}/resolve", json={}, headers=as_role("RB")).status_code == 400
    assert client.post("/api/unmatched/UNM-9999/resolve", json={"institution_id": an_institution(conn)["aicte_id"]},
                       headers=as_role("SENIOR")).status_code == 404
    assert queue(client, as_role)["total"] == 1  # still waiting


def test_a_parked_payload_is_validated_again_on_resolve(conn, client, as_role):
    queue_id = park(client, as_role).json()["queue_id"]
    conn.execute("UPDATE unmatched_complaints SET payload=json_set(payload,'$.category','Not a category') WHERE id=?",
                 (queue_id,))
    conn.commit()
    response = client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": an_institution(conn)["aicte_id"]},
                           headers=as_role("RB"))
    assert response.status_code == 400
    assert queue(client, as_role)["total"] == 1


def test_resolve_keeps_the_receiving_bureau_when_senior_resolves(conn, client, as_role):
    queue_id = park(client, as_role, role="PGRC", bureau="PGRC").json()["queue_id"]
    out = client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": an_institution(conn)["aicte_id"]},
                      headers=as_role("SENIOR")).json()
    assert out["case"]["bureau"] == "PGRC"


# ---- discarding ----------------------------------------------------------------------------

def test_discard_needs_a_reason_and_keeps_an_audit_record(conn, client, as_role):
    queue_id = park(client, as_role).json()["queue_id"]
    assert client.delete(f"/api/unmatched/{queue_id}", headers=as_role("RB")).status_code == 422
    assert client.delete(f"/api/unmatched/{queue_id}?reason=%20%20", headers=as_role("RB")).status_code == 422
    done = client.delete(f"/api/unmatched/{queue_id}?reason={quote('Spam, no such institution')}", headers=as_role("RB"))
    assert done.status_code == 200 and done.json()["status"] == "DISCARDED"
    row = conn.execute("SELECT status,discard_reason,resolved_by,resolved_at FROM unmatched_complaints WHERE id=?",
                       (queue_id,)).fetchone()
    assert tuple(row)[0:2] == ("DISCARDED", "Spam, no such institution") and row["resolved_by"] and row["resolved_at"]
    assert queue(client, as_role)["total"] == 0
    assert queue(client, as_role, status="DISCARDED")["total"] == 1
    # discarding again is harmless; resolving a discarded item is a conflict
    assert client.delete(f"/api/unmatched/{queue_id}?reason=again", headers=as_role("RB")).status_code == 200
    assert client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": an_institution(conn)["aicte_id"]},
                       headers=as_role("RB")).status_code == 409


def test_a_resolved_item_cannot_be_discarded(conn, client, as_role):
    queue_id = park(client, as_role).json()["queue_id"]
    client.post(f"/api/unmatched/{queue_id}/resolve", json={"institution_id": an_institution(conn)["aicte_id"]},
                headers=as_role("RB"))
    assert client.delete(f"/api/unmatched/{queue_id}?reason=oops", headers=as_role("RB")).status_code == 409


# ---- permissions ---------------------------------------------------------------------------

def test_visibility_and_permission_matrix(conn, client, as_role):
    queue_id = park(client, as_role, role="RB").json()["queue_id"]
    body = {"institution_id": an_institution(conn)["aicte_id"]}
    assert [i["id"] for i in queue(client, as_role, "SENIOR")["items"]] == [queue_id]
    assert [i["id"] for i in queue(client, as_role, "RB")["items"]] == [queue_id]
    for role in ("PGRC", "AB", "LC", "VIG"):
        assert queue(client, as_role, role)["total"] == 0, role
        assert client.post(f"/api/unmatched/{queue_id}/resolve", json=body, headers=as_role(role)).status_code == 403, role
        assert client.delete(f"/api/unmatched/{queue_id}?reason=x", headers=as_role(role)).status_code == 403, role
    assert queue(client, as_role, "REGIONAL", "Western")["total"] == 0
    assert client.post(f"/api/unmatched/{queue_id}/resolve", json=body,
                       headers=as_role("REGIONAL", "Western")).status_code == 403
    assert client.delete(f"/api/unmatched/{queue_id}?reason=x", headers=as_role("REGIONAL", "Western")).status_code == 403
    assert queue(client, as_role)["total"] == 1  # nothing changed


def test_counts_and_status_filter(conn, client, as_role):
    first = park(client, as_role).json()["queue_id"]
    second = park(client, as_role, description=DESCRIPTION + " A second, different complaint.").json()["queue_id"]
    client.delete(f"/api/unmatched/{second}?reason=duplicate", headers=as_role("RB"))
    payload = queue(client, as_role, status="ALL")
    assert payload["counts"] == {"OPEN": 1, "RESOLVED": 0, "DISCARDED": 1} and payload["total"] == 2
    assert [i["id"] for i in queue(client, as_role)["items"]] == [first]
    assert client.get("/api/unmatched?status=BOGUS", headers=as_role("SENIOR")).status_code == 400


# ---- CSV import ----------------------------------------------------------------------------

CSV = ("institution_name,aicte_id,bureau,category,description,severity,source,received_on\n"
       "\"{good}\",,RB,Faculty Deficiency,\"Laboratory equipment is not working and the library has no current books.\",3,Letter,\n"
       f"{GARBLED},,RB,Faculty Deficiency,\"{DESCRIPTION}\",3,Letter,\n"
       "Narmada Govt College Lucknow,,RB,Not a category,\"This row has an invalid category on purpose.\",3,Letter,\n")


def import_csv(client, as_role, conn, dry_run, park_unmatched, role="SENIOR"):
    text = CSV.replace("{good}", an_institution(conn)["name"])
    return client.post("/api/complaints/import", json={"csv_text": text, "dry_run": dry_run, "park_unmatched": park_unmatched},
                       headers=as_role(role))


def test_csv_import_without_parking_skips_unmatched_rows(conn, client, as_role):
    out = import_csv(client, as_role, conn, dry_run=False, park_unmatched=False).json()
    assert out["counts"]["created"] == 1 and out["counts"]["needs_review"] == 1 and out["counts"]["parked"] == 0
    assert queue(client, as_role)["total"] == 0


def test_csv_import_parks_unmatched_rows_when_asked(conn, client, as_role):
    dry = import_csv(client, as_role, conn, dry_run=True, park_unmatched=True).json()
    assert dry["counts"]["needs_review"] == 1 and queue(client, as_role)["total"] == 0  # a dry run never writes
    out = import_csv(client, as_role, conn, dry_run=False, park_unmatched=True).json()
    assert out["counts"]["created"] == 1 and out["counts"]["parked"] == 1 and out["counts"]["error"] == 1
    parked = next(r for r in out["results"] if r["status"] == "parked")
    assert parked["queue_id"].startswith("UNM-")
    assert [i["id"] for i in queue(client, as_role)["items"]] == [parked["queue_id"]]


def test_regional_cannot_park_through_csv_import(conn, client, as_role):
    assert import_csv(client, as_role, conn, dry_run=False, park_unmatched=True, role="REGIONAL").status_code == 403


def test_the_table_survives_a_demo_reset(client, as_role):
    park(client, as_role)
    assert client.post("/api/admin/reset", headers=as_role("SENIOR")).status_code == 200
    assert queue(client, as_role)["total"] == 0
