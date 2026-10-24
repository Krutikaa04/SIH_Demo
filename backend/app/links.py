"""Manual case links and Coordination Room membership.

A manual link is an ``overlap_pairs`` row with ``type='MANUAL'``: it joins a cluster exactly like a detected pair, so the
Overlaps list, the Coordination Room and the coordination guard need no special cases. Every change is written to the
hash-chained history of the cases it touches (``db.append_action``); nothing here updates ``action_history``.
"""
import json

from fastapi import HTTPException

from . import db, intel, roles, services

MANUAL_HEADLINE = "Manually linked by an official"
DECIDED_MSG = "Only Senior Management can change a Coordination Room that already has a decision"
INACTIVE_PAIR = ("REJECTED", "DISMISSED")


def _forbid_regional(ctx, what):
    if ctx.role == "REGIONAL":
        roles.forbid(f"Regional Offices cannot {what}")


def _participant(ctx, bureaus):
    return ctx.role == "SENIOR" or (ctx.is_bureau and ctx.role in bureaus)


def _case(conn, case_id):
    c = db.one(conn, "SELECT case_id,institution_id,bureau_code,status,room_id,cluster_id,received_on "
                     "FROM cases WHERE case_id=?", (case_id,))
    if not c:
        raise HTTPException(404, f"case {case_id} not found")
    return c


def _room(conn, room_id):
    r = db.one(conn, "SELECT * FROM coordination_rooms WHERE id=?", (room_id,))
    if not r:
        raise HTTPException(404, "room not found")
    return r


def _members(conn, room_id):
    return db.rows(conn, "SELECT c.case_id,c.bureau_code,c.received_on FROM room_cases rc "
                         "JOIN cases c ON c.case_id=rc.case_id WHERE rc.room_id=? ORDER BY c.received_on, c.case_id",
                   (room_id,))


def _room_of(conn, case):
    if case["room_id"]:
        return db.one(conn, "SELECT * FROM coordination_rooms WHERE id=?", (case["room_id"],))
    if case["cluster_id"]:
        return db.one(conn, "SELECT * FROM coordination_rooms WHERE cluster_id=?", (case["cluster_id"],))
    return None


def _log(conn, ctx, case_id, now, action, remarks):
    P = ctx.persona
    db.append_action(conn, case_id, now, P[0], P[1], P[2], action, None, None, remarks)


def _note(conn, room_id, now, text):
    conn.execute("INSERT INTO room_comments(room_id,author,role,body,ts) VALUES(?,?,?,?,?)",
                 (room_id, "System", "SYS", text, now))


def _find_pair(conn, x, y):
    lo, hi = sorted((x, y))
    return db.one(conn, "SELECT * FROM overlap_pairs WHERE case_a=? AND case_b=?", (lo, hi))


def _make_pair(conn, ctx, x, y, institution_id, rationale, now, status):
    """Insert (or revive a rejected / dismissed) MANUAL pair. Returns (pair_id, created)."""
    lo, hi = sorted((x, y))
    actor = ctx.persona[1]
    breakdown = json.dumps([{"signal": "manual", "label": "Manual link", "points": 100, "max": 100,
                             "detail": rationale}])
    explanation = f"Linked manually by {actor}.\nReason: {rationale}"
    existing = _find_pair(conn, lo, hi)
    if existing and existing["status"] not in INACTIVE_PAIR:
        return existing["id"], False
    if existing:
        conn.execute("UPDATE overlap_pairs SET type='MANUAL',score=100,band='HIGH',breakdown=?,explanation=?,headline=?,"
                     "status=?,cluster_id=NULL,detected_at=?,review_rationale=?,review_by=?,review_at=? WHERE id=?",
                     (breakdown, explanation, MANUAL_HEADLINE, status, now, rationale, actor, now, existing["id"]))
        return existing["id"], True
    pid = "PR-%04d" % db.next_counter(conn, "pair_seq")
    conn.execute("INSERT INTO overlap_pairs(id,case_a,case_b,institution_id,type,score,band,breakdown,explanation,"
                 "headline,status,detected_at,review_rationale,review_by,review_at) "
                 "VALUES(?,?,?,?,'MANUAL',100,'HIGH',?,?,?,?,?,?,?,?)",
                 (pid, lo, hi, institution_id, breakdown, explanation, MANUAL_HEADLINE, status, now, rationale,
                  actor, now))
    return pid, True


