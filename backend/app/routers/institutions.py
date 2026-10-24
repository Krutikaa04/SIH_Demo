"""Institutions API routes."""
import json
from fastapi import APIRouter, Depends, HTTPException
from .. import db, risk, roles, services
from ..roles import get_ctx

router = APIRouter()


@router.get("/api/institutions")
def list_institutions(q: str = "", region: str = "", conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    today = str(db.now(conn).date())
    if ctx.role == "REGIONAL":
        region = ctx.region
    where, params = [], []
    if q:
        where.append("(i.name LIKE ? OR i.aicte_id LIKE ? OR i.city LIKE ?)"); params += [f"%{q}%"] * 3
    if region:
        where.append("i.region=?"); params.append(region)
    w = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.rows(conn, f"""
      SELECT i.aicte_id,i.name,i.city,i.state,i.region,i.type,
        COUNT(c.case_id) AS total,
        SUM(CASE WHEN c.status!='Disposed' THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN c.status!='Disposed' AND c.due_date<? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN c.cluster_id IS NOT NULL AND c.status!='Disposed' THEN 1 ELSE 0 END) AS in_overlap
      FROM institutions i LEFT JOIN cases c ON c.institution_id=i.aicte_id {w}
      GROUP BY i.aicte_id ORDER BY open DESC, total DESC""", (today, *params))
    rk = risk.compute_all(conn)
    for r in rows:
        for k in ("open", "overdue", "in_overlap"):
            r[k] = r[k] or 0
        r["risk"] = rk.get(r["aicte_id"], {"score": 0, "band": "LOW"})["score"]
        r["risk_band"] = rk.get(r["aicte_id"], {"score": 0, "band": "LOW"})["band"]
    return {"items": rows, "total": len(rows)}



@router.get("/api/institutions/{aicte_id}")
def get_institution(aicte_id: str, conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    inst = db.one(conn, "SELECT * FROM institutions WHERE aicte_id=?", (aicte_id,))
    if not inst:
        raise HTTPException(404, "institution not found")
    if ctx.role == "REGIONAL" and inst["region"] != ctx.region:
        roles.forbid("This institution belongs to another region")
    inst["programmes"] = json.loads(inst["programmes"])
    ids = [r[0] for r in conn.execute("SELECT case_id FROM cases WHERE institution_id=? ORDER BY received_on DESC", (aicte_id,))]
    cases = services.case_summaries(conn, ids)
    cases.sort(key=lambda c: c["received_on"], reverse=True)
    open_cases = [c for c in cases if c["status"] != "Disposed"]
    clusters = [c for c in services.clusters_view(conn, only_active=False) if c["institution"]["aicte_id"] == aicte_id]
    rk = risk.compute_all(conn).get(aicte_id, {"score": 0, "band": "LOW", "breakdown": []})
    return {"institution": inst, "cases": cases, "clusters": clusters, "risk": rk,
            "stats": {"total": len(cases), "open": len(open_cases),
                      "overdue": sum(1 for c in open_cases if c["sla"]["state"] == "BREACHED"),
                      "bureaus_involved": sorted({c["bureau"] for c in open_cases})}}

