"""Read-model helpers (serialisers) and write flows shared by the API routes."""
import json
import random
from datetime import datetime, timedelta

from . import db, events, intel, seed
from .constants import BUREAUS, CATEGORY_GROUP, HEADLINE_HIGH, OPEN_STATUSES, SLA_DAYS

PERSONA = ("OFF-SM-01", "Competent Authority", "SENIOR")  # P0 has no login; one acting persona

CASE_SELECT = """
SELECT c.*, i.name AS inst_name, i.region AS inst_region, i.city AS inst_city,
       o.name AS off_name, o.designation AS off_desig
FROM cases c
LEFT JOIN institutions i ON i.aicte_id = c.institution_id
LEFT JOIN officers o ON o.id = c.assigned_officer_id
"""


def sla_info(c, today):
    recv = datetime.strptime(c["received_on"], "%Y-%m-%d").date()
    sla = c["sla_days"]
    age = (today - recv).days
    pct = round(age / sla * 100)
    if c["status"] == "Disposed":
        state = "CLOSED"
    elif pct >= 100:
        state = "BREACHED"
    elif pct >= 75:
        state = "NEARING"
    else:
        state = "ON_TRACK"
    return {"days": sla, "age_days": age, "elapsed_pct": pct, "remaining_days": sla - age, "state": state}


def case_where(today, q="", bureau="", region="", category="", status="", institution_id="", date_from="",
               date_to="", overdue=0, overlap=0, nearing=0, age_gt=0, age_lt=0):
    """Shared filter builder for the case list, NL search and CSV export."""
    where, params = [], []
    if q:
        like = f"%{q}%"
        where.append("(c.case_id LIKE ? OR c.institution_id LIKE ? OR i.name LIKE ? OR "
                     "c.submitted_institution_name LIKE ? OR c.description LIKE ? OR c.reference_no LIKE ?)")
        params += [like] * 6
    if bureau:
        where.append("c.bureau_code=?"); params.append(bureau)
    if region:
        where.append("i.region=?"); params.append(region)
    if category:
        where.append("c.category=?"); params.append(category)
    if status == "Pending":
        where.append("c.status!='Disposed'")
    elif status:
        where.append("c.status=?"); params.append(status)
    if institution_id:
        where.append("c.institution_id=?"); params.append(institution_id)
    if date_from:
        where.append("c.received_on>=?"); params.append(date_from)
    if date_to:
        where.append("c.received_on<=?"); params.append(date_to)
    if overdue:
        where.append("c.status!='Disposed' AND c.due_date<?"); params.append(str(today))
    if nearing:
        where.append("c.status!='Disposed' AND c.due_date>=? AND (julianday(?)-julianday(c.received_on))*1.0/c.sla_days>=0.75")
        params += [str(today), str(today)]
    if overlap:
        where.append("c.cluster_id IS NOT NULL")
    if age_gt:
        where.append("(julianday(?)-julianday(c.received_on))>?"); params += [str(today), age_gt]
    if age_lt:
        where.append("(julianday(?)-julianday(c.received_on))<=?"); params += [str(today), age_lt]
    return where, params


def cluster_map(conn):
    """cluster_id -> {band, status, case_ids}"""
    out = {}
    for p in db.rows(conn, "SELECT cluster_id,case_a,case_b,band,status,score FROM overlap_pairs "
                           "WHERE cluster_id IS NOT NULL"):
        c = out.setdefault(p["cluster_id"], {"band": "MEDIUM", "statuses": set(), "cases": set(), "score": 0})
        c["cases"].update([p["case_a"], p["case_b"]])
        c["statuses"].add(p["status"])
        c["score"] = max(c["score"], p["score"])
        if p["band"] == "HIGH":
            c["band"] = "HIGH"
    for c in out.values():
        s = c.pop("statuses")
        # Per-pair review statuses: DEFERRED keeps the overlap open, CONFIRMED keeps it active (like LINKED).
        # Only RESOLVED / DISMISSED end it. (REJECTED pairs are detached from their cluster in review_overlap_pair.)
        c["status"] = ("OPEN" if s & {"OPEN", "DEFERRED"} else "LINKED" if s & {"LINKED", "CONFIRMED"} else
                       "RESOLVED" if "RESOLVED" in s else "DISMISSED")
    return out