def _adopt_into_room(conn, ctx, room, cluster_id, now):
    """After a recluster: make the room follow its cluster and take in every cluster case that is not yet a member."""
    if room["cluster_id"] != cluster_id:
        conn.execute("UPDATE coordination_rooms SET cluster_id=? WHERE id=?", (cluster_id, room["id"]))
    added = []
    for r in db.rows(conn, "SELECT case_id FROM cases WHERE cluster_id=? AND room_id IS NULL", (cluster_id,)):
        conn.execute("INSERT OR IGNORE INTO room_cases VALUES(?,?)", (room["id"], r["case_id"]))
        conn.execute("UPDATE cases SET room_id=? WHERE case_id=?", (room["id"], r["case_id"]))
        _log(conn, ctx, r["case_id"], now, "LINKED",
             f"Case added to Coordination Room {room['id']} by {ctx.persona[1]}")
        added.append(r["case_id"])
    if added:
        _note(conn, room["id"], now, f"{', '.join(added)} added to the room by {ctx.persona[1]}.")
    return added


def _pair_out(conn, pid, created):
    p = db.one(conn, "SELECT * FROM overlap_pairs WHERE id=?", (pid,))
    room = db.one(conn, "SELECT id FROM coordination_rooms WHERE cluster_id=?", (p["cluster_id"],)) \
        if p["cluster_id"] else None
    return {"created": created, "pair": services.pair_view(p), "cluster_id": p["cluster_id"],
            "room_id": room["id"] if room else None}


# ---- manual link ---------------------------------------------------------------------------

def link_cases(conn, ctx, case_a, case_b, rationale):
    _forbid_regional(ctx, "link cases")
    rationale = (rationale or "").strip()
    if not rationale:
        raise HTTPException(422, "A rationale for the link is required")
    if not case_a or not case_b:
        raise HTTPException(400, "case_a and case_b are required")
    if case_a == case_b:
        raise HTTPException(400, "A case cannot be linked to itself")
    a, b = _case(conn, case_a), _case(conn, case_b)
    if not a["institution_id"] or a["institution_id"] != b["institution_id"]:
        raise HTTPException(400, "Only cases of the same institution can be linked")
    if not _participant(ctx, {a["bureau_code"], b["bureau_code"]}):
        roles.forbid("You can only link cases where at least one belongs to your Bureau")

    existing = _find_pair(conn, case_a, case_b)
    if existing and existing["status"] not in INACTIVE_PAIR:
        return _pair_out(conn, existing["id"], False)

    room_a, room_b = _room_of(conn, a), _room_of(conn, b)
    if room_a and room_b and room_a["id"] != room_b["id"]:
        raise HTTPException(409, f"These cases are in different Coordination Rooms ({room_a['id']}, {room_b['id']}); "
                                 f"remove one of them from its room before linking")
    room = room_a or room_b
    if room and room["status"] != "OPEN" and ctx.role != "SENIOR":
        roles.forbid(DECIDED_MSG)

    now = db.iso(db.now(conn))
    pid, created = _make_pair(conn, ctx, case_a, case_b, a["institution_id"], rationale, now,
                              "RESOLVED" if room and room["status"] != "OPEN" else "CONFIRMED")
    intel.recluster(conn, a["institution_id"])
    cluster_id = db.one(conn, "SELECT cluster_id FROM overlap_pairs WHERE id=?", (pid,))["cluster_id"]
    for mine, other in ((case_a, case_b), (case_b, case_a)):
        _log(conn, ctx, mine, now, "LINKED_MANUAL",
             f"Manually linked with {other} ({pid}) by {ctx.persona[1]}. Reason: {rationale}")
    if room:
        _adopt_into_room(conn, ctx, room, cluster_id, now)
    return _pair_out(conn, pid, created)


# ---- room membership -----------------------------------------------------------------------

def can_manage_room(ctx, room):
    """room: the view returned by main._room_view."""
    if ctx.role == "REGIONAL":
        return False
    if room["status"] != "OPEN":
        return ctx.role == "SENIOR"
    return ctx.role == "SENIOR" or ctx.role in {c["bureau"] for c in room["cases"]}


