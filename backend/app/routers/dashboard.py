"""Dashboard API routes."""
from fastapi import APIRouter, Depends
from .. import db, reports, risk, services
from ..constants import BUREAUS, REGION_STATES
from ..roles import get_ctx

router = APIRouter()


def _is_open(c):
    return c["status"] != "Disposed"



@router.get("/api/dashboard/summary")
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