def serialize_case(c, today, clusters, bureau_of=None):
    cl = clusters.get(c["cluster_id"]) if c.get("cluster_id") else None
    overlap = None
    if cl:
        others = sorted({bureau_of[x] for x in cl["cases"] if x != c["case_id"] and x in bureau_of})
        overlap = {"cluster_id": c["cluster_id"], "band": cl["band"], "status": cl["status"],
                   "other_bureaus": others, "room_id": c["room_id"]}
    return {
        "case_id": c["case_id"], "reference_no": c["reference_no"],
        "institution": {"aicte_id": c["institution_id"], "name": c["inst_name"], "region": c["inst_region"],
                        "city": c["inst_city"]},
        "submitted_institution_name": c["submitted_institution_name"], "submitted_aicte_id": c["submitted_aicte_id"],
        "resolution": {"method": c["resolution_method"], "confidence": c["resolution_conf"]},
        "source": c["source"], "received_on": c["received_on"], "category": c["category"],
        "category_group": c["category_group"], "severity": c["severity"], "description": c["description"],
        "status": c["status"], "bureau": c["bureau_code"], "origin_bureau": c["origin_bureau"],
        "assigned_officer": {"id": c["assigned_officer_id"], "name": c["off_name"], "designation": c["off_desig"]},
        "last_action": c["last_action"], "last_action_at": c["last_action_at"], "next_action": c["next_action"],
        "expected_disposal": c["due_date"], "disposed_on": c["disposed_on"], "outcome": c["outcome"],
        "sla": sla_info(c, today), "escalation_level": c["escalation_level"], "transfer_count": c["transfer_count"],
        "overlap": overlap,
    }


def bureau_lookup(conn):
    return {r["case_id"]: r["bureau_code"] for r in conn.execute("SELECT case_id,bureau_code FROM cases")}


def case_summaries(conn, case_ids):
    if not case_ids:
        return []
    today = db.now(conn).date()
    rows = db.rows(conn, CASE_SELECT + " WHERE c.case_id IN (%s) ORDER BY c.received_on" % ",".join("?" * len(case_ids)),
                   tuple(case_ids))
    cl, bl = cluster_map(conn), bureau_lookup(conn)
    return [serialize_case(r, today, cl, bl) for r in rows]


def history_for(conn, case_id):
    out = []
    docs = {}
    for d in db.rows(conn, "SELECT id,seq,filename,size,sha256 FROM documents WHERE case_id=? ORDER BY id", (case_id,)):
        docs.setdefault(d["seq"], []).append(d)
    for r in db.rows(conn, "SELECT * FROM action_history WHERE case_id=? ORDER BY seq", (case_id,)):
        out.append({"seq": r["seq"], "ts": r["ts"], "action_type": r["action_type"],
                    "actor": {"id": r["actor_id"], "name": r["actor_name"], "bureau": r["actor_bureau"]},
                    "from_bureau": r["from_bureau"], "to_bureau": r["to_bureau"], "remarks": r["remarks"],
                    "prev_hash": r["prev_hash"], "hash": r["hash"], "case_id": case_id,
                    "documents": docs.get(r["seq"], [])})
    return out


def pair_view(p):
    return {"id": p["id"], "cluster_id": p["cluster_id"], "type": p["type"], "score": p["score"], "band": p["band"],
            "case_a": p["case_a"], "case_b": p["case_b"], "headline": p["headline"], "status": p["status"],
            "breakdown": json.loads(p["breakdown"]), "explanation": p["explanation"],
            "detected_at": p["detected_at"],
            "review_rationale": p.get("review_rationale") if isinstance(p, dict) else (p["review_rationale"] if "review_rationale" in p.keys() else None),
            "review_by": p.get("review_by") if isinstance(p, dict) else (p["review_by"] if "review_by" in p.keys() else None),
            "review_at": p.get("review_at") if isinstance(p, dict) else (p["review_at"] if "review_at" in p.keys() else None)}