def add_to_room(conn, ctx, room_id, case_id, rationale=""):
    _forbid_regional(ctx, "change Coordination Room membership")
    room = _room(conn, room_id)
    if room["status"] != "OPEN" and ctx.role != "SENIOR":
        roles.forbid(DECIDED_MSG)
    case = _case(conn, case_id)
    members = _members(conn, room_id)
    if case_id in {m["case_id"] for m in members}:
        return {"added": [], "pair_id": None}
    if case["institution_id"] != room["institution_id"]:
        raise HTTPException(400, "Only cases of the room's institution can be added")
    other = _room_of(conn, case)
    if other and other["id"] != room_id:
        raise HTTPException(409, f"{case_id} is already in Coordination Room {other['id']}; "
                                 f"remove it from that room first")
    if not _participant(ctx, {case["bureau_code"]} | {m["bureau_code"] for m in members}):
        roles.forbid("Only a participating Bureau or Senior Management can add cases to this room")

    rationale = (rationale or "").strip() or "Added to the Coordination Room"
    now = db.iso(db.now(conn))
    pair_id, cluster_id = None, room["cluster_id"]
    if case["cluster_id"] != room["cluster_id"]:
        # not connected to the room's cluster yet: link it to the earliest case of another Bureau (else the earliest)
        anchor = next((m for m in members if m["bureau_code"] != case["bureau_code"]), members[0])
        pair_id, created = _make_pair(conn, ctx, case_id, anchor["case_id"], room["institution_id"], rationale, now,
                                      "CONFIRMED" if room["status"] == "OPEN" else "RESOLVED")
        intel.recluster(conn, room["institution_id"])
        cluster_id = db.one(conn, "SELECT cluster_id FROM overlap_pairs WHERE id=?", (pair_id,))["cluster_id"]
        if created:
            for mine, theirs in ((case_id, anchor["case_id"]), (anchor["case_id"], case_id)):
                _log(conn, ctx, mine, now, "LINKED_MANUAL",
                     f"Manually linked with {theirs} ({pair_id}) by {ctx.persona[1]}. Reason: {rationale}")
    added = _adopt_into_room(conn, ctx, room, cluster_id, now)
    return {"added": added, "pair_id": pair_id}


def _component_count(nodes, edges):
    parent = {n: n for n in nodes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for x, y in edges:
        if x in parent and y in parent:
            parent[find(x)] = find(y)
    return len({find(n) for n in nodes})


def remove_from_room(conn, ctx, room_id, case_id, reason=""):
    _forbid_regional(ctx, "change Coordination Room membership")
    room = _room(conn, room_id)
    if room["status"] != "OPEN" and ctx.role != "SENIOR":
        roles.forbid(DECIDED_MSG)
    members = _members(conn, room_id)
    ids = [m["case_id"] for m in members]
    if case_id not in ids:
        raise HTTPException(404, f"{case_id} is not in {room_id}")
    if not _participant(ctx, {m["bureau_code"] for m in members}):
        roles.forbid("Only a participating Bureau or Senior Management can remove cases from this room")
    rest = [i for i in ids if i != case_id]
    if len(rest) < 2:
        raise HTTPException(409, "A Coordination Room needs at least two cases. Record 'Keep separate' to close it.")
    edges = [(p["case_a"], p["case_b"]) for p in db.rows(
        conn, "SELECT case_a,case_b FROM overlap_pairs WHERE cluster_id=? AND status!='REJECTED'",
        (room["cluster_id"],))]
    if _component_count(rest, [e for e in edges if case_id not in e]) > _component_count(ids, edges):
        raise HTTPException(409, f"Removing {case_id} would disconnect the remaining cases. "
                                 f"Link them to each other first.")

    reason = (reason or "").strip() or "Removed from the Coordination Room"
    now = db.iso(db.now(conn))
    actor = ctx.persona[1]
    marks = ",".join("?" * len(rest))
    conn.execute(f"UPDATE overlap_pairs SET status='REJECTED',cluster_id=NULL,review_rationale=?,review_by=?,review_at=? "
                 f"WHERE status!='REJECTED' AND ((case_a=? AND case_b IN ({marks})) OR (case_b=? AND case_a IN ({marks})))",
                 (f"Removed from {room_id}: {reason}", actor, now, case_id, *rest, case_id, *rest))
    conn.execute("DELETE FROM room_cases WHERE room_id=? AND case_id=?", (room_id, case_id))
    conn.execute("UPDATE cases SET room_id=NULL, cluster_id=NULL WHERE case_id=?", (case_id,))
    intel.recluster(conn, room["institution_id"])
    _log(conn, ctx, case_id, now, "UNLINKED", f"Removed from Coordination Room {room_id} by {actor}. Reason: {reason}")
    _note(conn, room_id, now, f"{case_id} removed from the room by {actor}. Reason: {reason}")
    return {"removed": case_id}
