"""Manual case links and Coordination Room membership (issue #13)."""
from urllib.parse import quote

import pytest

from app import db, intel, services

BUREAUS = ["RB", "PGRC", "AB", "LC", "VIG"]


def free_cases(conn, n=3):
    """n open, unlinked cases of one institution; the first two sit with different Bureaus."""
    rows = db.rows(conn, "SELECT case_id,institution_id,bureau_code FROM cases WHERE cluster_id IS NULL "
                         "AND status!='Disposed' AND institution_id IS NOT NULL ORDER BY institution_id, case_id")
    by_inst = {}
    for r in rows:
        by_inst.setdefault(r["institution_id"], []).append(r)
    for cases in by_inst.values():
        if len(cases) < n:
            continue
        first = cases[0]
        second = next((c for c in cases if c["bureau_code"] != first["bureau_code"]), None)
        if second:
            rest = [c for c in cases if c not in (first, second)]
            return [first, second, *rest[:n - 2]]
    pytest.fail("the seed has no institution with enough unlinked open cases")


def link(client, as_role, a, b, role="SENIOR", rationale="Same underlying grievance", region=None):
    return client.post("/api/links", json={"case_a": a, "case_b": b, "rationale": rationale},
                       headers=as_role(role, region))


def history(conn, case_id):
    return [r["action_type"] for r in conn.execute(
        "SELECT action_type FROM action_history WHERE case_id=? ORDER BY seq", (case_id,))]


def open_room(client, as_role, cluster_id):
    response = client.post("/api/rooms", json={"cluster_id": cluster_id}, headers=as_role("SENIOR"))
    assert response.status_code == 200
    return response.json()


def room_case_ids(room):
    return sorted(c["case_id"] for c in room["cases"])


def three_case_room(conn, client, as_role):
    """c1-c2 linked and in a room; c3 free at the same institution."""
    c1, c2, c3 = free_cases(conn, 3)
    cluster = link(client, as_role, c1["case_id"], c2["case_id"]).json()["cluster_id"]
    return c1, c2, c3, open_room(client, as_role, cluster)


def room_url(room_id, case_id=None):
    return f"/api/rooms/{room_id}/cases" + (f"/{quote(case_id, safe='')}" if case_id else "")


# ---- manual link ---------------------------------------------------------------------------

def test_manual_link_forms_a_cluster_with_history_and_guard(conn, client, as_role):
    c1, c2 = free_cases(conn, 2)[:2]
    response = link(client, as_role, c1["case_id"], c2["case_id"])
    assert response.status_code == 200
    out = response.json()
    assert out["created"] is True and out["cluster_id"]
    pair = out["pair"]
    assert pair["type"] == "MANUAL" and pair["status"] == "CONFIRMED" and pair["band"] == "HIGH"
    assert pair["review_rationale"] == "Same underlying grievance"
    for c in (c1, c2):
        assert conn.execute("SELECT cluster_id FROM cases WHERE case_id=?", (c["case_id"],)).fetchone()[0] == out["cluster_id"]
        assert history(conn, c["case_id"])[-1] == "LINKED_MANUAL"
        guard = client.get(f"/api/cases/{quote(c['case_id'], safe='')}", headers=as_role("SENIOR")).json()["guard"]
        assert guard["code"] == "OPEN_OVERLAP" and guard["cluster_id"] == out["cluster_id"]
    shown = {p["id"]: p for cl in client.get("/api/overlaps", headers=as_role("SENIOR")).json()["items"] for p in cl["pairs"]}
    assert shown[pair["id"]]["type"] == "MANUAL"
    assert db.verify_chain(conn)["ok"]


def test_linking_twice_returns_the_existing_pair(conn, client, as_role):
    c1, c2 = free_cases(conn, 2)[:2]
    first = link(client, as_role, c1["case_id"], c2["case_id"]).json()
    entries = len(history(conn, c1["case_id"]))
    again = link(client, as_role, c2["case_id"], c1["case_id"])  # opposite order, still the same pair
    assert again.status_code == 200 and again.json()["created"] is False
    assert again.json()["pair"]["id"] == first["pair"]["id"]
    assert conn.execute("SELECT COUNT(*) FROM overlap_pairs WHERE case_a=? OR case_b=?",
                        (c1["case_id"], c1["case_id"])).fetchone()[0] == 1
    assert len(history(conn, c1["case_id"])) == entries


