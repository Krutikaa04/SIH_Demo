"""Report builders (Bureau-wise, region-wise, institution-wise, ageing, disposal, overlaps, periodic) + briefing."""
import csv
import io
from datetime import date, datetime, timedelta

from . import coordination_metrics, db, risk, services
from .constants import BUREAUS, REGION_STATES, STATUSES

KINDS = {
    "bureau": "Bureau / Cell-wise status report",
    "region": "Region-wise report",
    "institution": "Institution-wise complaint history & risk",
    "status": "Status-wise distribution report",
    "ageing": "Pending case ageing analysis",
    "disposal": "Disposal rate & performance",
    "overlaps": "Overlapping / duplicate cases",
    "periodic": "Monthly / quarterly performance",
    "coordination": "Recorded coordination outcomes",
}


def _d(s):
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def _load(conn, ctx, region=None, bureau=None, date_from=None, date_to=None):
    today = db.now(conn).date()
    rows = db.rows(conn, services.CASE_SELECT)

    effective_region = region
    if ctx.role == "REGIONAL":
        if not ctx.region or ctx.region not in REGION_STATES:
            raise ValueError("A valid region is required for a Regional Office report")
        if region and region != ctx.region:
            raise ValueError(f"Access denied: cannot request region '{region}' while in role REGIONAL ({ctx.region})")
        effective_region = ctx.region

    if effective_region and effective_region not in REGION_STATES:
        raise ValueError(f"Unknown region: '{effective_region}'")

    if bureau and bureau not in BUREAUS:
        raise ValueError(f"Unknown bureau: '{bureau}'")

    if date_from:
        try:
            _d(date_from)
        except Exception:
            raise ValueError(f"Invalid date_from format: '{date_from}' (expected YYYY-MM-DD)")

    if date_to:
        try:
            _d(date_to)
        except Exception:
            raise ValueError(f"Invalid date_to format: '{date_to}' (expected YYYY-MM-DD)")

    if effective_region:
        rows = [r for r in rows if r["inst_region"] == effective_region]
    if bureau:
        rows = [r for r in rows if r["bureau_code"] == bureau]
    if date_from:
        rows = [r for r in rows if r["received_on"] >= date_from]
    if date_to:
        rows = [r for r in rows if r["received_on"] <= date_to]

    for r in rows:
        r["_sla"] = services.sla_info(r, today)
        r["_open"] = r["status"] != "Disposed"
        r["_age"] = r["_sla"]["age_days"]
        if r["disposed_on"]:
            r["_days_to_dispose"] = (_d(r["disposed_on"]) - _d(r["received_on"])).days
    return rows, today, effective_region


def _pct(a, b):
    return round(100 * a / b, 1) if b else 0.0


def _avg(xs):
    xs = list(xs)
    return round(sum(xs) / len(xs), 1) if xs else 0.0


def build(kind, conn, ctx, period="month", region=None, bureau=None, date_from=None, date_to=None):
    if kind not in KINDS:
        raise KeyError(kind)
    rows, today, effective_region = _load(conn, ctx, region=region, bureau=bureau, date_from=date_from, date_to=date_to)
    out = globals()["_" + kind](conn, ctx, rows, today, period) if kind == "periodic" else \
        globals()["_" + kind](conn, ctx, rows, today)
    scope_label = (effective_region + " region") if effective_region else ("All regions")
    out.update({
        "kind": kind,
        "title": KINDS[kind],
        "generated_at": db.iso(db.now(conn)),
        "scope": scope_label,
        "filters": {
            "region": effective_region or "",
            "bureau": bureau or "",
            "date_from": date_from or "",
            "date_to": date_to or "",
            "period": period if kind == "periodic" else "",
        }
    })
    open_ = [r for r in rows if r["_open"]]
    out.setdefault("summary", [{"label": "Total received", "value": len(rows)}, {"label": "Pending", "value": len(open_)},
                      {"label": "Disposed", "value": len(rows) - len(open_)},
                      {"label": "Beyond timeline", "value": sum(1 for r in open_ if r["_sla"]["state"] == "BREACHED")}])
    return out


