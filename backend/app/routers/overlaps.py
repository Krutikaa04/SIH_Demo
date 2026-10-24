"""Overlaps API routes."""
from fastapi import APIRouter, Body, Depends, HTTPException
from .. import db, events, intel, roles, services
from ..roles import get_ctx

router = APIRouter()


@router.get("/api/overlaps")
def overlaps(status: str = "active", conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    items = services.clusters_view(conn, only_active=(status == "active"))
    if ctx.role == "REGIONAL":
        items = [c for c in items if c["institution"]["region"] == ctx.region]
    return {"items": items, "total": len(items)}



@router.get("/api/overlaps/{pair_id}")
def overlap_pair(pair_id: str, conn=Depends(db.get_conn)):
    p = db.one(conn, "SELECT * FROM overlap_pairs WHERE id=?", (pair_id,))
    if not p:
        raise HTTPException(404, "pair not found")
    v = services.pair_view(p)
    v["cases"] = services.case_summaries(conn, [p["case_a"], p["case_b"]])
    return v



@router.post("/api/overlaps/{pair_id}/review")
def review_overlap_pair(pair_id: str, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    decision = (body.get("decision") or "").upper()
    rationale = (body.get("rationale") or "").strip()
    if decision not in ("CONFIRMED", "REJECTED", "DEFERRED"):
        raise HTTPException(400, "Decision must be CONFIRMED, REJECTED, or DEFERRED")
    if not rationale:
        raise HTTPException(422, "Mandatory review rationale is required")
    if ctx.role == "REGIONAL":
        roles.forbid("Regional Offices cannot review overlap links")
    p = db.one(conn, "SELECT * FROM overlap_pairs WHERE id=?", (pair_id,))
    if not p:
        raise HTTPException(404, "Pair not found")

    now_iso = db.iso(db.now(conn))
    P = ctx.persona
    actor_id, actor_name, actor_bureau = P[0], P[1], P[2]

    conn.execute(
        "UPDATE overlap_pairs SET status=?, review_rationale=?, review_by=?, review_at=? WHERE id=?",
        (decision, rationale, actor_name, now_iso, pair_id)
    )
    # Record in the cryptographic audit trail of BOTH cases
    for mine, other in ((p["case_a"], p["case_b"]), (p["case_b"], p["case_a"])):
        db.append_action(
            conn, mine, now_iso, actor_id, actor_name, actor_bureau,
            f"OVERLAP_{decision}", None, None,
            f"Overlap with {other} reviewed as {decision}. Reason: {rationale}"
        )
    if decision == "REJECTED":
        # "Not related": take the pair out of its cluster, and free any case that has no other active link
        conn.execute("UPDATE overlap_pairs SET cluster_id=NULL WHERE id=?", (pair_id,))
        for cid in (p["case_a"], p["case_b"]):
            still_linked = conn.execute(
                "SELECT 1 FROM overlap_pairs WHERE cluster_id IS NOT NULL AND status NOT IN ('REJECTED') "
                "AND (case_a=? OR case_b=?) LIMIT 1", (cid, cid)).fetchone()
            if not still_linked:
                conn.execute("UPDATE cases SET cluster_id=NULL WHERE case_id=?", (cid,))
    # re-derive clusters (a previously rejected pair that is now CONFIRMED / DEFERRED re-joins its cluster)
    intel.recluster(conn, p["institution_id"])
    conn.commit()
    events.publish("dashboard.invalidate", {})
    return {"ok": True, "pair_id": pair_id, "status": decision, "review_rationale": rationale, "review_by": actor_name, "review_at": now_iso}
