"""Cases API routes."""
from fastapi import APIRouter, Body, Depends, HTTPException
from .. import db, events, roles, services
from ..constants import BUREAUS
from ..roles import get_ctx

router = APIRouter()


ACTION_LABEL = {"remark": "REMARK", "assign": "ASSIGNED", "transfer": "TRANSFER", "escalate": "ESCALATE",
                "dispose": "DISPOSE"}


@router.get("/api/cases")
def list_cases(q: str = "", bureau: str = "", region: str = "", category: str = "", status: str = "",
               institution_id: str = "", date_from: str = "", date_to: str = "", overdue: int = 0,
               overlap: int = 0, nearing: int = 0, age_gt: int = 0, age_lt: int = 0,
               sort: str = "received_desc", page: int = 1, page_size: int = 25,
               conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    today = db.now(conn).date()
    if ctx.role == "REGIONAL":
        region = ctx.region
    where, params = services.case_where(today, q, bureau, region, category, status, institution_id, date_from,
                                        date_to, overdue, overlap, nearing, age_gt, age_lt)
    w = ("WHERE " + " AND ".join(where)) if where else ""
    order = {"received_desc": "c.received_on DESC, c.case_id", "received_asc": "c.received_on ASC, c.case_id",
             "due_asc": "c.due_date ASC", "severity_desc": "c.severity DESC, c.received_on"}.get(sort, "c.received_on DESC")
    total = conn.execute(f"SELECT COUNT(*) FROM cases c LEFT JOIN institutions i ON i.aicte_id=c.institution_id {w}",
                         params).fetchone()[0]
    page_size = max(1, min(page_size, 200))
    rows = db.rows(conn, services.CASE_SELECT + f" {w} ORDER BY {order} LIMIT ? OFFSET ?",
                   (*params, page_size, (max(page, 1) - 1) * page_size))
    cl, bl = services.cluster_map(conn), services.bureau_lookup(conn)
    return {"items": [services.serialize_case(r, today, cl, bl) for r in rows], "total": total,
            "page": page, "page_size": page_size}



@router.get("/api/cases/{case_id:path}/history")
def case_history(case_id: str, conn=Depends(db.get_conn)):
    if not db.one(conn, "SELECT 1 AS x FROM cases WHERE case_id=?", (case_id,)):
        raise HTTPException(404, "case not found")
    return {"items": services.history_for(conn, case_id)}



@router.post("/api/cases/{case_id:path}/actions")
def case_action(case_id: str, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    c = db.one(conn, services.CASE_SELECT + " WHERE c.case_id=?", (case_id,))
    if not c:
        raise HTTPException(404, "case not found")
    kind = body.get("type")
    if kind not in ACTION_LABEL:
        raise HTTPException(400, "unknown action type")
    if kind not in roles.allowed_actions(ctx, c["bureau_code"], c["inst_region"], c["status"]):
        roles.forbid(f"{roles.ROLE_LABELS[ctx.role]} cannot {kind} this case")
    remarks = (body.get("remarks") or "").strip()
    if kind in ("remark", "dispose") and not remarks:
        raise HTTPException(400, "remarks are required")
    # Coordination guard: overlapping / merged cases cannot be acted on blindly
    guard = services.coordination_guard(conn, c)
    ack_note = ""
    if guard and kind in guard["applies_to"]:
        if guard["level"] == "block" and ctx.role != "SENIOR":
            raise HTTPException(403, guard["message"])
        if not body.get("acknowledge_overlap"):
            raise HTTPException(409, detail={"code": "OVERLAP_ACK_REQUIRED", "guard": guard,
                                             "message": guard["message"]})
        ack_note = f" [Acted with open coordination issue {guard['cluster_id']}: acknowledged by {ctx.persona[1]}]"
    P = ctx.persona
    stamp = db.iso(db.now(conn))
    bureau, upd = c["bureau_code"], {}
    from_b = to_b = None
    officers = {o["level"]: o for o in db.rows(conn, "SELECT * FROM officers WHERE bureau_code=?", (bureau,))}

    if kind == "remark":
        upd = {"last_action": remarks, "next_action": body.get("next_action") or c["next_action"]}
        text = remarks
    elif kind == "assign":
        off = db.one(conn, "SELECT * FROM officers WHERE id=? AND bureau_code=?", (body.get("officer_id"), bureau))
        if not off:
            raise HTTPException(400, "choose an officer of the same Bureau")
        text = f"Assigned to {off['name']} ({off['designation']})" + (f": {remarks}" if remarks else "")
        upd = {"assigned_officer_id": off["id"], "last_action": f"Assigned to {off['name']}",
               "status": "Under Process" if c["status"] in ("Received", "Transferred") else c["status"],
               "next_action": body.get("next_action") or "Examine the complaint and seek reply"}
    elif kind == "transfer":
        to_b = body.get("to_bureau")
        if to_b not in BUREAUS or to_b == bureau:
            raise HTTPException(400, "choose a different Bureau")
        from_b = bureau
        new_off = db.one(conn, "SELECT * FROM officers WHERE bureau_code=? AND level=1", (to_b,))
        text = remarks or f"Transferred to {to_b}"
        upd = {"bureau_code": to_b, "assigned_officer_id": new_off["id"], "status": "Transferred",
               "transfer_count": c["transfer_count"] + 1, "last_action": f"Transferred from {bureau} to {to_b}",
               "next_action": body.get("next_action") or f"{to_b} to acknowledge and examine"}
    elif kind == "escalate":
        level = min(2, c["escalation_level"] + 1)
        boss = officers[2 + level]
        text = remarks or f"Escalated to {boss['name']} ({boss['designation']})"
        upd = {"status": "Escalated", "escalation_level": level, "assigned_officer_id": boss["id"],
               "last_action": f"Escalated to {boss['designation']}",
               "next_action": body.get("next_action") or "Senior officer to review and issue directions"}
        from_b = to_b = bureau
    elif kind == "dispose":
        text = remarks
        upd = {"status": "Disposed", "disposed_on": stamp[:10], "outcome": remarks,
               "last_action": f"Disposed: {remarks}", "next_action": "—"}
    upd["last_action_at"] = stamp
    db.append_action(conn, case_id, stamp, P[0], P[1], P[2], ACTION_LABEL[kind], from_b, to_b, text + ack_note)
    conn.execute("UPDATE cases SET " + ",".join(f"{k}=?" for k in upd) + " WHERE case_id=?", (*upd.values(), case_id))
    if kind == "transfer" and upd["transfer_count"] >= 3 and not c["pingpong_at"]:
        conn.execute("UPDATE cases SET pingpong_at=? WHERE case_id=?", (stamp, case_id))
        services.create_alert(conn, "PING_PONG", "MEDIUM",
                              f"{case_id} has been transferred {upd['transfer_count']} times — possible ping-pong; fix ownership",
                              case_id, c["institution_id"])
    if kind == "escalate":
        services.create_alert(conn, "ESCALATION", "HIGH", f"{case_id} escalated to {boss['designation']}",
                              case_id, c["institution_id"])
    conn.commit()
    events.publish("case.updated", {"case_id": case_id})
    events.publish("dashboard.invalidate", {})
    return get_case(case_id, conn, ctx)



@router.get("/api/cases/{case_id:path}")
def get_case(case_id: str, conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    items = services.case_summaries(conn, [case_id])
    if not items:
        raise HTTPException(404, "case not found")
    case = items[0]
    if ctx.role == "REGIONAL" and case["institution"]["region"] != ctx.region:
        roles.forbid("This case belongs to another region")
    case["allowed_actions"] = roles.allowed_actions(ctx, case["bureau"], case["institution"]["region"], case["status"])
    c = db.one(conn, "SELECT room_id, cluster_id, case_id, status, bureau_code FROM cases WHERE case_id=?", (case_id,))
    guard = services.coordination_guard(conn, c)
    case["guard"] = guard
    if guard and guard["level"] == "block" and ctx.role != "SENIOR":
        case["allowed_actions"] = [a for a in case["allowed_actions"] if a not in services.GUARDED_ACTIONS]
    if c["room_id"]:
        room = db.one(conn, "SELECT id,lead_bureau,status FROM coordination_rooms WHERE id=?", (c["room_id"],))
        case["room"] = room
    return case