def _coordination(conn, ctx, rows, today):
    return coordination_metrics.build(conn, rows, today)


def _bureau(conn, ctx, rows, today):
    cols = [("bureau", "Bureau"), ("name", "Name"), ("total", "Cases"), ("pending", "Pending"),
            ("under_process", "Under process"), ("transferred", "Transferred"), ("escalated", "Escalated"),
            ("disposed", "Disposed"), ("overdue", "Beyond timeline"), ("nearing", "Nearing"),
            ("disposal_rate", "Disposal %"), ("avg_pending_age", "Avg pending age (d)")]
    data = []
    for b, name in BUREAUS.items():
        m = [r for r in rows if r["bureau_code"] == b]
        o = [r for r in m if r["_open"]]
        data.append({"bureau": b, "name": name, "total": len(m), "pending": len(o),
                     "under_process": sum(1 for r in m if r["status"] == "Under Process"),
                     "transferred": sum(1 for r in m if r["status"] == "Transferred"),
                     "escalated": sum(1 for r in m if r["status"] == "Escalated"),
                     "disposed": len(m) - len(o),
                     "overdue": sum(1 for r in o if r["_sla"]["state"] == "BREACHED"),
                     "nearing": sum(1 for r in o if r["_sla"]["state"] == "NEARING"),
                     "disposal_rate": _pct(len(m) - len(o), len(m)), "avg_pending_age": _avg(r["_age"] for r in o)})
    return {"columns": [{"key": k, "label": l} for k, l in cols], "rows": data,
            "chart": {"x": "bureau", "series": [{"key": "pending", "label": "Pending", "color": "#3b82f6"},
                                                {"key": "overdue", "label": "Beyond timeline", "color": "#dc2626"},
                                                {"key": "disposed", "label": "Disposed", "color": "#16a34a"}]}}


def _region(conn, ctx, rows, today):
    rk = risk.compute_all(conn)
    inst_region = {r["aicte_id"]: r["region"] for r in db.rows(conn, "SELECT aicte_id,region FROM institutions")}
    cols = [("region", "Region"), ("total", "Cases"), ("pending", "Pending"), ("disposed", "Disposed"),
            ("overdue", "Beyond timeline"), ("disposal_rate", "Disposal %"), ("in_overlap", "Cases in overlap"),
            ("avg_risk", "Avg institution risk")]
    data = []
    for reg in REGION_STATES:
        if ctx.role == "REGIONAL" and reg != ctx.region:
            continue
        m = [r for r in rows if r["inst_region"] == reg]
        o = [r for r in m if r["_open"]]
        risks = [rk[i]["score"] for i, rg in inst_region.items() if rg == reg and i in rk]
        data.append({"region": reg, "total": len(m), "pending": len(o), "disposed": len(m) - len(o),
                     "overdue": sum(1 for r in o if r["_sla"]["state"] == "BREACHED"),
                     "disposal_rate": _pct(len(m) - len(o), len(m)), "in_overlap": sum(1 for r in o if r["cluster_id"]),
                     "avg_risk": _avg(risks)})
    return {"columns": [{"key": k, "label": l} for k, l in cols], "rows": data,
            "chart": {"x": "region", "series": [{"key": "pending", "label": "Pending", "color": "#3b82f6"},
                                                {"key": "overdue", "label": "Beyond timeline", "color": "#dc2626"}]}}


