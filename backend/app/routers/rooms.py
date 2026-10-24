"""Rooms API routes."""
import json
from fastapi import APIRouter, Body, Depends, HTTPException
from .. import db, events, roles, services
from ..constants import BUREAUS
from ..roles import get_ctx

router = APIRouter()


def _room_view(conn, rid):
    r = db.one(conn, "SELECT * FROM coordination_rooms WHERE id=?", (rid,))
    if not r:
        raise HTTPException(404, "room not found")
    ids = [x[0] for x in conn.execute("SELECT case_id FROM room_cases WHERE room_id=?", (rid,))]
    cases = services.case_summaries(conn, ids)
    inst = db.one(conn, "SELECT aicte_id,name,city,region FROM institutions WHERE aicte_id=?", (r["institution_id"],))
    comments = db.rows(conn, "SELECT author,role,body,ts FROM room_comments WHERE room_id=? ORDER BY id", (rid,))
    timeline = []
    for cid in ids:
        timeline += services.history_for(conn, cid)
    timeline.sort(key=lambda e: e["ts"], reverse=True)
    pairs = [services.pair_view(p) for p in db.rows(conn, "SELECT * FROM overlap_pairs WHERE cluster_id=? ORDER BY score DESC",
                                                    (r["cluster_id"],))]
    return {"id": r["id"], "cluster_id": r["cluster_id"], "institution": inst, "lead_bureau": r["lead_bureau"],
            "status": r["status"], "decision": json.loads(r["decision"]) if r["decision"] else None,
            "created_at": r["created_at"], "resolved_at": r["resolved_at"], "cases": cases, "comments": comments,
            "timeline": timeline[:40], "pairs": pairs}



@router.post("/api/rooms")
def create_room(body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    if ctx.role == "REGIONAL":
        roles.forbid("Regional Offices cannot open Coordination Rooms")
    P = ctx.persona
    cid = body.get("cluster_id")
    if not cid:
        raise HTTPException(400, "cluster_id required")
    existing = db.one(conn, "SELECT id FROM coordination_rooms WHERE cluster_id=?", (cid,))
    if existing:
        return _room_view(conn, existing["id"])
    cases = db.rows(conn, "SELECT case_id,institution_id,bureau_code,received_on FROM cases WHERE cluster_id=? "
                          "ORDER BY received_on", (cid,))
    if not cases:
        raise HTTPException(404, "cluster not found")
    rid = "ROOM-%04d" % db.next_counter(conn, "room_seq")
    now_dt = db.iso(db.now(conn))
    lead = cases[0]["bureau_code"]
    conn.execute("INSERT INTO coordination_rooms(id,cluster_id,institution_id,lead_bureau,status,created_by,created_at) "
                 "VALUES(?,?,?,?,'OPEN',?,?)", (rid, cid, cases[0]["institution_id"], lead, P[1], now_dt))
    for c in cases:
        conn.execute("INSERT INTO room_cases VALUES(?,?)", (rid, c["case_id"]))
        conn.execute("UPDATE cases SET room_id=? WHERE case_id=?", (rid, c["case_id"]))
        db.append_action(conn, c["case_id"], now_dt, P[0], P[1], P[2],
                         "LINKED", None, None,
                         f"Case linked with {len(cases) - 1} related case(s) in Coordination Room {rid}")
    conn.execute("UPDATE overlap_pairs SET status='LINKED' WHERE cluster_id=? AND status='OPEN'", (cid,))
    conn.commit()
    events.publish("room.created", {"room_id": rid})
    events.publish("dashboard.invalidate", {})
    return _room_view(conn, rid)



@router.get("/api/rooms/{room_id}")
def get_room(room_id: str, conn=Depends(db.get_conn)):
    return _room_view(conn, room_id)



@router.post("/api/rooms/{room_id}/comments")
def add_comment(room_id: str, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(400, "empty comment")
    _room_view(conn, room_id)
    conn.execute("INSERT INTO room_comments(room_id,author,role,body,ts) VALUES(?,?,?,?,?)",
                 (room_id, ctx.persona[1], ctx.persona[2], text, db.iso(db.now(conn))))
    conn.commit()
    events.publish("room.updated", {"room_id": room_id})
    return _room_view(conn, room_id)



@router.post("/api/rooms/{room_id}/lead")
def set_lead(room_id: str, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    lead = body.get("lead_bureau")
    if lead not in BUREAUS:
        raise HTTPException(400, "unknown bureau")
    rv = _room_view(conn, room_id)
    if ctx.role == "REGIONAL" or (ctx.is_bureau and ctx.role not in {c["bureau"] for c in rv["cases"]}):
        roles.forbid("Only a participating Bureau or Senior Management can set the lead")
    conn.execute("UPDATE coordination_rooms SET lead_bureau=? WHERE id=?", (lead, room_id))
    conn.execute("INSERT INTO room_comments(room_id,author,role,body,ts) VALUES(?,?,?,?,?)",
                 (room_id, "System", "SYS", f"Lead Bureau set to {lead}.", db.iso(db.now(conn))))
    conn.commit()
    events.publish("room.updated", {"room_id": room_id})
    return _room_view(conn, room_id)



@router.post("/api/rooms/{room_id}/decision")
def decide(room_id: str, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    room = _room_view(conn, room_id)
    if not (ctx.role == "SENIOR" or ctx.role == room["lead_bureau"]):
        roles.forbid("Only the lead Bureau or Senior Management can record the decision")
    P = ctx.persona
    outcome = body.get("outcome")
    if outcome not in ("MERGE", "RESOLVE", "KEEP_SEPARATE"):
        raise HTTPException(400, "outcome must be MERGE, RESOLVE or KEEP_SEPARATE")
    lead = body.get("lead_bureau") or room["lead_bureau"]
    note = (body.get("note") or "").strip()
    now_dt = db.iso(db.now(conn))
    decision = {"outcome": outcome, "lead_bureau": lead, "note": note, "decided_by": P[1], "at": now_dt}
    status = "MERGED" if outcome == "MERGE" else "RESOLVED"
    conn.execute("UPDATE coordination_rooms SET lead_bureau=?,status=?,decision=?,resolved_at=? WHERE id=?",
                 (lead, status, json.dumps(decision), now_dt, room_id))
    pair_status = "DISMISSED" if outcome == "KEEP_SEPARATE" else "RESOLVED"
    conn.execute("UPDATE overlap_pairs SET status=? WHERE cluster_id=?", (pair_status, room["cluster_id"]))
    label = {"MERGE": "Merged under lead Bureau", "RESOLVE": "Coordinated and resolved",
             "KEEP_SEPARATE": "Kept separate"}[outcome]
    for c in room["cases"]:
        follow = "" if c["bureau"] == lead else f" This Bureau follows {lead}'s lead."
        db.append_action(conn, c["case_id"], now_dt, P[0], P[1], P[2],
                         "COORDINATION", None, None, f"{label} ({room_id}); lead Bureau {lead}.{follow} {note}".strip())
    conn.execute("INSERT INTO room_comments(room_id,author,role,body,ts) VALUES(?,?,?,?,?)",
                 (room_id, "System", "SYS", f"Decision recorded: {label}; lead {lead}." + (f" {note}" if note else ""), now_dt))
    conn.commit()
    events.publish("room.updated", {"room_id": room_id})
    events.publish("dashboard.invalidate", {})
    return _room_view(conn, room_id)
