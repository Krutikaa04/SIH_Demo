"""Exercise role checks, encoded case IDs and coordination guards through HTTP."""
from urllib.parse import quote

import pytest

from app import services


def case_url(case_id, suffix=""):
    return f"/api/cases/{quote(case_id, safe='')}{suffix}"


def open_case(conn, bureau="RB", region=None):
    sql = services.CASE_SELECT + " WHERE c.bureau_code=? AND c.status!='Disposed'"
    params = [bureau]
    if region:
        sql += " AND i.region=?"
        params.append(region)
    return dict(conn.execute(sql + " LIMIT 1", params).fetchone())


@pytest.mark.parametrize("role,status", [("RB", 200), ("PGRC", 403), ("AB", 403)])
def test_bureau_can_only_act_on_own_case(client, conn, as_role, role, status):
    case = open_case(conn)
    response = client.post(case_url(case["case_id"], "/actions"), headers=as_role(role),
                           json={"type": "remark", "remarks": "Reviewed the file"})
    assert response.status_code == status


def test_regional_scope(client, conn, as_role):
    headers = as_role("REGIONAL", "Western")
    result = client.get("/api/cases?page_size=200", headers=headers)
    assert result.status_code == 200
    assert result.json()["items"]
    assert all(c["institution"]["region"] == "Western" for c in result.json()["items"])
    other = open_case(conn, region="Southern")
    assert client.get(case_url(other["case_id"]), headers=headers).status_code == 403
    assert client.post(case_url(other["case_id"], "/actions"), headers=headers,
                       json={"type": "remark", "remarks": "Outside region"}).status_code == 403


def test_senior_cannot_transfer(client, conn, as_role):
    case = open_case(conn)
    response = client.post(case_url(case["case_id"], "/actions"), headers=as_role("SENIOR"),
                           json={"type": "transfer", "to_bureau": "AB", "remarks": "Transfer"})
    assert response.status_code == 403


def test_coordination_acknowledgement_and_non_lead_decision(client, conn, as_role):
    cluster = next(c for c in services.clusters_view(conn) if c["institution"]["aicte_id"] == "1-4520311")
    case = next(c for c in cluster["cases"] if c["bureau"] == "RB")
    action = case_url(case["case_id"], "/actions")
    payload = {"type": "escalate", "remarks": "Review with related bureaus"}
    response = client.post(action, headers=as_role("RB"), json=payload)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "OVERLAP_ACK_REQUIRED"
    response = client.post(action, headers=as_role("RB"), json={**payload, "acknowledge_overlap": True})
    assert response.status_code == 200
    room = client.post("/api/rooms", headers=as_role("SENIOR"), json={"cluster_id": cluster["cluster_id"]})
    assert room.status_code == 200
    room = room.json()
    non_lead = next(r for r in ("RB", "PGRC", "AB") if r != room["lead_bureau"])
    response = client.post(f"/api/rooms/{room['id']}/decision", headers=as_role(non_lead),
                           json={"outcome": "MERGE", "note": "Joint investigation"})
    assert response.status_code == 403


def test_encoded_case_subroutes(client, conn):
    case = open_case(conn)
    assert client.get(case_url(case["case_id"], "/history")).status_code == 200
    assert client.get(case_url(case["case_id"], "/documents")).json() == {"items": []}