def _institution(conn, ctx, rows, today):
    rk = risk.compute_all(conn)
    insts = {r["aicte_id"]: r for r in db.rows(conn, "SELECT * FROM institutions")}
    by = {}
    for r in rows:
        by.setdefault(r["institution_id"], []).append(r)
    cols = [("name", "Institution"), ("aicte_id", "AICTE ID"), ("region", "Region"), ("total", "Total"),
            ("pending", "Pending"), ("disposed", "Disposed"), ("overdue", "Beyond timeline"),
            ("bureaus", "Bureaus involved"), ("in_overlap", "In overlap"), ("risk", "Risk score"), ("risk_band", "Risk")]
    data = []
    for iid, m in by.items():
        o = [r for r in m if r["_open"]]
        data.append({"name": insts[iid]["name"], "aicte_id": iid, "region": insts[iid]["region"], "total": len(m),
                     "pending": len(o), "disposed": len(m) - len(o),
                     "overdue": sum(1 for r in o if r["_sla"]["state"] == "BREACHED"),
                     "bureaus": ", ".join(sorted({r["bureau_code"] for r in o})) or "—",
                     "in_overlap": sum(1 for r in o if r["cluster_id"]), "risk": rk[iid]["score"],
                     "risk_band": rk[iid]["band"]})
    data.sort(key=lambda x: -x["risk"])
    top = data[:12]
    return {"columns": [{"key": k, "label": l} for k, l in cols], "rows": data,
            "chart": {"x": "short", "rows": [{**t, "short": t["name"].split(",")[-1].strip() + " · " + t["name"].split()[0]} for t in top],
                      "series": [{"key": "risk", "label": "Risk score", "color": "#dc2626"}]}}


def _status(conn, ctx, rows, today):
    cols = [("status", "Status"), ("rb", "RB"), ("pgrc", "PGRC"), ("ab", "AB"),
            ("lc", "LC"), ("vig", "VIG"), ("total", "Total"), ("share", "Share %"),
            ("avg_age", "Avg age (d)")]
    data = []
    for st in STATUSES:
        m = [r for r in rows if r["status"] == st]
        data.append({
            "status": st,
            "rb": sum(1 for r in m if r["bureau_code"] == "RB"),
            "pgrc": sum(1 for r in m if r["bureau_code"] == "PGRC"),
            "ab": sum(1 for r in m if r["bureau_code"] == "AB"),
            "lc": sum(1 for r in m if r["bureau_code"] == "LC"),
            "vig": sum(1 for r in m if r["bureau_code"] == "VIG"),
            "total": len(m),
            "share": _pct(len(m), len(rows)),
            "avg_age": _avg(r["_age"] for r in m),
        })
    return {
        "columns": [{"key": k, "label": l} for k, l in cols],
        "rows": data,
        "chart": {
            "x": "status",
            "stacked": True,
            "series": [
                {"key": "rb", "label": "RB", "color": "#1d4ed8"},
                {"key": "pgrc", "label": "PGRC", "color": "#7c3aed"},
                {"key": "ab", "label": "AB", "color": "#0d9488"},
                {"key": "lc", "label": "LC", "color": "#b45309"},
                {"key": "vig", "label": "VIG", "color": "#be123c"},
            ]
        }
    }


def _ageing(conn, ctx, rows, today):
    cols = [("bureau", "Bureau"), ("b1", "0-15 days"), ("b2", "16-30 days"), ("b3", "31-60 days"), ("b4", "60+ days"),
            ("pending", "Total pending"), ("oldest", "Oldest (days)")]
    data = []
    for b in BUREAUS:
        o = [r for r in rows if r["_open"] and r["bureau_code"] == b]
        data.append({"bureau": b, "b1": sum(1 for r in o if r["_age"] <= 15),
                     "b2": sum(1 for r in o if 15 < r["_age"] <= 30), "b3": sum(1 for r in o if 30 < r["_age"] <= 60),
                     "b4": sum(1 for r in o if r["_age"] > 60), "pending": len(o),
                     "oldest": max((r["_age"] for r in o), default=0)})
    return {"columns": [{"key": k, "label": l} for k, l in cols], "rows": data,
            "chart": {"x": "bureau", "stacked": True, "series": [
                {"key": "b1", "label": "0-15 d", "color": "#22c55e"}, {"key": "b2", "label": "16-30 d", "color": "#eab308"},
                {"key": "b3", "label": "31-60 d", "color": "#f97316"}, {"key": "b4", "label": "60+ d", "color": "#dc2626"}]}}


