"""Read-model helpers (serialisers) and write flows shared by the API routes."""
import json
import random
from datetime import datetime, timedelta

from . import db, events, intel, seed
from .constants import CATEGORY_GROUP, HEADLINE_HIGH, OPEN_STATUSES, SLA_DAYS

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
        c["status"] = ("OPEN" if "OPEN" in s else "LINKED" if "LINKED" in s else
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
            "detected_at": p["detected_at"]}


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
    r = conn.execute("SELECT MAX(case_id) FROM cases WHERE case_id LIKE ?", (prefix + "%",)).fetchone()[0]
    n = int(r.split("/")[-1]) + 1 if r else 1
    return f"{prefix}{n:05d}"


def create_alert(conn, type_, severity, message, case_id=None, institution_id=None, pair_id=None,
                 cluster_id=None, created_at=None):
    cur = conn.execute(
        "INSERT INTO alerts(type,severity,case_id,institution_id,pair_id,cluster_id,message,created_at,is_read) "
        "VALUES(?,?,?,?,?,?,?,?,0)",
        (type_, severity, case_id, institution_id, pair_id, cluster_id, message,
         created_at or db.iso(db.now(conn))))
    return cur.lastrowid


def alert_view(conn, a):
    inst = db.one(conn, "SELECT name FROM institutions WHERE aicte_id=?", (a["institution_id"],)) if a["institution_id"] else None
    return {"id": a["id"], "type": a["type"], "severity": a["severity"], "message": a["message"],
            "case_id": a["case_id"], "institution_id": a["institution_id"],
            "institution_name": inst["name"] if inst else None, "pair_id": a["pair_id"],
            "cluster_id": a["cluster_id"], "created_at": a["created_at"], "read": bool(a["is_read"]),
            "link": a.get("link") or (f"/overlaps?open={a['cluster_id']}" if a["type"] == "OVERLAP" and a["cluster_id"]
                                      else f"/cases/{a['case_id']}" if a["case_id"] else "/alerts")}


def simulate_complaint(conn, scenario=None):
    """File a scripted complaint through the REAL pipeline: resolve -> insert -> score -> alert -> push."""
    n = int(db.get_setting(conn, "sim_counter", "0"))
    if scenario:
        n = int(scenario) - 1
    spec = seed.simulate_spec(conn, n)
    db.set_setting(conn, "sim_counter", n + 1)
    now_dt = db.now(conn)
    reg = intel.Registry(conn)
    res = reg.resolve(spec["name"], None) or {"institution_id": spec["institution"]["aicte_id"],
                                                "method": "NAME", "confidence": 90.0}
    bureau = spec["bureau"]
    case_id = next_case_number(conn, bureau, now_dt.year)
    rng = random.Random(n + 77)
    off_row = db.rows(conn, "SELECT * FROM officers WHERE bureau_code=? AND level<=2 ORDER BY level", (bureau,))
    off = rng.choice(off_row)
    sla = SLA_DAYS[bureau]
    group = CATEGORY_GROUP[spec["category"]]
    conn.execute(
        "INSERT INTO cases(case_id,reference_no,institution_id,submitted_institution_name,submitted_aicte_id,"
        "resolution_method,resolution_conf,source,received_on,category,category_group,severity,description,status,"
        "origin_bureau,bureau_code,assigned_officer_id,last_action,last_action_at,next_action,sla_days,due_date,"
        "escalation_level,transfer_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)",
        (case_id, f"{bureau}-{rng.randint(1000, 9999)}/{now_dt.year}", res["institution_id"], spec["name"], None,
         res["method"], res["confidence"], "CPGRAMS", str(now_dt.date()), spec["category"], group, 4, spec["text"],
         "Received", bureau, bureau, off["id"], "Complaint received", db.iso(now_dt), "Assign and scrutinise",
         sla, str(now_dt.date() + timedelta(days=sla))))
    db.append_action(conn, case_id, db.iso(now_dt), "SYS", "Diary Section", bureau, "RECEIVED", None, None,
                     f"Complaint received via CPGRAMS and diarised as {case_id}")
    db.append_action(conn, case_id, db.iso(now_dt + timedelta(seconds=2)), off["id"], off["name"], bureau,
                     "ASSIGNED", None, None, f"Assigned to {off['name']} ({off['designation']}), {bureau}")
    pairs = intel.detect(conn, only_case=case_id)
    created_alerts = []
    for p in pairs:
        cl = db.one(conn, "SELECT cluster_id FROM overlap_pairs WHERE id=?", (p["id"],))["cluster_id"]
        sev = "HIGH" if p["band"] == "HIGH" else "MEDIUM"
        aid = create_alert(conn, "OVERLAP", sev, p["headline"], case_id, p["institution_id"], p["id"], cl)
        created_alerts.append(aid)
    conn.commit()
    events.publish("case.created", {"case_id": case_id})
    for p in pairs:
        events.publish("overlap.detected", {"pair_id": p["id"], "score": p["score"], "band": p["band"],
                                            "case_id": case_id, "institution_id": p["institution_id"]})
    for aid in created_alerts:
        a = db.one(conn, "SELECT * FROM alerts WHERE id=?", (aid,))
        events.publish("alert.created", alert_view(conn, a))
    events.publish("dashboard.invalidate", {})
    return {"case": case_summaries(conn, [case_id])[0],
            "overlaps": [{"pair_id": p["id"], "score": p["score"], "band": p["band"], "type": p["type"],
                          "other_case": p["case_a"] if p["case_b"] == case_id else p["case_b"]} for p in pairs]}