def test_link_validation(conn, client, as_role):
    c1, c2 = free_cases(conn, 2)[:2]
    other_institution = conn.execute("SELECT case_id FROM cases WHERE institution_id!=? AND institution_id IS NOT NULL "
                                     "LIMIT 1", (c1["institution_id"],)).fetchone()[0]
    assert link(client, as_role, c1["case_id"], c1["case_id"]).status_code == 400
    assert link(client, as_role, c1["case_id"], "NOPE/2099/00001").status_code == 404
    assert link(client, as_role, c1["case_id"], other_institution).status_code == 400
    assert link(client, as_role, c1["case_id"], c2["case_id"], rationale="  ").status_code == 422
    assert client.post("/api/links", json={"case_a": c1["case_id"]}, headers=as_role("SENIOR")).status_code in (400, 422)


def test_link_permission_matrix(conn, client, as_role):
    c1, c2 = free_cases(conn, 2)[:2]
    outsider = next(b for b in BUREAUS if b not in (c1["bureau_code"], c2["bureau_code"]))
    assert link(client, as_role, c1["case_id"], c2["case_id"], role=outsider).status_code == 403
    assert link(client, as_role, c1["case_id"], c2["case_id"], role="REGIONAL", region="Western").status_code == 403
    assert conn.execute("SELECT COUNT(*) FROM overlap_pairs WHERE case_a=? OR case_b=?",
                        (c1["case_id"], c1["case_id"])).fetchone()[0] == 0
    assert link(client, as_role, c1["case_id"], c2["case_id"], role=c1["bureau_code"]).status_code == 200


def test_recluster_and_redetection_keep_manual_links(conn, client, as_role):
    c1, c2 = free_cases(conn, 2)[:2]
    cluster = link(client, as_role, c1["case_id"], c2["case_id"]).json()["cluster_id"]
    intel.recluster(conn, c1["institution_id"])
    intel.detect(conn, institutions=[c1["institution_id"]])
    conn.commit()
    rows = conn.execute("SELECT cluster_id,type FROM overlap_pairs WHERE case_a=? AND case_b=?",
                        tuple(sorted((c1["case_id"], c2["case_id"])))).fetchall()
    assert [tuple(r) for r in rows] == [(cluster, "MANUAL")]
    assert services.cluster_map(conn)[cluster]["status"] == "LINKED"


def test_a_rejected_pair_can_be_relinked_manually(conn, client, as_role):
    c1, c2 = free_cases(conn, 2)[:2]
    pair_id = link(client, as_role, c1["case_id"], c2["case_id"]).json()["pair"]["id"]
    review = client.post(f"/api/overlaps/{pair_id}/review", json={"decision": "REJECTED", "rationale": "Not related"},
                         headers=as_role("SENIOR"))
    assert review.status_code == 200
    assert conn.execute("SELECT cluster_id FROM cases WHERE case_id=?", (c1["case_id"],)).fetchone()[0] is None
    again = link(client, as_role, c1["case_id"], c2["case_id"], rationale="On second thought they are related")
    assert again.status_code == 200 and again.json()["created"] is True
    assert again.json()["pair"]["id"] == pair_id and again.json()["pair"]["status"] == "CONFIRMED"
    assert again.json()["cluster_id"]
    assert db.verify_chain(conn)["ok"]


# ---- room membership -----------------------------------------------------------------------