def _disposal(conn, ctx, rows, today):
    cols = [("bureau", "Bureau"), ("total", "Cases"), ("disposed", "Disposed"), ("rate", "Disposal %"),
            ("avg_days", "Avg days to dispose"), ("within_sla", "Disposed within timeline %")]
    data = []
    groups = [(b, [r for r in rows if r["bureau_code"] == b]) for b in BUREAUS] + [("ALL", rows)]
    for b, m in groups:
        d = [r for r in m if not r["_open"] and "_days_to_dispose" in r]
        data.append({"bureau": b, "total": len(m), "disposed": len(d), "rate": _pct(len(d), len(m)),
                     "avg_days": _avg(r["_days_to_dispose"] for r in d),
                     "within_sla": _pct(sum(1 for r in d if r["_days_to_dispose"] <= r["sla_days"]), len(d))})
    return {"columns": [{"key": k, "label": l} for k, l in cols], "rows": data,
            "chart": {"x": "bureau", "series": [{"key": "rate", "label": "Disposal %", "color": "#16a34a"},
                                                {"key": "within_sla", "label": "Within timeline %", "color": "#2563eb"}]}}


def _overlaps(conn, ctx, rows, today):
    cols = [("cluster", "Cluster"), ("institution", "Institution"), ("region", "Region"), ("bureaus", "Bureaus"),
            ("cases", "Cases"), ("score", "Match %"), ("status", "Status"), ("room", "Coordination Room"),
            ("decision", "Decision")]
    data = []
    for c in services.clusters_view(conn, only_active=False):
        if ctx.role == "REGIONAL" and c["institution"]["region"] != ctx.region:
            continue
        room = db.one(conn, "SELECT id,lead_bureau,decision FROM coordination_rooms WHERE cluster_id=?", (c["cluster_id"],))
        dec = ""
        if room and room["decision"]:
            import json
            d = json.loads(room["decision"])
            dec = f"{d['outcome']} (lead {d['lead_bureau']})"
        data.append({"cluster": c["cluster_id"], "institution": c["institution"]["name"],
                     "region": c["institution"]["region"], "bureaus": ", ".join(c["bureaus"]),
                     "cases": len(c["cases"]), "score": round(c["score"]), "status": c["status"],
                     "room": room["id"] if room else "—", "decision": dec or "—"})
    by_status = {}
    for r in data:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    chart_rows = [{"status": k, "clusters": v} for k, v in by_status.items()]
    return {"columns": [{"key": k, "label": l} for k, l in cols], "rows": data,
            "chart": {"x": "status", "rows": chart_rows, "series": [{"key": "clusters", "label": "Clusters", "color": "#7c3aed"}]}}