def clusters_view(conn, only_active=True):
    cmap = cluster_map(conn)
    insts = {r["aicte_id"]: r for r in db.rows(conn, "SELECT * FROM institutions")}
    pairs = db.rows(conn, "SELECT * FROM overlap_pairs WHERE cluster_id IS NOT NULL ORDER BY score DESC")
    by_cluster = {}
    for p in pairs:
        by_cluster.setdefault(p["cluster_id"], []).append(p)
    out = []
    for cid, plist in by_cluster.items():
        info = cmap[cid]
        if only_active and info["status"] in ("RESOLVED", "DISMISSED"):
            continue
        cases = case_summaries(conn, sorted(info["cases"]))
        inst = insts.get(plist[0]["institution_id"])
        room = db.one(conn, "SELECT id FROM coordination_rooms WHERE cluster_id=?", (cid,))
        out.append({
            "cluster_id": cid, "band": info["band"], "score": info["score"], "status": info["status"],
            "institution": {"aicte_id": inst["aicte_id"], "name": inst["name"], "region": inst["region"],
                            "city": inst["city"]},
            "bureaus": sorted({c["bureau"] for c in cases}),
            "headline": HEADLINE_HIGH if info["band"] == "HIGH" else "Possible Overlap - Review Recommended",
            "cases": cases, "pairs": [pair_view(p) for p in plist], "room_id": room["id"] if room else None,
            "detected_at": max(p["detected_at"] for p in plist),
        })
    out.sort(key=lambda c: (c["status"] not in ("OPEN", "LINKED"), -c["score"]))
    return out


# ---- write flows ---------------------------------------------------------------------



def next_case_number(conn, bureau, year):
    prefix = f"{bureau}/{year}/"

    # Preserve the highest case number already present in the database.
    existing = conn.execute(
        "SELECT MAX(CAST(SUBSTR(case_id, ?) AS INTEGER)) "
        "FROM cases WHERE case_id LIKE ?",
        (len(prefix) + 1, prefix + "%"),
    ).fetchone()[0] or 0

    # Initialize or synchronize the counter without moving it backwards.
    conn.execute(
        """
        INSERT INTO case_number_counters(bureau, year, value)
        VALUES (?, ?, ?)
        ON CONFLICT(bureau, year) DO UPDATE
        SET value = MAX(case_number_counters.value, excluded.value)
        """,
        (bureau, year, existing),
    )

    # Atomically allocate the next number.
    row = conn.execute(
        """
        INSERT INTO case_number_counters(bureau, year, value)
        VALUES (?, ?, 1)
        ON CONFLICT(bureau, year) DO UPDATE
        SET value = case_number_counters.value + 1
        RETURNING value
        """,
        (bureau, year),
    ).fetchone()

    return f"{prefix}{int(row['value']):05d}"



def create_alert(conn, type_, severity, message, case_id=None, institution_id=None, pair_id=None,
                 cluster_id=None, created_at=None, target_bureaus=None):
    """Create an alert. `target_bureaus` = Bureau codes the alert concerns (empty = visible to everyone)."""
    cur = conn.execute(
        "INSERT INTO alerts(type,severity,case_id,institution_id,pair_id,cluster_id,message,created_at,is_read,"
        "target_bureaus) VALUES(?,?,?,?,?,?,?,?,0,?)",
        (type_, severity, case_id, institution_id, pair_id, cluster_id, message,
         created_at or db.iso(db.now(conn)), db.fmt_targets(target_bureaus)))
    return cur.lastrowid


# ---- alert visibility (issue #12) ---------------------------------------------------------
# Matrix: SENIOR sees every alert. A Bureau role (RB, PGRC, AB, LC, VIG) sees alerts whose target_bureaus contains
# its code, plus untargeted ("global"/legacy) alerts. REGIONAL sees alerts about institutions in its region.
# Read state is tracked per role (read_roles), so one Bureau reading a shared alert does not clear it for another.

def alert_filter(ctx):
    """(where_fragments, params) limiting the alerts table to what `ctx` may see."""
    if ctx.role == "SENIOR":
        return [], []
    if ctx.role == "REGIONAL":
        return ["institution_id IN (SELECT aicte_id FROM institutions WHERE region=?)"], [ctx.region]
    return ["(target_bureaus IS NULL OR target_bureaus='' OR target_bureaus LIKE ?)"], [f"%,{ctx.role},%"]


def unread_filter(role):
    """(fragment, params): not read globally (legacy/seed) and not read by this role."""
    return "(is_read=0 AND (read_roles IS NULL OR read_roles NOT LIKE ?))", [f"%,{role},%"]


def alert_visible(conn, ctx, alert):
    if ctx.role == "SENIOR":
        return True
    if ctx.role == "REGIONAL":
        inst = db.one(conn, "SELECT region FROM institutions WHERE aicte_id=?", (alert["institution_id"],)) \
            if alert["institution_id"] else None
        return bool(inst and inst["region"] == ctx.region)
    targets = db.parse_targets(alert.get("target_bureaus"))
    return not targets or ctx.role in targets


