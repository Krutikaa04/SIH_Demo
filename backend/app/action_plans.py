"""Owned, evidence-backed follow-up commitments for Coordination Rooms."""
import json
import re
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, HTTPException

from . import db, events, roles
from .constants import BUREAUS, REGION_STATES
from .roles import get_ctx

router = APIRouter()
TABLE_NAME = "coordination_commitments"
SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS coordination_commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL, case_id TEXT NOT NULL, title TEXT NOT NULL,
  owner_bureau TEXT NOT NULL, due_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  completed_by TEXT, completed_at TEXT, completion_note TEXT
)
"""


def ensure_schema(conn):
    conn.execute(SCHEMA_DDL)
    conn.execute("CREATE INDEX IF NOT EXISTS ix_commitments_room ON coordination_commitments(room_id,status,due_on)")


def _room(conn, room_id, ctx):
    if ctx.role == "REGIONAL" and ctx.region not in REGION_STATES:
        roles.forbid("A recognized region is required to read coordination commitments")
    room = db.one(conn, "SELECT r.*,i.region FROM coordination_rooms r "
                        "JOIN institutions i ON i.aicte_id=r.institution_id WHERE r.id=?", (room_id,))
    if not room:
        raise HTTPException(404, "Coordination Room not found")
    if ctx.role == "REGIONAL" and room["region"] != ctx.region:
        roles.forbid("This Coordination Room belongs to another region")
    return room


def _planning_policy(room):
    if room["status"] == "OPEN" and not room["decision"]:
        return ""
    try:
        decision = json.loads(room["decision"] or "{}")
    except (TypeError, ValueError):
        decision = {}
    outcome = decision.get("outcome") if isinstance(decision, dict) else None
    if outcome == "KEEP_SEPARATE":
        return "These complaints were kept separate; no new joint commitment can be created."
    if (room["status"], outcome) in (("MERGED", "MERGE"), ("RESOLVED", "RESOLVE")):
        return ""
    return "Review the room's decision record before adding commitments."


def _text(value, label, maximum, multiline=False):
    if not isinstance(value, str):
        raise HTTPException(422, f"{label} must be text")
    value = value.strip()
    if not value or len(value) > maximum:
        raise HTTPException(422, f"{label} must contain between 1 and {maximum} characters")
    allowed = "\n\t" if multiline else ""
    if any(ord(char) < 32 and char not in allowed for char in value):
        raise HTTPException(422, f"{label} contains unsupported control characters")
    return value


def _item(conn, row, ctx, today, member_ids):
    current = db.one(conn, "SELECT bureau_code,status FROM cases WHERE case_id=?", (row["case_id"],))
    return {**row, "overdue": row["status"] == "OPEN" and row["due_on"] < today.isoformat(),
            "case_url": "/cases/" + quote(row["case_id"], safe=""),
            "current_bureau": current["bureau_code"] if current else None,
            "case_status": current["status"] if current else None,
            "is_room_member": row["case_id"] in member_ids,
            "can_complete": row["status"] == "OPEN" and (ctx.role == "SENIOR" or ctx.role == row["owner_bureau"])}


def view_plan(conn, room_id, ctx):
    room = _room(conn, room_id, ctx)
    ensure_schema(conn)
    today = db.now(conn).date()
    members = db.rows(conn, "SELECT c.case_id,c.bureau_code,c.category,c.status FROM room_cases rc "
                           "JOIN cases c ON c.case_id=rc.case_id WHERE rc.room_id=? AND c.institution_id=? "
                           "ORDER BY c.case_id", (room_id, room["institution_id"]))
    member_ids = {c["case_id"] for c in members}
    rows = db.rows(conn, "SELECT * FROM coordination_commitments WHERE room_id=? "
                        "ORDER BY CASE status WHEN 'OPEN' THEN 0 ELSE 1 END,due_on,id", (room_id,))
    policy = _planning_policy(room)
    permitted = ctx.role == "SENIOR" or (ctx.role in BUREAUS and ctx.role == room["lead_bureau"])
    return {"room_id": room_id, "region": room["region"], "role": ctx.role,
            "scope_region": ctx.region if ctx.role == "REGIONAL" else "", "as_of": today.isoformat(),
            "can_create": permitted and not policy, "create_disabled_reason": policy or (
                "Only the lead Bureau or Senior Management can add commitments." if not permitted else ""),
            "cases": members, "items": [_item(conn, row, ctx, today, member_ids) for row in rows],
            "counts": {"open": sum(r["status"] == "OPEN" for r in rows),
                       "done": sum(r["status"] == "DONE" for r in rows),
                       "overdue": sum(r["status"] == "OPEN" and r["due_on"] < today.isoformat() for r in rows)}}


def _begin(conn):
    ensure_schema(conn)
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")


def _publish(room_id, case_id):
    events.publish("room.updated", {"room_id": room_id})
    events.publish("case.updated", {"case_id": case_id})
    events.publish("dashboard.invalidate", {})


def create_commitment(conn, room_id, ctx, body):
    _begin(conn)
    room = _room(conn, room_id, ctx)
    if not (ctx.role == "SENIOR" or (ctx.role in BUREAUS and ctx.role == room["lead_bureau"])):
        roles.forbid("Only the lead Bureau or Senior Management can add commitments")
    policy = _planning_policy(room)
    if policy:
        raise HTTPException(409, policy)
    if set(body) - {"case_id", "title", "due_on"}:
        raise HTTPException(422, "Only case_id, title and due_on may be supplied; ownership comes from the case")
    case_id = _text(body.get("case_id"), "Case reference", 100)
    member = db.one(conn, "SELECT c.case_id,c.bureau_code FROM room_cases rc JOIN cases c ON c.case_id=rc.case_id "
                          "WHERE rc.room_id=? AND c.case_id=? AND c.institution_id=?",
                    (room_id, case_id, room["institution_id"]))
    if not member:
        raise HTTPException(422, "Choose a case that currently belongs to this Coordination Room")
    if member["bureau_code"] not in BUREAUS:
        raise HTTPException(409, "The case needs a recognized owning Bureau before a commitment can be added")
    title = _text(body.get("title"), "Commitment title", 160)
    due_on = body.get("due_on")
    try:
        if not isinstance(due_on, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_on):
            raise ValueError()
        due = date.fromisoformat(due_on)
    except ValueError:
        raise HTTPException(422, "Due date must be a valid YYYY-MM-DD date")
    if due < db.now(conn).date():
        raise HTTPException(422, "A new commitment cannot have a due date in the past")
    stamp, persona = db.iso(db.now(conn)), ctx.persona
    cursor = conn.execute("INSERT INTO coordination_commitments(room_id,case_id,title,owner_bureau,due_on,created_by,created_at) "
                          "VALUES(?,?,?,?,?,?,?)", (room_id, case_id, title, member["bureau_code"], due_on, persona[1], stamp))
    commitment_id = cursor.lastrowid
    db.append_action(conn, case_id, stamp, persona[0], persona[1], persona[2], "COMMITMENT_CREATED", None, None,
                     f"Commitment #{commitment_id} in {room_id}: {title}. Owner Bureau {member['bureau_code']}; due {due_on}.")
    conn.commit()
    _publish(room_id, case_id)
    return {"id": commitment_id, "plan": view_plan(conn, room_id, ctx)}


def complete_commitment(conn, room_id, commitment_id, ctx, body):
    _begin(conn)
    _room(conn, room_id, ctx)
    item = db.one(conn, "SELECT * FROM coordination_commitments WHERE id=? AND room_id=?", (commitment_id, room_id))
    if not item:
        raise HTTPException(404, "Commitment not found in this Coordination Room")
    if ctx.role != "SENIOR" and ctx.role != item["owner_bureau"]:
        roles.forbid("Only the commitment's owning Bureau or Senior Management can mark it done")
    if item["status"] == "DONE":
        conn.commit()
        return {"id": commitment_id, "already_completed": True, "plan": view_plan(conn, room_id, ctx)}
    if set(body) - {"completion_note"}:
        raise HTTPException(422, "Only completion_note may be supplied")
    note = _text(body.get("completion_note"), "Completion evidence note", 2000, multiline=True)
    stamp, persona = db.iso(db.now(conn)), ctx.persona
    conn.execute("UPDATE coordination_commitments SET status='DONE',completed_by=?,completed_at=?,completion_note=? WHERE id=?",
                 (persona[1], stamp, note, commitment_id))
    db.append_action(conn, item["case_id"], stamp, persona[0], persona[1], persona[2], "COMMITMENT_COMPLETED", None, None,
                     f"Commitment #{commitment_id} in {room_id} marked done: {item['title']}. Evidence: {note}")
    conn.commit()
    _publish(room_id, item["case_id"])
    return {"id": commitment_id, "already_completed": False, "plan": view_plan(conn, room_id, ctx)}


@router.get("/api/rooms/{room_id}/commitments")
def get_commitments(room_id: str, conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    return view_plan(conn, room_id, ctx)


@router.post("/api/rooms/{room_id}/commitments")
def add_commitment(room_id: str, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    return create_commitment(conn, room_id, ctx, body)


@router.post("/api/rooms/{room_id}/commitments/{commitment_id}/complete")
def mark_commitment_done(room_id: str, commitment_id: int, body: dict = Body(...),
                         conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    return complete_commitment(conn, room_id, commitment_id, ctx, body)
