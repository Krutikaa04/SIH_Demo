"""SLA engine: nearing-timeline warnings, auto-escalation, ping-pong detection, pending-reminder digests.

Idempotent: each threshold is stamped on the case (warned_at / breached_at / severe_at / pingpong_at),
so ticking repeatedly never raises the same alert twice. Uses the demo clock (time machine).
"""
from datetime import datetime, timedelta

from . import db, events
from .constants import BUREAU_ORDER

WARN, BREACH, SEVERE = 0.75, 1.0, 1.5
REMINDER_DAYS = 10


def _alert(conn, type_, severity, message, case_id=None, inst=None, created_at=None, link=None):
    conn.execute(
        "INSERT INTO alerts(type,severity,case_id,institution_id,message,created_at,is_read,link) VALUES(?,?,?,?,?,?,0,?)",
        (type_, severity, case_id, inst, message, created_at, link))


def _officers(conn):
    out = {}
    for o in db.rows(conn, "SELECT * FROM officers ORDER BY level"):
        out.setdefault(o["bureau_code"], {})[o["level"]] = o
    return out


def _escalate(conn, c, level, officers, stamp):
    """Auto-escalate a case to `level` (1 = Deputy Director, 2 = Director / Competent Authority)."""
    boss = officers[c["bureau_code"]][2 + level]
    who = f"{boss['name']} ({boss['designation']})"
    if level == 2:
        remark = f"Timeline exceeded by more than 50%; auto-escalated to {who}, Competent Authority"
    else:
        remark = f"Prescribed timeline of {c['sla_days']} days exceeded; auto-escalated to {who}"
    db.append_action(conn, c["case_id"], stamp, "SYS", "System (SLA engine)", c["bureau_code"], "AUTO_ESCALATE",
                     c["bureau_code"], c["bureau_code"], remark)
    conn.execute("UPDATE cases SET status='Escalated', escalation_level=?, assigned_officer_id=?, last_action=?, "
                 "last_action_at=?, next_action=? WHERE case_id=?",
                 (level, boss["id"], f"Auto-escalated to {boss['designation']}", stamp,
                  "Competent Authority to review and issue directions" if level == 2 else
                  "Deputy Director to review and issue directions", c["case_id"]))
    c["escalation_level"] = level
    return boss["designation"]