def _periodic(conn, ctx, rows, today, period="month"):
    periods = []
    if period == "quarter":
        y, q = today.year, (today.month - 1) // 3
        for _ in range(6):
            start = date(y, q * 3 + 1, 1)
            end = date(y + (1 if q == 3 else 0), 1 if q == 3 else q * 3 + 4, 1) - timedelta(days=1)
            periods.append((f"{y} Q{q + 1}", start, end))
            q -= 1
            if q < 0:
                y, q = y - 1, 3
    else:
        y, m = today.year, today.month
        for _ in range(12):
            start = date(y, m, 1)
            end = (date(y + (m == 12), 1 if m == 12 else m + 1, 1)) - timedelta(days=1)
            periods.append((f"{y}-{m:02d}", start, end))
            m -= 1
            if m == 0:
                y, m = y - 1, 12
    periods.reverse()
    cols = [("period", "Quarter" if period == "quarter" else "Month"), ("received", "Received"), ("disposed", "Disposed"),
            ("backlog", "Pending at period end"), ("within_sla", "Disposed within timeline %"),
            ("avg_days", "Avg days to dispose")]
    data = []
    for label, start, end in periods:
        rec = [r for r in rows if start <= _d(r["received_on"]) <= end]
        dis = [r for r in rows if r["disposed_on"] and start <= _d(r["disposed_on"]) <= end]
        backlog = [r for r in rows if _d(r["received_on"]) <= end and (not r["disposed_on"] or _d(r["disposed_on"]) > end)]
        data.append({"period": label, "received": len(rec), "disposed": len(dis), "backlog": len(backlog),
                     "within_sla": _pct(sum(1 for r in dis if r.get("_days_to_dispose", 9999) <= r["sla_days"]), len(dis)),
                     "avg_days": _avg(r["_days_to_dispose"] for r in dis if "_days_to_dispose" in r)})
    return {"columns": [{"key": k, "label": l} for k, l in cols], "rows": data, "period": period,
            "chart": {"x": "period", "series": [{"key": "received", "label": "Received", "color": "#1d4ed8"},
                                                {"key": "disposed", "label": "Disposed", "color": "#16a34a"}]}}


def to_csv(rep):
    buf = io.StringIO()
    w = csv.writer(buf)
    filter_parts = [f"{k}={v}" for k, v in rep.get("filters", {}).items() if v]
    header = [rep["title"], rep["scope"]]
    if filter_parts:
        header.append("Filters: " + ", ".join(filter_parts))
    header.extend(["Generated " + rep["generated_at"], "SYNTHETIC DATA - PROTOTYPE"])
    w.writerow(header)
    w.writerow([c["label"] for c in rep["columns"]])
    for r in rep["rows"]:
        w.writerow([r.get(c["key"], "") for c in rep["columns"]])
    if rep.get("kind") == "coordination":
        w.writerow([])
        w.writerow(["Counting method", rep["methodology"]])
        w.writerow(["Pair review evidence", "Latest decision", "Officer", "Recorded at", "Case A", "Case B", "Audit action"])
        for review in rep["reviews"]:
            w.writerow([review["pair_id"], review["decision"], review["reviewed_by"], review["reviewed_at"],
                        review["case_a"], review["case_b"], review["audit_action_id"]])
        w.writerow(["Room evidence", "Institution", "Lead bureau", "Outcome", "Selected cases", "Pending followers", "Overdue followers", "Decision days", "Case IDs"])
        for room in rep["evidence"]:
            w.writerow([room["room_id"], room["institution"], room["lead_bureau"], room["outcome"] or room["status"],
                        room["selected_cases"], room["pending_followers"], room["overdue_followers"],
                        room["decision_days"], "; ".join(c["label"] for c in room["cases"])])
    return "\ufeff" + buf.getvalue()


def cases_csv(rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Case ID", "Reference", "Institution", "AICTE ID", "Region", "Category", "Bureau", "Status",
                "Officer", "Received", "Due", "Timeline", "Days remaining", "Last action", "Next action", "Overlap cluster"])
    for c in rows:
        w.writerow([c["case_id"], c["reference_no"], c["institution"]["name"], c["institution"]["aicte_id"],
                    c["institution"]["region"], c["category"], c["bureau"], c["status"], c["assigned_officer"]["name"],
                    c["received_on"], c["expected_disposal"], c["sla"]["state"], c["sla"]["remaining_days"],
                    c["last_action"], c["next_action"], (c["overlap"] or {}).get("cluster_id", "")])
    return "\ufeff" + buf.getvalue()


