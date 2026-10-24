"""Alerts API routes."""
from fastapi import APIRouter, Depends
from .. import db, services
from ..roles import get_ctx

router = APIRouter()


@router.get("/api/alerts")
def alerts(unread: int = 0, type: str = "", limit: int = 100, conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    where, params = [], []
    if unread:
        where.append("is_read=0")
    if type:
        where.append("type=?"); params.append(type)
    w = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.rows(conn, f"SELECT * FROM alerts {w} ORDER BY created_at DESC, id DESC LIMIT ?", (*params, 400))
    items = [services.alert_view(conn, a) for a in rows]
    if ctx.role == "REGIONAL":
        reg = {r["aicte_id"]: r["region"] for r in db.rows(conn, "SELECT aicte_id,region FROM institutions")}
        items = [a for a in items if a["institution_id"] and reg.get(a["institution_id"]) == ctx.region]
    return {"items": items[:limit], "unread": sum(1 for a in items if not a["read"])}



@router.post("/api/alerts/{alert_id}/read")
def read_alert(alert_id: int, conn=Depends(db.get_conn)):
    conn.execute("UPDATE alerts SET is_read=1 WHERE id=?", (alert_id,))
    return {"ok": True}



@router.post("/api/alerts/read-all")
def read_all(conn=Depends(db.get_conn)):
    conn.execute("UPDATE alerts SET is_read=1")
    return {"ok": True}