_MARK_READ = ("read_roles = CASE WHEN read_roles IS NULL OR read_roles = '' THEN ',' || ? || ',' "
              "WHEN read_roles LIKE ? THEN read_roles ELSE read_roles || ? || ',' END")


def mark_alerts_read(conn, ctx, alert_id=None):
    """Mark one alert (or every alert visible to the role) as read FOR THIS ROLE ONLY."""
    where, params = alert_filter(ctx)
    if alert_id is not None:
        where, params = where + ["id=?"], params + [alert_id]
    w = ("WHERE " + " AND ".join(where)) if where else ""
    conn.execute(f"UPDATE alerts SET {_MARK_READ} {w}", (ctx.role, f"%,{ctx.role},%", ctx.role, *params))


def alert_view(conn, a, role=None):
    inst = db.one(conn, "SELECT name FROM institutions WHERE aicte_id=?", (a["institution_id"],)) if a["institution_id"] else None
    return {"id": a["id"], "type": a["type"], "severity": a["severity"], "message": a["message"],
            "case_id": a["case_id"], "institution_id": a["institution_id"],
            "institution_name": inst["name"] if inst else None, "pair_id": a["pair_id"],
            "cluster_id": a["cluster_id"], "created_at": a["created_at"],
            "read": bool(a["is_read"]) or bool(role and f",{role}," in (a.get("read_roles") or "")),
            "target_bureaus": db.parse_targets(a.get("target_bureaus")),
            "link": a.get("link") or (f"/overlaps?open={a['cluster_id']}" if a["type"] == "OVERLAP" and a["cluster_id"]
                                      else f"/cases/{a['case_id']}" if a["case_id"] else "/alerts")}


# ---- complaint registration (shared by the Register form, CSV import and Simulate) ---------

SOURCES = ["CPGRAMS", "Email", "Letter", "AICTE Portal", "Regional Office", "Court Referral", "Walk-in"]


class Unresolved(Exception):
    """The institution could not be matched with confidence; carries suggestions for the user to pick from."""

    def __init__(self, suggestions):
        super().__init__("Could not match the institution with confidence")
        self.suggestions = suggestions


def clean_complaint(conn, data, ctx, lenient=False):
    """Validate and normalise a complaint payload. Raises ValueError with a human-readable message."""
    today = db.now(conn).date()
    name = (data.get("institution_name") or "").strip()
    inst_id = (data.get("institution_id") or "").strip() or None
    if not name and not inst_id:
        raise ValueError("Institution name is required")
    bureau = ctx.role if (ctx is not None and ctx.is_bureau) else str(data.get("bureau") or "").upper()
    if bureau not in BUREAUS:
        raise ValueError("Choose the receiving Bureau / Cell")
    cat = (data.get("category") or "").strip()
    if cat not in CATEGORY_GROUP:
        if lenient and not cat:
            cat = ""
        else:
            raise ValueError("Choose a valid complaint category")
    desc = " ".join((data.get("description") or "").split())
    if len(desc) < 10 and not lenient:
        raise ValueError("Description must be at least 10 characters")
    try:
        sev = int(data.get("severity") or 3)
    except (TypeError, ValueError):
        raise ValueError("Severity must be 1 to 5")
    if not 1 <= sev <= 5:
        raise ValueError("Severity must be 1 to 5")
    src = (data.get("source") or "Letter").strip()
    if src not in SOURCES:
        raise ValueError("Unknown source: " + src)
    recv = (data.get("received_on") or "").strip() or str(today)
    try:
        rdate = datetime.strptime(recv, "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Date of receipt must be YYYY-MM-DD")
    if rdate > today:
        raise ValueError("Date of receipt cannot be in the future")
    if (today - rdate).days > 730:
        raise ValueError("Date of receipt is more than 2 years old")
    return {"institution_name": name, "aicte_id": (data.get("aicte_id") or "").strip() or None,
            "institution_id": inst_id, "bureau": bureau, "category": cat, "description": desc, "severity": sev,
            "source": src, "received_on": str(rdate)}


def resolve_institution(reg, d):
    if d["institution_id"]:
        if d["institution_id"] not in reg.by_id:
            raise ValueError("Unknown institution selected")
        return {"institution_id": d["institution_id"], "method": "MANUAL", "confidence": 100.0}
    return reg.resolve(d["institution_name"], d["aicte_id"])


