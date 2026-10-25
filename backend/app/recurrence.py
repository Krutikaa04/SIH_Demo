"""Read-only chronology linking new complaints to earlier recorded closures."""
import sqlite3
from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException

from . import db
from .constants import OPEN_STATUSES, REGION_STATES
from .roles import get_ctx

router = APIRouter()


def read_connection():
    if not db.READY.wait(30):
        raise HTTPException(503, "The complaint records are being refreshed; try again shortly")
    try:
        conn = sqlite3.connect(db.database_path().resolve().as_uri() + "?mode=ro", uri=True,
                               timeout=30, check_same_thread=False)
    except sqlite3.OperationalError as exc:
        raise HTTPException(503, "Complaint records are not available") from exc
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _date(value):
    if not isinstance(value, str) or len(value) != 10 or value[4] != "-" or value[7] != "-":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _timestamp(value):
    if not isinstance(value, str) or "T" not in value:
        return None
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        return None
    return stamp if stamp.tzinfo is None else None


def _case_link(case_id):
    return "/cases/" + case_id


def aftercare(conn, institution_id, ctx):
    if ctx.role == "REGIONAL" and ctx.region not in REGION_STATES:
        raise HTTPException(403, "Choose a valid region to view institution aftercare")
    institution = db.one(conn, "SELECT aicte_id,name,region FROM institutions WHERE aicte_id=?",
                         (institution_id,))
    if not institution:
        raise HTTPException(404, "Institution not found")
    if ctx.role == "REGIONAL" and institution["region"] != ctx.region:
        raise HTTPException(403, "This institution belongs to another region")

    now = db.now(conn)
    cases = db.rows(conn, "SELECT case_id,category,bureau_code,status,received_on,disposed_on,outcome "
                          "FROM cases WHERE institution_id=?", (institution_id,))
    final_actions = {row["case_id"]: row for row in db.rows(conn, """
        SELECT h.* FROM action_history h JOIN cases c ON c.case_id=h.case_id
        WHERE c.institution_id=? AND h.action_type='DISPOSE' AND h.seq=(
            SELECT MAX(last.seq) FROM action_history last
            WHERE last.case_id=h.case_id AND last.action_type='DISPOSE')
        """, (institution_id,))}
    closures = {}
    open_cases = []
    excluded = 0
    for case in cases:
        received = _date(case["received_on"])
        if not received or received > now.date() or not case["category"]:
            excluded += 1
            continue
        if case["status"] in OPEN_STATUSES:
            open_cases.append((case, received))
        elif case["status"] == "Disposed":
            disposed = _date(case["disposed_on"])
            action = final_actions.get(case["case_id"])
            stamp = _timestamp(action["ts"]) if action else None
            if (not disposed or disposed < received or disposed > now.date() or not action
                    or action["action_type"] != "DISPOSE" or not stamp
                    or stamp.date() != disposed or stamp < datetime.combine(received, time.min)
                    or stamp > now):
                excluded += 1
                continue
            closures.setdefault(case["category"], []).append((disposed, stamp, case, action))

    items = []
    for current, received in open_cases:
        earlier = [closure for closure in closures.get(current["category"], []) if closure[0] < received]
        if not earlier:
            continue
        disposed, _, previous, action = max(earlier, key=lambda row: (row[0], row[1], row[2]["case_id"]))
        items.append({
            "label": "New concern after closure", "category": current["category"],
            "elapsed_days": (received - disposed).days,
            "current": {"case_id": current["case_id"], "bureau": current["bureau_code"],
                        "status": current["status"], "received_on": current["received_on"],
                        "url": _case_link(current["case_id"])},
            "previous": {"case_id": previous["case_id"], "bureau": previous["bureau_code"],
                         "disposed_on": previous["disposed_on"], "outcome": previous["outcome"],
                         "url": _case_link(previous["case_id"]),
                         "final_action": {"seq": action["seq"], "at": action["ts"],
                                          "actor": action["actor_name"] or action["actor_id"],
                                          "remarks": action["remarks"], "hash": action["hash"]}},
        })
    items.sort(key=lambda item: (item["current"]["received_on"], item["current"]["case_id"]), reverse=True)
    return {"institution_id": institution_id, "institution": institution, "as_of": db.iso(now),
            "scope": {"role": ctx.role, "region": ctx.region if ctx.role == "REGIONAL" else ""},
            "items": items, "total": len(items),
            "summary": {"open_cases_checked": len(open_cases),
                        "valid_closures": sum(map(len, closures.values())),
                        "excluded_records": excluded},
            "limitation": "These records show timing and the same complaint category. "
                          "They do not establish a repeated violation, a shared cause or a failed remedy."}


@router.get("/api/institutions/{institution_id}/aftercare")
def institution_aftercare(institution_id: str, ctx=Depends(get_ctx), conn=Depends(read_connection)):
    return aftercare(conn, institution_id, ctx)
