"""FastAPI app: JSON API under /api, SSE push, and the built React UI served from the same port."""
import asyncio
import json
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import db, events, extras, intel, reports, risk, roles, seed, services, sla, galaxy, briefings
from .constants import (BUREAUS, BUREAU_ORDER, CATEGORIES, OPEN_STATUSES, REGION_STATES, SLA_DAYS, STATUSES)
from .roles import get_ctx

DIST = db.ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app):
    events.bind_loop(asyncio.get_running_loop())

    def _tick():
        conn = db.connect()
        try:
            sla.tick(conn)
        finally:
            conn.close()

    async def _engine():
        while True:
            await asyncio.sleep(30)
            try:
                if db.is_seeded():
                    await asyncio.to_thread(_tick)
            except Exception as e:  # keep the engine alive
                print("[sla] tick failed:", e)

    task = asyncio.create_task(_engine())
    yield
    task.cancel()


app = FastAPI(title="AICTE Integrated Complaint Monitoring", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(extras.router)  # registered first so /api/cases/{id}/documents wins over the catch-all id route


def _is_open(c):
    return c["status"] != "Disposed"


# ------------------------------------------------------------------ meta ----------

@app.get("/api/meta")
def meta():
    return {"bureaus": [{"code": k, "name": v, "sla_days": SLA_DAYS[k]} for k, v in BUREAUS.items()],
            "regions": [{"name": k, "states": v} for k, v in REGION_STATES.items()],
            "categories": [{"name": n, "group": g} for n, g in CATEGORIES], "statuses": STATUSES,
            "roles": [{"code": k, "label": v} for k, v in roles.ROLE_LABELS.items()],
            "sources": services.SOURCES}


@app.get("/api/meta/officers")
def meta_officers(conn=Depends(db.get_conn)):
    return {"items": db.rows(conn, "SELECT id,name,bureau_code,designation,level FROM officers ORDER BY bureau_code, level")}


@app.get("/api/clock")
def get_clock(conn=Depends(db.get_conn)):
    return {"offset_days": int(db.get_setting(conn, "clock_offset_days", "0")), "now": db.iso(db.now(conn))}


# ------------------------------------------------------------------ cases ---------

@app.get("/api/cases")
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


@app.get("/api/cases/{case_id:path}/history")
def case_history(case_id: str, conn=Depends(db.get_conn)):
    if not db.one(conn, "SELECT 1 AS x FROM cases WHERE case_id=?", (case_id,)):
        raise HTTPException(404, "case not found")
    return {"items": services.history_for(conn, case_id)}


@app.get("/api/cases/{case_id:path}")
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


ACTION_LABEL = {"remark": "REMARK", "assign": "ASSIGNED", "transfer": "TRANSFER", "escalate": "ESCALATE",
                "dispose": "DISPOSE"}


@app.post("/api/cases/{case_id:path}/actions")
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


# ------------------------------------------------------------------ institutions ---

@app.get("/api/institutions")
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


@app.get("/api/institutions/{aicte_id}")
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


# ------------------------------------------------------------------ dashboard ------

@app.get("/api/dashboard/summary")
def dashboard(conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    now_dt = db.now(conn)
    today = now_dt.date()
    rows = db.rows(conn, services.CASE_SELECT)
    if ctx.role == "REGIONAL":
        rows = [r for r in rows if r["inst_region"] == ctx.region]
    region_ids = {r["case_id"] for r in rows}
    insts = {r["aicte_id"]: r for r in db.rows(conn, "SELECT * FROM institutions")}
    for r in rows:
        r["_sla"] = services.sla_info(r, today)
    open_ = [r for r in rows if _is_open(r)]
    totals = {
        "received": len(rows), "pending": len(open_),
        "under_process": sum(1 for r in rows if r["status"] == "Under Process"),
        "disposed": sum(1 for r in rows if r["status"] == "Disposed"),
        "transferred": sum(1 for r in rows if r["status"] == "Transferred"),
        "escalated": sum(1 for r in rows if r["status"] == "Escalated"),
        "beyond_sla": sum(1 for r in open_ if r["_sla"]["state"] == "BREACHED"),
        "nearing_sla": sum(1 for r in open_ if r["_sla"]["state"] == "NEARING"),
    }
    workload = []
    for b in BUREAUS:
        mine = [r for r in open_ if r["bureau_code"] == b]
        workload.append({"bureau": b, "name": BUREAUS[b], "pending": len(mine),
                         "under_process": sum(1 for r in mine if r["status"] == "Under Process"),
                         "overdue": sum(1 for r in mine if r["_sla"]["state"] == "BREACHED"),
                         "disposed": sum(1 for r in rows if r["bureau_code"] == b and r["status"] == "Disposed")})
    per_inst = {}
    for r in rows:
        d = per_inst.setdefault(r["institution_id"], {"total": 0, "open": 0, "overdue": 0, "overlap": False})
        d["total"] += 1
        if _is_open(r):
            d["open"] += 1
            if r["_sla"]["state"] == "BREACHED":
                d["overdue"] += 1
            if r["cluster_id"]:
                d["overlap"] = True
    rk = risk.compute_all(conn)
    top = sorted(per_inst.items(), key=lambda kv: (-rk[kv[0]]["score"], -kv[1]["overdue"]))[:8]
    top_institutions = [{"aicte_id": k, "name": insts[k]["name"], "region": insts[k]["region"],
                         "risk": rk[k]["score"], "risk_band": rk[k]["band"], **v} for k, v in top]
    months = []
    y, m = today.year, today.month
    for _ in range(6):
        months.append(f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months.reverse()
    trend = [{"month": mo, "received": sum(1 for r in rows if r["received_on"].startswith(mo)),
              "disposed": sum(1 for r in rows if (r["disposed_on"] or "").startswith(mo))} for mo in months]
    ageing = {"0-15": 0, "16-30": 0, "31-60": 0, "60+": 0}
    for r in open_:
        a = r["_sla"]["age_days"]
        ageing["0-15" if a <= 15 else "16-30" if a <= 30 else "31-60" if a <= 60 else "60+"] += 1
    cmap = services.cluster_map(conn)
    cmap = {k: v for k, v in cmap.items() if v["cases"] & region_ids}
    active = {k: v for k, v in cmap.items() if v["status"] in ("OPEN", "LINKED")}
    resolved = {k: v for k, v in cmap.items() if v["status"] == "RESOLVED"}
    bl = services.bureau_lookup(conn)
    saved_units = sum(max(1, len({bl[c] for c in v["cases"]}) - 1) for v in resolved.values())
    regions = []
    for reg, states in REGION_STATES.items():
        if ctx.role == "REGIONAL" and reg != ctx.region:
            continue
        rr = [r for r in rows if r["inst_region"] == reg]
        ro = [r for r in rr if _is_open(r)]
        reg_risk = [rk[i]["score"] for i, x in insts.items() if x["region"] == reg and i in rk]
        regions.append({"region": reg, "states": states, "total": len(rr), "pending": len(ro),
                        "overdue": sum(1 for r in ro if r["_sla"]["state"] == "BREACHED"),
                        "avg_risk": round(sum(reg_risk) / len(reg_risk), 1) if reg_risk else 0})
    act = [a for a in db.rows(conn, "SELECT h.*, c.institution_id FROM action_history h JOIN cases c "
                                    "ON c.case_id=h.case_id ORDER BY h.ts DESC LIMIT 60") if a["case_id"] in region_ids][:8]
    activity = [{"ts": a["ts"], "case_id": a["case_id"], "action_type": a["action_type"], "actor": a["actor_name"],
                 "bureau": a["actor_bureau"], "remarks": a["remarks"],
                 "institution": insts[a["institution_id"]]["name"]} for a in act]
    desk = None
    if ctx.is_bureau:
        mine = [r for r in open_ if r["bureau_code"] == ctx.role]
        mine.sort(key=lambda r: (r["due_date"], -r["severity"]))
        desk = {"bureau": ctx.role, "name": BUREAUS[ctx.role], "open": len(mine),
                "overdue": sum(1 for r in mine if r["_sla"]["state"] == "BREACHED"),
                "nearing": sum(1 for r in mine if r["_sla"]["state"] == "NEARING"),
                "escalated": sum(1 for r in mine if r["status"] == "Escalated"),
                "in_overlap": sum(1 for r in mine if r["cluster_id"]),
                "urgent": [{"case_id": r["case_id"], "institution": r["inst_name"], "category": r["category"],
                            "status": r["status"], "sla": r["_sla"]} for r in mine[:6]]}
    return {"as_of": db.iso(now_dt), "role": ctx.role, "region": ctx.region, "desk": desk,
            "briefing": reports.briefing(conn, ctx),
            "clock_offset_days": int(db.get_setting(conn, "clock_offset_days", "0")), "totals": totals,
            "overlap": {"open_clusters": len(active),
                        "cases_involved": len({c for v in active.values() for c in v["cases"]}),
                        "rooms_active": conn.execute("SELECT COUNT(*) FROM coordination_rooms WHERE status='OPEN'").fetchone()[0],
                        "resolved_clusters": len(resolved)},
            "effort_saved": {"clusters_resolved": len(resolved), "officer_hours": saved_units * 6,
                             "days": round(saved_units * 4.5, 1),
                             "assumptions": "Estimate: 6 officer-hours and 4.5 days saved per duplicate Bureau "
                                            "track avoided by a coordinated decision."},
            "workload": workload, "top_institutions": top_institutions, "trend": trend, "ageing": ageing,
            "regions": regions, "activity": activity}


# ------------------------------------------------------------------ overlaps -------

@app.get("/api/overlaps")
def overlaps(status: str = "active", conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    items = services.clusters_view(conn, only_active=(status == "active"))
    if ctx.role == "REGIONAL":
        items = [c for c in items if c["institution"]["region"] == ctx.region]
    return {"items": items, "total": len(items)}


@app.get("/api/overlaps/{pair_id}")
def overlap_pair(pair_id: str, conn=Depends(db.get_conn)):
    p = db.one(conn, "SELECT * FROM overlap_pairs WHERE id=?", (pair_id,))
    if not p:
        raise HTTPException(404, "pair not found")
    v = services.pair_view(p)
    v["cases"] = services.case_summaries(conn, [p["case_a"], p["case_b"]])
    return v


@app.post("/api/overlaps/{pair_id}/review")
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



@app.get("/api/galaxy/graph")
def galaxy_graph(
    bureau: str = Query(default=None),
    region: str = Query(default=None),
    institution_id: str = Query(default=None),
    cluster_only: bool = Query(default=False),
    limit: int = Query(default=120, ge=1, le=400),
    conn=Depends(db.get_conn),
):
    return galaxy.generate_galaxy_graph(
        conn,
        bureau_filter=bureau,
        region=region,
        institution_id=institution_id,
        cluster_only=cluster_only,
        limit=limit,
    )



@app.get("/api/briefings/executive")
def executive_briefing(conn=Depends(db.get_conn)):
    return briefings.generate_executive_briefing(conn)



# ------------------------------------------------------------------ rooms ----------

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


@app.post("/api/rooms")
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


@app.get("/api/rooms/{room_id}")
def get_room(room_id: str, conn=Depends(db.get_conn)):
    return _room_view(conn, room_id)


@app.post("/api/rooms/{room_id}/comments")
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


@app.post("/api/rooms/{room_id}/lead")
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


@app.post("/api/rooms/{room_id}/decision")
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


# ------------------------------------------------------------------ alerts ---------

@app.get("/api/alerts")
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


@app.post("/api/alerts/{alert_id}/read")
def read_alert(alert_id: int, conn=Depends(db.get_conn)):
    conn.execute("UPDATE alerts SET is_read=1 WHERE id=?", (alert_id,))
    return {"ok": True}


@app.post("/api/alerts/read-all")
def read_all(conn=Depends(db.get_conn)):
    conn.execute("UPDATE alerts SET is_read=1")
    return {"ok": True}


# ------------------------------------------------------------------ demo / admin ---

@app.post("/api/simulate/complaint")
def simulate(body: dict = Body(default={}), conn=Depends(db.get_conn)):
    return services.simulate_complaint(conn, body.get("scenario"))


@app.get("/api/audit/verify")
def verify(case_id: str = "", conn=Depends(db.get_conn)):
    return db.verify_chain(conn, case_id or None)


@app.post("/api/admin/reset")
def reset():
    db.READY.wait(30)
    db.READY.clear()  # hold back all other requests until the rebuild is complete
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


@app.post("/api/admin/clock")
def clock(body: dict = Body(...), conn=Depends(db.get_conn)):
    """Time machine: advance the demo clock, then let the SLA engine react immediately."""
    off = int(db.get_setting(conn, "clock_offset_days", "0")) + int(body.get("add_days", 0))
    db.set_setting(conn, "clock_offset_days", off)
    conn.commit()
    events.publish("clock.changed", {"offset_days": off})
    summary = sla.tick(conn)
    events.publish("dashboard.invalidate", {})
    return {"offset_days": off, "now": db.iso(db.now(conn)), "sla": summary}


@app.post("/api/admin/tamper")
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


@app.post("/api/admin/restore-tamper")
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



@app.get("/api/events")
async def sse():
    q = events.subscribe()

    async def gen():
        yield "retry: 2000\n\n"
        try:
            while True:
                try:
                    m = await asyncio.wait_for(q.get(), 15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: {m['event']}\ndata: {m['data']}\n\n"
        finally:
            events.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ static UI ------

if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404)
    f = (DIST / full_path)
    if full_path and f.is_file() and DIST in f.resolve().parents:
        return FileResponse(f)
    index = DIST / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})  # never serve a stale UI after a rebuild
    return {"message": "UI not built yet. Run: cd frontend && npm install && npm run build"}