def _finish_case(conn, case_id, pairs, notify=True):
    """Alerts + push events for freshly detected overlap pairs. Returns the created alert ids."""
    alert_ids, targets = [], {}
    for p in pairs:
        cl = db.one(conn, "SELECT cluster_id FROM overlap_pairs WHERE id=?", (p["id"],))["cluster_id"]
        sev = "HIGH" if p["band"] == "HIGH" else "MEDIUM"
        # an overlap concerns the Bureaus of BOTH cases
        targets[p["id"]] = sorted({r["bureau_code"] for r in conn.execute(
            "SELECT bureau_code FROM cases WHERE case_id IN (?,?)", (p["case_a"], p["case_b"]))})
        alert_ids.append(create_alert(conn, "OVERLAP", sev, p["headline"], case_id, p["institution_id"], p["id"], cl,
                                      target_bureaus=targets[p["id"]]))
    conn.commit()
    if notify:
        events.publish("case.created", {"case_id": case_id})
        for p in pairs:
            inst = db.one(conn, "SELECT region FROM institutions WHERE aicte_id=?", (p["institution_id"],))
            events.publish("overlap.detected", {"pair_id": p["id"], "score": p["score"], "band": p["band"],
                                                "case_id": case_id, "institution_id": p["institution_id"],
                                                "targets": targets[p["id"]], "region": inst["region"] if inst else None})
        for aid in alert_ids:
            events.publish("alert.created", alert_view(conn, db.one(conn, "SELECT * FROM alerts WHERE id=?", (aid,))))
        events.publish("dashboard.invalidate", {})
    return alert_ids


def park_complaint(conn, d, ctx, suggestions):
    """Store a complaint whose institution could not be matched in the review queue (see unmatched.py)."""
    dup = db.one(conn, "SELECT id FROM unmatched_complaints WHERE status='OPEN' AND bureau=? AND institution_name=? "
                       "AND json_extract(payload,'$.description')=?", (d["bureau"], d["institution_name"], d["description"]))
    if dup:
        raise ValueError(f"This complaint is already waiting in the review queue as {dup['id']}")
    queue_id = "UNM-%04d" % db.next_counter(conn, "unmatched_seq")
    P = ctx.persona if ctx is not None else ("SYS", "Diary Section", "SYS")
    top = suggestions[:5]
    conn.execute("INSERT INTO unmatched_complaints(id,payload,institution_name,aicte_id,bureau,suggestions,created_by,"
                 "created_by_role,created_at,status) VALUES(?,?,?,?,?,?,?,?,?,'OPEN')",
                 (queue_id, json.dumps(d), d["institution_name"], d["aicte_id"], d["bureau"], json.dumps(top), P[1], P[2],
                  db.iso(db.now(conn))))
    conn.commit()
    events.publish("dashboard.invalidate", {})
    return {"status": "PARKED", "queue_id": queue_id, "suggestions": top}