def institution_history_csv(inst, items, conn):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"Case history for {inst['name']} ({inst['aicte_id']})", f"Region: {inst['region']}", "SYNTHETIC DATA - PROTOTYPE"])
    w.writerow(["Case ID", "Reference", "Category", "Bureau", "Status", "Officer", "Received", "Due", "Timeline", "Days remaining", "Last action", "Last action at", "Next action", "History events count"])
    for c in items:
        event_count = conn.execute("SELECT COUNT(*) FROM action_history WHERE case_id=?", (c["case_id"],)).fetchone()[0]
        w.writerow([
            c["case_id"], c["reference_no"], c["category"], c["bureau"], c["status"],
            c["assigned_officer"]["name"], c["received_on"], c["expected_disposal"],
            c["sla"]["state"], c["sla"]["remaining_days"], c["last_action"] or "—",
            c["last_action_at"] or "—", c["next_action"] or "—", event_count
        ])
    return "\ufeff" + buf.getvalue()


# ---------------------------------------------------------------- briefing --------

def briefing(conn, ctx):
    """Rule-based narrative for management, driven by live numbers (template text, not an LLM)."""
    rows, today, _ = _load(conn, ctx)
    open_ = [r for r in rows if r["_open"]]
    items = []
    cmap = {k: v for k, v in services.cluster_map(conn).items()
            if v["status"] in ("OPEN", "LINKED") and v["cases"] & {r["case_id"] for r in rows}}
    if cmap:
        top = max(services.clusters_view(conn), key=lambda c: c["score"] if c["cluster_id"] in cmap else -1)
        items.append({"tone": "red", "link": "/overlaps",
                      "text": f"{len(cmap)} institutions have complaints handled by 2+ Bureaus in parallel. Strongest match: "
                              f"{top['institution']['name']} ({round(top['score'])}%, {' × '.join(top['bureaus'])})."})
    beyond = [r for r in open_ if r["_sla"]["state"] == "BREACHED"]
    soon = [r for r in open_ if 0 <= r["_sla"]["remaining_days"] <= 7]
    items.append({"tone": "amber", "link": "/cases?overdue=1",
                  "text": f"{len(beyond)} cases are beyond their prescribed timeline; {len(soon)} more will breach within 7 days."})
    if beyond:
        by_reg = {}
        for r in beyond:
            by_reg[r["inst_region"]] = by_reg.get(r["inst_region"], 0) + 1
        by_bur = {}
        for r in beyond:
            by_bur[r["bureau_code"]] = by_bur.get(r["bureau_code"], 0) + 1
        reg = max(by_reg, key=by_reg.get)
        bur = max(by_bur, key=by_bur.get)
        items.append({"tone": "blue", "link": f"/cases?overdue=1&region={reg}",
                      "text": f"Most overdue cases: {reg} region ({by_reg[reg]}) and {bur} ({by_bur[bur]})."})
    rk = risk.compute_all(conn)
    insts = {r["aicte_id"]: r for r in db.rows(conn, "SELECT aicte_id,name,region FROM institutions")}
    scoped = {r["institution_id"] for r in rows}
    ranked = sorted(((rk[i]["score"], i) for i in scoped), reverse=True)
    if ranked:
        sc, iid = ranked[0]
        n_open = sum(1 for r in open_ if r["institution_id"] == iid)
        items.append({"tone": "red", "link": f"/institutions/{iid}",
                      "text": f"Highest-risk institution: {insts[iid]['name']} (risk {sc}) with {n_open} open complaints. "
                              f"{sum(1 for s, _ in ranked if s >= 70)} institutions are in the high-risk band."})
    pp = [r for r in open_ if r["transfer_count"] >= 3]
    if pp:
        items.append({"tone": "amber", "link": "/cases?status=Pending",
                      "text": f"{len(pp)} open cases have been transferred 3+ times — ownership needs fixing."})
    old = max(open_, key=lambda r: r["_age"], default=None)
    disposed = [r for r in rows if not r["_open"]]
    if old:
        items.append({"tone": "green", "link": f"/cases/{old['case_id']}",
                      "text": f"Disposal rate is {_pct(len(disposed), len(rows))}%. Oldest pending case: {old['case_id']} "
                              f"({old['_age']} days, {old['bureau_code']})."})
    return items
