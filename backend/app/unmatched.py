"""Review queue for complaints whose institution could not be matched with confidence (issue #14).

A parked complaint is stored as the cleaned payload. When an official picks the institution it goes through the normal
pipeline (`services.register_complaint`); a discarded one stays in the table with who/when/why as an audit record.
"""
import json
from datetime import timedelta

from fastapi import HTTPException

from . import db, events, roles, services

STATUSES = ("OPEN", "RESOLVED", "DISCARDED")


def _view(row):
    return {"id": row["id"], "status": row["status"], "institution_name": row["institution_name"],
            "aicte_id": row["aicte_id"], "bureau": row["bureau"], "suggestions": json.loads(row["suggestions"] or "[]"),
            "complaint": json.loads(row["payload"]), "created_by": row["created_by"], "created_at": row["created_at"],
            "resolved_case_id": row["resolved_case_id"], "resolved_by": row["resolved_by"],
            "resolved_at": row["resolved_at"], "discard_reason": row["discard_reason"]}


def can_handle(ctx, row):
    """Senior Management and the receiving Bureau; Regional Offices never."""
    return ctx.role == "SENIOR" or (ctx.is_bureau and ctx.role == row["bureau"])


def _get(conn, ctx, queue_id):
    row = db.one(conn, "SELECT * FROM unmatched_complaints WHERE id=?", (queue_id,))
    if not row:
        raise HTTPException(404, "queue item not found")
    if ctx.role == "REGIONAL":
        roles.forbid("Regional Offices cannot work the review queue")
    if not can_handle(ctx, row):
        roles.forbid(f"Only {row['bureau']} (the receiving Bureau) or Senior Management can handle this item")
    return row


def list_items(conn, ctx, status="OPEN"):
    rows = [r for r in db.rows(conn, "SELECT * FROM unmatched_complaints ORDER BY created_at DESC, id DESC")
            if can_handle(ctx, r)]
    counts = {s: sum(1 for r in rows if r["status"] == s) for s in STATUSES}
    shown = rows if status.upper() == "ALL" else [r for r in rows if r["status"] == status.upper()]
    return {"items": [_view(r) for r in shown], "total": len(shown), "counts": counts}


def resolve(conn, ctx, queue_id, institution_id):
    row = _get(conn, ctx, queue_id)
    if row["status"] == "RESOLVED":  # idempotent: hand back the case the first call created
        case = services.case_summaries(conn, [row["resolved_case_id"]])
        return {"case": case[0] if case else None, "resolution": None, "overlaps": [], "queue_id": queue_id,
                "already_resolved": True}
    if row["status"] == "DISCARDED":
        raise HTTPException(409, f"{queue_id} was discarded: {row['discard_reason']}")
    institution_id = (institution_id or "").strip()
    if not institution_id:
        raise HTTPException(400, "institution_id is required")
    payload = json.loads(row["payload"])
    # re-validate through the normal path; ctx=None keeps the receiving Bureau recorded at parking time
    d = services.clean_complaint(conn, {**payload, "institution_id": institution_id}, None)
    out = services.register_complaint(conn, d, ctx)
    case_id = out["case"]["case_id"]
    P = ctx.persona
    now = db.now(conn)
    inst_name = out["resolution"]["institution_name"]
    db.append_action(conn, case_id, db.iso(now + timedelta(seconds=3)), P[0], P[1], P[2], "INSTITUTION_MATCHED", None, None,
                     f"Institution matched by {P[1]} from review queue {queue_id}: submitted as "
                     f"\"{row['institution_name']}\", resolved to {inst_name} ({institution_id})")
    conn.execute("UPDATE unmatched_complaints SET status='RESOLVED',resolved_case_id=?,resolved_by=?,resolved_at=? "
                 "WHERE id=?", (case_id, P[1], db.iso(now), queue_id))
    conn.commit()
    events.publish("dashboard.invalidate", {})
    out["case"] = services.case_summaries(conn, [case_id])[0]
    return {**out, "queue_id": queue_id, "already_resolved": False}


def discard(conn, ctx, queue_id, reason):
    row = _get(conn, ctx, queue_id)
    if row["status"] == "DISCARDED":
        return _view(row)
    if row["status"] == "RESOLVED":
        raise HTTPException(409, f"{queue_id} was already resolved as {row['resolved_case_id']}")
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(422, "A reason is required to discard a complaint")
    conn.execute("UPDATE unmatched_complaints SET status='DISCARDED',discard_reason=?,resolved_by=?,resolved_at=? "
                 "WHERE id=?", (reason, ctx.persona[1], db.iso(db.now(conn)), queue_id))
    conn.commit()
    events.publish("dashboard.invalidate", {})
    return _view(db.one(conn, "SELECT * FROM unmatched_complaints WHERE id=?", (queue_id,)))