def tick(conn, notify=True):
    now_dt = db.now(conn)
    today = now_dt.date()
    stamp = db.iso(now_dt)
    officers = _officers(conn)
    summary = {"near": 0, "escalated": 0, "severe": 0, "pingpong": 0, "reminders": 0, "cases": []}
    nears, escs = [], []
    for c in db.rows(conn, "SELECT * FROM cases WHERE status!='Disposed'"):
        age = (today - datetime.strptime(c["received_on"], "%Y-%m-%d").date()).days
        pct = age / c["sla_days"]
        sets = {}
        if pct >= WARN and not c["warned_at"]:
            sets["warned_at"] = stamp
            if pct < BREACH:
                nears.append(c)
                summary["near"] += 1
        if pct >= BREACH and not c["breached_at"]:
            sets["breached_at"] = stamp
            if c["escalation_level"] < 1:
                escs.append((c, _escalate(conn, c, 1, officers, stamp)))
                summary["escalated"] += 1
                summary["cases"].append(c["case_id"])
        if pct >= SEVERE and not c["severe_at"]:
            sets["severe_at"] = stamp
            if c["escalation_level"] < 2:
                escs.append((c, _escalate(conn, c, 2, officers, stamp)))
                summary["severe"] += 1
                summary["cases"].append(c["case_id"])
        if c["transfer_count"] >= 3 and not c["pingpong_at"]:
            sets["pingpong_at"] = stamp
            _alert(conn, "PING_PONG", "MEDIUM",
                   f"{c['case_id']} has been transferred {c['transfer_count']} times — possible ping-pong; fix ownership",
                   c["case_id"], c["institution_id"], stamp)
            summary["pingpong"] += 1
        if sets:
            conn.execute("UPDATE cases SET " + ",".join(f"{k}=?" for k in sets) + " WHERE case_id=?",
                         (*sets.values(), c["case_id"]))
    # Few events -> one alert each. A burst (e.g. the time machine) -> one digest alert, so the feed stays readable.
    if len(nears) <= 4:
        for c in nears:
            _alert(conn, "SLA_NEAR", "MEDIUM", f"{c['case_id']} is nearing its timeline (due {c['due_date']})",
                   c["case_id"], c["institution_id"], stamp)
    elif nears:
        _alert(conn, "SLA_NEAR", "MEDIUM", f"{len(nears)} cases are now nearing their prescribed timeline",
               created_at=stamp, link="/cases?status=Pending")
    if len(escs) <= 4:
        for c, desig in escs:
            _alert(conn, "ESCALATION", "HIGH", f"{c['case_id']} auto-escalated to {desig} — timeline exceeded",
                   c["case_id"], c["institution_id"], stamp)
    elif escs:
        _alert(conn, "ESCALATION", "HIGH", f"{len(escs)} cases auto-escalated — prescribed timeline exceeded",
               created_at=stamp, link="/cases?status=Escalated")
    summary["reminders"] = reminder_digest(conn, now_dt)
    conn.commit()
    if notify and (summary["escalated"] or summary["severe"] or summary["near"] or summary["reminders"]):
        events.publish("sla.escalated", {k: v for k, v in summary.items() if k != "cases"} |
                       {"cases": summary["cases"][:5]})
        events.publish("dashboard.invalidate", {})
    return summary


def reminder_digest(conn, now_dt):
    """One digest alert per Bureau per (demo) day for pending cases with no recent action."""
    day = str(now_dt.date())
    if db.get_setting(conn, "reminder_day") == day:
        return 0
    cutoff = db.iso(now_dt - timedelta(days=REMINDER_DAYS))
    made = 0
    for b in BUREAU_ORDER:
        n = conn.execute("SELECT COUNT(*) FROM cases WHERE bureau_code=? AND status!='Disposed' AND last_action_at<?",
                         (b, cutoff)).fetchone()[0]
        if n:
            _alert(conn, "PENDING_REMINDER", "MEDIUM",
                   f"{b}: {n} pending case{'s' if n != 1 else ''} with no action for {REMINDER_DAYS}+ days",
                   created_at=db.iso(now_dt), link=f"/cases?bureau={b}&status=Pending")
            made += 1
    db.set_setting(conn, "reminder_day", day)
    return made


def init_state(conn):
    """Called after seeding: stamp thresholds already crossed so the engine only reacts to NEW crossings."""
    now_dt = db.now(conn)
    today = now_dt.date()
    stamp = db.iso(now_dt)
    for c in db.rows(conn, "SELECT case_id,received_on,sla_days,transfer_count FROM cases WHERE status!='Disposed'"):
        pct = (today - datetime.strptime(c["received_on"], "%Y-%m-%d").date()).days / c["sla_days"]
        sets = {}
        if pct >= WARN:
            sets["warned_at"] = stamp
        if pct >= BREACH:
            sets["breached_at"] = stamp
        if pct >= SEVERE:
            sets["severe_at"] = stamp
        if c["transfer_count"] >= 3:
            sets["pingpong_at"] = stamp
        if sets:
            conn.execute("UPDATE cases SET " + ",".join(f"{k}=?" for k in sets) + " WHERE case_id=?",
                         (*sets.values(), c["case_id"]))
        if c["transfer_count"] >= 3:
            _alert(conn, "PING_PONG", "MEDIUM",
                   f"{c['case_id']} has been transferred {c['transfer_count']} times — possible ping-pong; fix ownership",
                   c["case_id"], None, db.iso(now_dt - timedelta(hours=11)))
    reminder_digest(conn, now_dt)