def register_complaint(conn, d, ctx=None, notify=True, reg=None, park_unmatched=False):
    """Register one complaint through the REAL pipeline: resolve -> insert -> history -> overlap scoring -> alerts.

    With park_unmatched an unmatchable institution does not raise Unresolved: the complaint is stored in the review
    queue and {"status": "PARKED", "queue_id": ...} is returned instead of a case."""
    reg = reg or intel.Registry(conn)
    res = resolve_institution(reg, d)
    if not res:
        suggestions = reg.suggest(d["institution_name"])
        if park_unmatched:
            return park_complaint(conn, d, ctx, suggestions)
        raise Unresolved(suggestions)
    twin = db.one(conn, "SELECT case_id FROM cases WHERE institution_id=? AND bureau_code=? AND description=? "
                        "AND status!='Disposed'", (res["institution_id"], d["bureau"], d["description"]))
    if twin:
        raise ValueError(f"Looks like a duplicate of {twin['case_id']} (same institution, Bureau and text)")
    now_dt = db.now(conn)
    bureau = d["bureau"]
    P = ctx.persona if ctx is not None else ("SYS", "Diary Section", "SYS")
    case_id = next_case_number(conn, bureau, now_dt.year)
    load = {r["assigned_officer_id"]: r["n"] for r in db.rows(
        conn, "SELECT assigned_officer_id, COUNT(*) AS n FROM cases WHERE bureau_code=? AND status!='Disposed' "
              "GROUP BY assigned_officer_id", (bureau,))}
    officers = db.rows(conn, "SELECT * FROM officers WHERE bureau_code=? AND level<=2 ORDER BY level", (bureau,))
    off = min(officers, key=lambda o: load.get(o["id"], 0))  # least-loaded desk officer
    sla = SLA_DAYS[bureau]
    rdate = datetime.strptime(d["received_on"], "%Y-%m-%d").date()
    conn.execute(
        "INSERT INTO cases(case_id,reference_no,institution_id,submitted_institution_name,submitted_aicte_id,"
        "resolution_method,resolution_conf,source,received_on,category,category_group,severity,description,status,"
        "origin_bureau,bureau_code,assigned_officer_id,last_action,last_action_at,next_action,sla_days,due_date,"
        "escalation_level,transfer_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)",
        (case_id, f"{bureau}-{random.Random(case_id).randint(1000, 9999)}/{now_dt.year}", res["institution_id"],
         d["institution_name"] or reg.by_id[res["institution_id"]]["name"], d["aicte_id"], res["method"],
         res["confidence"], d["source"], d["received_on"], d["category"], CATEGORY_GROUP[d["category"]],
         d["severity"], d["description"], "Received", bureau, bureau, off["id"], "Complaint received",
         db.iso(now_dt), "Assign and scrutinise", sla, str(rdate + timedelta(days=sla))))
    by = "" if P[0] == "SYS" else f"; registered by {P[1]}"
    db.append_action(conn, case_id, db.iso(now_dt), "SYS", "Diary Section", bureau, "RECEIVED", None, None,
                     f"Complaint received via {d['source']} and diarised as {case_id}{by}")
    db.append_action(conn, case_id, db.iso(now_dt + timedelta(seconds=2)), off["id"], off["name"], bureau,
                     "ASSIGNED", None, None, f"Assigned to {off['name']} ({off['designation']}), {bureau}")
    pairs = intel.detect(conn, only_case=case_id)
    _finish_case(conn, case_id, pairs, notify)
    return {"case": case_summaries(conn, [case_id])[0],
            "resolution": {**res, "institution_name": reg.by_id[res["institution_id"]]["name"],
                           "low_confidence": res["method"] == "NAME_LOW"},
            "overlaps": [{"pair_id": p["id"], "cluster_id": db.one(conn, "SELECT cluster_id FROM overlap_pairs WHERE id=?", (p["id"],))["cluster_id"],
                          "score": p["score"], "band": p["band"], "type": p["type"],
                          "other_case": p["case_a"] if p["case_b"] == case_id else p["case_b"]} for p in pairs]}


def preview_complaint(conn, data, ctx):
    """Dry-run for the Register form: who is the institution, what is already open there, would it overlap?"""
    try:
        d = clean_complaint(conn, data, ctx, lenient=True)
    except ValueError as e:
        return {"ok": False, "message": str(e), "resolution": None, "suggestions": [], "open_cases": [],
                "potential_overlaps": [], "ready": False}
    reg = intel.Registry(conn)
    try:
        res = resolve_institution(reg, d)
    except ValueError as e:
        return {"ok": False, "message": str(e), "resolution": None, "suggestions": [], "open_cases": [],
                "potential_overlaps": [], "ready": False}
    out = {"ok": True, "message": "", "resolution": None, "suggestions": [], "open_cases": [], "potential_overlaps": [],
           "ready": False}
    if not res or res["method"] == "NAME_LOW":
        out["suggestions"] = reg.suggest(d["institution_name"])
    if not res:
        return out
    inst = reg.by_id[res["institution_id"]]
    out["resolution"] = {**res, "institution_id": res["institution_id"], "institution_name": inst["name"],
                         "low_confidence": res["method"] == "NAME_LOW"}
    rows = db.rows(conn, "SELECT case_id FROM cases WHERE institution_id=? AND status!='Disposed' "
                         "ORDER BY received_on DESC LIMIT 12", (res["institution_id"],))
    out["open_cases"] = [{"case_id": c["case_id"], "bureau": c["bureau"], "category": c["category"],
                          "status": c["status"], "received_on": c["received_on"], "last_action": c["last_action"],
                          "sla": c["sla"]} for c in case_summaries(conn, [r["case_id"] for r in rows])]
    if d["category"] and len(d["description"]) >= 10:
        out["ready"] = True
        draft = {"case_id": "NEW/0000/00000", "bureau_code": d["bureau"], "institution_id": res["institution_id"],
                 "submitted_institution_name": d["institution_name"] or inst["name"],
                 "submitted_aicte_id": d["aicte_id"], "resolution_method": res["method"],
                 "resolution_conf": res["confidence"], "category": d["category"], "description": d["description"],
                 "received_on": d["received_on"], "status": "Received"}
        for p in intel.preview_pairs(conn, draft):
            other = p["other"]
            out["potential_overlaps"].append({
                "case_id": other["case_id"], "bureau": other["bureau_code"], "category": other["category"],
                "score": p["score"], "band": p["band"], "type": p["type"], "headline": p["headline"],
                "breakdown": p["breakdown"]})
        out["potential_overlaps"].sort(key=lambda x: -x["score"])
    return out


