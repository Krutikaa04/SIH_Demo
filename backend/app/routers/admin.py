"""Admin API routes."""
from fastapi import APIRouter, Body, Depends, HTTPException
from .. import db, events, seed, services, sla
from ..roles import require_demo_admin

router = APIRouter()


@router.post("/api/simulate/complaint", dependencies=[Depends(require_demo_admin)])
def simulate(body: dict = Body(default={}), conn=Depends(db.get_conn)):
    return services.simulate_complaint(conn, body.get("scenario"))



@router.get("/api/audit/verify")
def verify(case_id: str = "", conn=Depends(db.get_conn)):
    return db.verify_chain(conn, case_id or None)



@router.post("/api/admin/reset", dependencies=[Depends(require_demo_admin)])
def reset():
    db.READY.wait(30)
    db.READY.clear()
    conn = db.connect()
    try:
        seed.seed(conn)
        conn.commit()
    finally:
        conn.close()
        db.READY.set()
    events.publish("reset", {})
    events.publish("dashboard.invalidate", {})
    return {"ok": True}



@router.post("/api/admin/clock", dependencies=[Depends(require_demo_admin)])
def clock(body: dict = Body(...), conn=Depends(db.get_conn)):
    """Time machine: advance the demo clock, then let the SLA engine react immediately."""
    off = int(db.get_setting(conn, "clock_offset_days", "0")) + int(body.get("add_days", 0))
    db.set_setting(conn, "clock_offset_days", off)
    conn.commit()
    events.publish("clock.changed", {"offset_days": off})
    summary = sla.tick(conn)
    events.publish("dashboard.invalidate", {})
    return {"offset_days": off, "now": db.iso(db.now(conn)), "sla": summary}



@router.post("/api/admin/tamper", dependencies=[Depends(require_demo_admin)])
def tamper(body: dict = Body(default={}), conn=Depends(db.get_conn)):
    """Demo only: alter a history record behind the application's back (raw UPDATE, no re-hash)."""
    case_id, seq = body.get("case_id"), int(body.get("seq") or 2)
    if not case_id:
        r = conn.execute("SELECT case_id FROM action_history GROUP BY case_id HAVING COUNT(*)>=3 "
                         "ORDER BY case_id LIMIT 1").fetchone()
        case_id = r[0]
    row = db.one(conn, "SELECT id, remarks FROM action_history WHERE case_id=? AND seq=?", (case_id, seq))
    if not row:
        raise HTTPException(404, "record not found")
    # Keep the PRISTINE text for restore: never overwrite an existing backup (a second click would otherwise
    # store the already-tampered text), and remember every tampered row, not just the last one.
    key = "tamper_backup_" + str(row["id"])
    if db.get_setting(conn, key) is None:
        db.set_setting(conn, key, row["remarks"])
    ids = [x for x in (db.get_setting(conn, "tampered_row_ids", "") or "").split(",") if x]
    if str(row["id"]) not in ids:
        ids.append(str(row["id"]))
    db.set_setting(conn, "tampered_row_ids", ",".join(ids))
    conn.execute("UPDATE action_history SET remarks='Complaint closed without any action' WHERE id=?", (row["id"],))
    conn.commit()
    events.publish("dashboard.invalidate", {})
    return {"case_id": case_id, "seq": seq}



@router.post("/api/admin/restore-tamper", dependencies=[Depends(require_demo_admin)])
def restore_tamper(conn=Depends(db.get_conn)):
    """Restores the tampered record to its original pristine state and re-verifies the chain."""
    ids = [x for x in (db.get_setting(conn, "tampered_row_ids", "") or "").split(",") if x]
    if not ids:
        v = db.verify_chain(conn)
        return {"restored": False, "message": "No active tamper record registered", "verification": v}
    for row_id in ids:
        orig = db.get_setting(conn, "tamper_backup_" + row_id)
        if orig is not None:
            conn.execute("UPDATE action_history SET remarks=? WHERE id=?", (orig, int(row_id)))
    db.set_setting(conn, "tampered_row_ids", "")
    conn.commit()
    events.publish("dashboard.invalidate", {})
    v = db.verify_chain(conn)
    return {"restored": True, "verification": v}