def test_add_and_remove_a_case_with_history(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    rid = room["id"]
    added = client.post(room_url(rid), json={"case_id": c3["case_id"], "rationale": "Late complaint, same matter"},
                        headers=as_role("SENIOR"))
    assert added.status_code == 200
    assert room_case_ids(added.json()) == sorted(c["case_id"] for c in (c1, c2, c3))
    row = conn.execute("SELECT room_id,cluster_id FROM cases WHERE case_id=?", (c3["case_id"],)).fetchone()
    assert row["room_id"] == rid and row["cluster_id"] == room["cluster_id"]
    assert "LINKED" in history(conn, c3["case_id"]) and "LINKED_MANUAL" in history(conn, c3["case_id"])
    assert any(p["type"] == "MANUAL" for p in added.json()["pairs"])
    guard = client.get(f"/api/cases/{quote(c3['case_id'], safe='')}", headers=as_role("SENIOR")).json()["guard"]
    assert guard and guard["room_id"] == rid

    removed = client.delete(room_url(rid, c3["case_id"]) + "?reason=Wrong%20matter", headers=as_role("SENIOR"))
    assert removed.status_code == 200
    assert room_case_ids(removed.json()) == sorted(c["case_id"] for c in (c1, c2))
    row = conn.execute("SELECT room_id,cluster_id FROM cases WHERE case_id=?", (c3["case_id"],)).fetchone()
    assert row["room_id"] is None and row["cluster_id"] is None
    assert history(conn, c3["case_id"])[-1] == "UNLINKED"
    assert conn.execute("SELECT COUNT(*) FROM room_cases WHERE room_id=? AND case_id=?", (rid, c3["case_id"])).fetchone()[0] == 0
    assert db.verify_chain(conn)["ok"]


def test_removed_case_is_not_pulled_back_by_recluster(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    client.post(room_url(room["id"]), json={"case_id": c3["case_id"]}, headers=as_role("SENIOR"))
    client.delete(room_url(room["id"], c3["case_id"]), headers=as_role("SENIOR"))
    intel.recluster(conn, c1["institution_id"])
    conn.commit()
    assert conn.execute("SELECT cluster_id,room_id FROM cases WHERE case_id=?", (c3["case_id"],)).fetchone()[0] is None
    assert room_case_ids(client.get(f"/api/rooms/{room['id']}", headers=as_role("SENIOR")).json()) == \
        sorted(c["case_id"] for c in (c1, c2))


def test_adding_a_member_twice_is_idempotent(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    assert client.post(room_url(room["id"]), json={"case_id": c3["case_id"]}, headers=as_role("SENIOR")).status_code == 200
    entries = len(history(conn, c3["case_id"]))
    again = client.post(room_url(room["id"]), json={"case_id": c3["case_id"]}, headers=as_role("SENIOR"))
    assert again.status_code == 200 and len(room_case_ids(again.json())) == 3
    assert len(history(conn, c3["case_id"])) == entries


def test_add_rejects_other_institutions_unknown_cases_and_cases_in_another_room(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    foreign = conn.execute("SELECT case_id FROM cases WHERE institution_id!=? AND institution_id IS NOT NULL LIMIT 1",
                           (c1["institution_id"],)).fetchone()[0]
    assert client.post(room_url(room["id"]), json={"case_id": foreign}, headers=as_role("SENIOR")).status_code == 400
    assert client.post(room_url(room["id"]), json={"case_id": "NOPE/2099/00001"}, headers=as_role("SENIOR")).status_code == 404
    assert client.post(room_url("ROOM-9999"), json={"case_id": c3["case_id"]}, headers=as_role("SENIOR")).status_code == 404
    assert client.post(room_url(room["id"]), json={}, headers=as_role("SENIOR")).status_code == 400

    # a second room at another institution: its case cannot be pulled into the first
    other = next(c for c in conn.execute("SELECT case_id,institution_id FROM cases WHERE cluster_id IS NOT NULL").fetchall()
                 if c["institution_id"] != c1["institution_id"])
    cluster = conn.execute("SELECT cluster_id FROM cases WHERE case_id=?", (other["case_id"],)).fetchone()[0]
    second = open_room(client, as_role, cluster)
    assert second["id"] != room["id"]
    third_room_case = second["cases"][0]["case_id"]
    assert client.post(room_url(second["id"]), json={"case_id": c3["case_id"]}, headers=as_role("SENIOR")).status_code == 400
    assert third_room_case not in room_case_ids(client.get(f"/api/rooms/{room['id']}", headers=as_role("SENIOR")).json())


def test_a_case_in_another_room_conflicts(conn, client, as_role):
    c1, c2, d1, d2 = free_cases(conn, 4)
    first = open_room(client, as_role, link(client, as_role, c1["case_id"], c2["case_id"]).json()["cluster_id"])
    second = open_room(client, as_role, link(client, as_role, d1["case_id"], d2["case_id"]).json()["cluster_id"])
    assert first["id"] != second["id"]
    response = client.post(room_url(first["id"]), json={"case_id": d1["case_id"]}, headers=as_role("SENIOR"))
    assert response.status_code == 409 and second["id"] in response.json()["detail"]
    clash = link(client, as_role, c1["case_id"], d1["case_id"])
    assert clash.status_code == 409 and first["id"] in clash.json()["detail"]
    assert room_case_ids(client.get(f"/api/rooms/{first['id']}", headers=as_role("SENIOR")).json()) ==         sorted((c1["case_id"], c2["case_id"]))
    assert db.verify_chain(conn)["ok"]


def test_membership_permissions(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    rid = room["id"]
    outsider = next(b for b in BUREAUS if b not in (c1["bureau_code"], c2["bureau_code"], c3["bureau_code"]))
    assert client.post(room_url(rid), json={"case_id": c3["case_id"]}, headers=as_role(outsider)).status_code == 403
    assert client.post(room_url(rid), json={"case_id": c3["case_id"]}, headers=as_role("REGIONAL", "Western")).status_code == 403
    assert room_case_ids(client.get(f"/api/rooms/{rid}", headers=as_role("SENIOR")).json()) == \
        sorted(c["case_id"] for c in (c1, c2))
    assert client.post(room_url(rid), json={"case_id": c3["case_id"]}, headers=as_role(c1["bureau_code"])).status_code == 200
    assert client.delete(room_url(rid, c3["case_id"]), headers=as_role(outsider)).status_code == 403
    assert client.delete(room_url(rid, c3["case_id"]), headers=as_role("REGIONAL", "Western")).status_code == 403
    assert client.delete(room_url(rid, c3["case_id"]), headers=as_role(c1["bureau_code"])).status_code == 200


def test_can_manage_members_flag(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    outsider = next(b for b in BUREAUS if b not in (c1["bureau_code"], c2["bureau_code"]))
    flag = lambda role, region=None: client.get(f"/api/rooms/{room['id']}", headers=as_role(role, region)).json()["can_manage_members"]
    assert flag("SENIOR") and flag(c1["bureau_code"]) and flag(c2["bureau_code"])
    assert not flag(outsider) and not flag("REGIONAL", room["institution"]["region"])


def test_decided_room_is_senior_only(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    rid = room["id"]
    client.post(room_url(rid), json={"case_id": c3["case_id"]}, headers=as_role("SENIOR"))
    decided = client.post(f"/api/rooms/{rid}/decision", json={"outcome": "MERGE", "lead_bureau": c1["bureau_code"]},
                          headers=as_role("SENIOR"))
    assert decided.status_code == 200 and decided.json()["status"] == "MERGED"
    assert client.delete(room_url(rid, c3["case_id"]), headers=as_role(c1["bureau_code"])).status_code == 403
    assert client.get(f"/api/rooms/{rid}", headers=as_role(c1["bureau_code"])).json()["can_manage_members"] is False
    assert client.delete(room_url(rid, c3["case_id"]), headers=as_role("SENIOR")).status_code == 200
    guard = client.get(f"/api/cases/{quote(c3['case_id'], safe='')}", headers=as_role("SENIOR")).json()["guard"]
    assert guard is None
    assert db.verify_chain(conn)["ok"]


def test_cannot_shrink_a_room_below_two_cases(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    response = client.delete(room_url(room["id"], c1["case_id"]), headers=as_role("SENIOR"))
    assert response.status_code == 409
    assert room_case_ids(client.get(f"/api/rooms/{room['id']}", headers=as_role("SENIOR")).json()) == \
        sorted(c["case_id"] for c in (c1, c2))


def test_cannot_remove_the_case_that_connects_the_others(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)  # c1-c2 linked; c3 joins through an anchor
    rid = room["id"]
    assert link(client, as_role, c2["case_id"], c3["case_id"]).status_code == 200  # c3 now hangs off c2
    client.post(room_url(rid), json={"case_id": c3["case_id"]}, headers=as_role("SENIOR"))
    pairs = db.rows(conn, "SELECT case_a,case_b FROM overlap_pairs WHERE cluster_id=? AND status!='REJECTED'",
                    (room["cluster_id"],))
    edges = {frozenset((p["case_a"], p["case_b"])) for p in pairs}
    bridge = next((c for c in (c1, c2, c3) if all(c["case_id"] in e for e in edges)), None)
    if bridge is None:
        pytest.skip("the rooms' cases are fully meshed, no bridge case exists")
    response = client.delete(room_url(rid, bridge["case_id"]), headers=as_role("SENIOR"))
    assert response.status_code == 409 and "disconnect" in response.json()["detail"]


def test_unknown_case_cannot_be_removed(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    assert client.delete(room_url(room["id"], c3["case_id"]), headers=as_role("SENIOR")).status_code == 404


def test_linking_into_an_open_room_adopts_the_case(conn, client, as_role):
    c1, c2, c3, room = three_case_room(conn, client, as_role)
    out = link(client, as_role, c1["case_id"], c3["case_id"])
    assert out.status_code == 200 and out.json()["room_id"] == room["id"]
    assert room_case_ids(client.get(f"/api/rooms/{room['id']}", headers=as_role("SENIOR")).json()) == \
        sorted(c["case_id"] for c in (c1, c2, c3))
    assert conn.execute("SELECT room_id FROM cases WHERE case_id=?", (c3["case_id"],)).fetchone()[0] == room["id"]
    assert db.verify_chain(conn)["ok"]