CSV_ALIASES = {
    "institution_name": ("institution_name", "institution", "name", "college", "institute"),
    "aicte_id": ("aicte_id", "aicte_permanent_id", "institution_id", "id"),
    "bureau": ("bureau", "bureau_cell", "cell", "receiving_bureau"),
    "category": ("category", "nature", "type"),
    "description": ("description", "complaint", "details", "text"),
    "severity": ("severity", "priority"),
    "source": ("source", "channel", "mode"),
    "received_on": ("received_on", "date", "date_of_receipt", "received"),
}
MAX_IMPORT_ROWS = 500


def import_complaints(conn, csv_text, ctx, dry_run=True, park_unmatched=False):
    """Bulk import. dry_run validates and previews every row; otherwise valid rows are registered one by one.

    park_unmatched (real run only): rows whose institution cannot be matched go to the review queue instead of
    being skipped."""
    import csv
    import io as _io
    text = csv_text.lstrip("\ufeff")
    rows = list(csv.DictReader(_io.StringIO(text)))
    if not rows:
        raise ValueError("The CSV has no data rows")
    if len(rows) > MAX_IMPORT_ROWS:
        raise ValueError(f"Too many rows ({len(rows)}); the limit is {MAX_IMPORT_ROWS} per import")
    reg = intel.Registry(conn)
    results, best = [], None
    for n, raw in enumerate(rows, start=2):
        norm = {(k or "").strip().lower().replace(" ", "_"): (v or "") for k, v in raw.items()}
        data = {}
        for field, names in CSV_ALIASES.items():
            data[field] = next((norm[a] for a in names if norm.get(a, "").strip()), "")
        label = data["institution_name"] or data["aicte_id"]
        try:
            d = clean_complaint(conn, data, ctx)
            res = resolve_institution(reg, d)
            if not res:
                suggestions = reg.suggest(d["institution_name"])
                if park_unmatched and not dry_run:
                    parked = park_complaint(conn, d, ctx, suggestions)
                    results.append({"row": n, "status": "parked", "institution_name": label, "bureau": d["bureau"],
                                    "category": d["category"], "queue_id": parked["queue_id"],
                                    "message": "", "suggestions": suggestions[:3]})
                    continue
                results.append({"row": n, "status": "needs_review", "institution_name": label,
                                "message": "Institution not matched with confidence", "suggestions": suggestions[:3]})
                continue
            iname = reg.by_id[res["institution_id"]]["name"]
            if dry_run:
                pv = preview_complaint(conn, data, ctx)
                results.append({"row": n, "status": "ok", "institution_name": label, "matched": iname,
                                "method": res["method"], "confidence": res["confidence"], "bureau": d["bureau"],
                                "category": d["category"], "overlaps": len(pv["potential_overlaps"]),
                                "message": ""})
            else:
                out = register_complaint(conn, d, ctx, notify=False, reg=reg)
                for o in out["overlaps"]:
                    if best is None or o["score"] > best["score"]:
                        best = o
                results.append({"row": n, "status": "created", "institution_name": label, "matched": iname,
                                "case_id": out["case"]["case_id"], "bureau": d["bureau"], "category": d["category"],
                                "overlaps": len(out["overlaps"]), "message": ""})
        except ValueError as e:
            results.append({"row": n, "status": "error", "institution_name": label, "message": str(e)})
        except Unresolved as e:
            results.append({"row": n, "status": "needs_review", "institution_name": label,
                            "message": "Institution not matched with confidence", "suggestions": e.suggestions[:3]})
    counts = {k: sum(1 for r in results if r["status"] == k) for k in ("created", "ok", "needs_review", "parked", "error")}
    counts["overlaps"] = sum(r.get("overlaps", 0) for r in results)
    if not dry_run and counts["created"]:
        events.publish("case.created", {"count": counts["created"]})
        if best:
            events.publish("overlap.detected", {"pair_id": best["pair_id"], "score": best["score"], "band": best["band"]})
        events.publish("dashboard.invalidate", {})
    return {"dry_run": dry_run, "counts": counts, "results": results}


def simulate_complaint(conn, scenario=None):
    """File a scripted complaint through the same pipeline the Register form uses."""
    if scenario:
        n = int(scenario) - 1
    else:
        n = db.next_counter(conn, "sim_counter") - 1

    spec = seed.simulate_spec(conn, n)

    d = {
        "institution_name": spec["name"],
        "institution_id": None,
        "aicte_id": None,
        "bureau": spec["bureau"],
        "category": spec["category"],
        "description": spec["text"],
        "severity": 4,
        "source": "CPGRAMS",
        "received_on": str(db.now(conn).date()),
    }

    try:
        out = register_complaint(conn, d)
    except Unresolved:
        # Scripted fallback: the demo must never fail on a garbled name.
        d["institution_id"] = spec["institution"]["aicte_id"]
        out = register_complaint(conn, d)

    return {"case": out["case"], "overlaps": out["overlaps"]}


# ---- coordination guard -------------------------------------------------------------------

GUARDED_ACTIONS = ("transfer", "escalate", "dispose")


def coordination_guard(conn, c):
    """Does an open overlap / a Coordination Room decision constrain what a Bureau may do with this case?

    level 'ack'   : allowed only after the actor acknowledges the overlap (logged on the case)
    level 'block' : the case follows a lead Bureau (MERGED room); non-lead Bureaus may only remark/assign
    """
    if c["status"] == "Disposed":
        return None
    room = db.one(conn, "SELECT id,lead_bureau,status,cluster_id FROM coordination_rooms WHERE id=?",
                  (c["room_id"],)) if c.get("room_id") else None
    if room and room["status"] == "MERGED":
        if c["bureau_code"] != room["lead_bureau"]:
            return {"level": "block", "code": "FOLLOWS_LEAD", "applies_to": list(GUARDED_ACTIONS),
                    "room_id": room["id"], "lead_bureau": room["lead_bureau"], "cluster_id": room["cluster_id"],
                    "other_bureaus": [room["lead_bureau"]],
                    "message": f"This case follows lead Bureau {room['lead_bureau']} ({room['id']}). "
                               f"Transfer, escalation and disposal are decided by the lead."}
        open_followers = db.rows(
            conn, "SELECT c.case_id, c.bureau_code FROM room_cases rc JOIN cases c ON c.case_id=rc.case_id "
                  "WHERE rc.room_id=? AND c.case_id!=? AND c.status!='Disposed' AND c.bureau_code!=?",
            (room["id"], c["case_id"], room["lead_bureau"]))
        if open_followers:
            return {"level": "ack", "code": "LEAD_WITH_OPEN_FOLLOWERS", "applies_to": ["dispose"],
                    "room_id": room["id"], "lead_bureau": room["lead_bureau"], "cluster_id": room["cluster_id"],
                    "other_bureaus": sorted({f["bureau_code"] for f in open_followers}),
                    "message": f"{len(open_followers)} linked case(s) at {', '.join(sorted({f['bureau_code'] for f in open_followers}))} "
                               f"are still open and follow this lead. Disposing the lead case may leave them without direction."}
        return None
    cid = c.get("cluster_id")
    cl = cluster_map(conn).get(cid) if cid else None
    if cl and cl["status"] in ("OPEN", "LINKED"):
        bl = bureau_lookup(conn)
        others = sorted({bl[x] for x in cl["cases"] if x != c["case_id"] and x in bl and bl[x] != c["bureau_code"]})
        return {"level": "ack", "code": "OPEN_OVERLAP", "applies_to": list(GUARDED_ACTIONS),
                "room_id": c.get("room_id"), "lead_bureau": None, "cluster_id": cid, "other_bureaus": others,
                "message": "This case overlaps with " + (", ".join(others) if others else "other cases") +
                           " and no Coordination decision has been recorded. Acting alone may duplicate or conflict "
                           "with their action."}
    return None
