"""Recorded coordination outcomes for an explicitly selected complaint cohort."""
import json
import re
from datetime import datetime, timezone
from statistics import median
from urllib.parse import quote

from . import db
from .constants import BUREAUS

REVIEW = re.compile(r"^Overlap with (.+?) reviewed as (CONFIRMED|REJECTED|DEFERRED)\. Reason: \S")
OUTCOMES = {"MERGE": "MERGED", "RESOLVE": "RESOLVED", "KEEP_SEPARATE": "RESOLVED"}


def _timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        return None


def _reviewed_pairs(conn, case_ids):
    latest = {}
    actions = db.rows(conn, "SELECT id,case_id,action_type,remarks,ts,actor_name FROM action_history "
                           "WHERE action_type IN ('OVERLAP_CONFIRMED','OVERLAP_REJECTED','OVERLAP_DEFERRED') ORDER BY id")
    for action in actions:
        if action["case_id"] not in case_ids:
            continue
        match = REVIEW.match(action["remarks"] or "")
        if not match or match[1] not in case_ids or action["action_type"] != "OVERLAP_" + match[2]:
            continue
        latest[tuple(sorted((action["case_id"], match[1])))] = {"decision": match[2], "audit_action_id": action["id"], "reviewed_at": action["ts"], "reviewed_by": action["actor_name"]}
    results = []
    for pair in db.rows(conn, "SELECT id,case_a,case_b FROM overlap_pairs ORDER BY id"):
        decision = latest.get(tuple(sorted((pair["case_a"], pair["case_b"]))))
        if decision:
            results.append({"pair_id": pair["id"], **decision,
                            "case_a": pair["case_a"], "case_b": pair["case_b"],
                            "cases": [{"label": pair[key], "href": "/cases/" + quote(pair[key], safe="")}
                                      for key in ("case_a", "case_b")]})
    return results


def build(conn, rows, today):
    selected = {r["case_id"]: r for r in rows}
    institutions = {r["institution_id"] for r in rows}
    reviews = _reviewed_pairs(conn, set(selected))
    review_counts = {decision: sum(p["decision"] == decision for p in reviews)
                     for decision in ("CONFIRMED", "REJECTED", "DEFERRED")}
    memberships = {}
    for member in db.rows(conn, "SELECT room_id,case_id FROM room_cases ORDER BY room_id,case_id"):
        if member["case_id"] in selected:
            memberships.setdefault(member["room_id"], []).append(selected[member["case_id"]])
    counts = dict(open=0, MERGE=0, RESOLVE=0, KEEP_SEPARATE=0, pending_followers=0,
                  overdue_followers=0, invalid_decisions=0, invalid_timings=0)
    durations, evidence = [], []
    for room in db.rows(conn, "SELECT * FROM coordination_rooms ORDER BY id"):
        members = memberships.get(room["id"], [])
        if not members or room["institution_id"] not in institutions:
            continue
        counts["open"] += room["status"] == "OPEN"
        decision = None
        try:
            record = json.loads(room["decision"] or "null")
            if isinstance(record, dict) and OUTCOMES.get(record.get("outcome")) == room["status"]:
                decision = record["outcome"]
        except (TypeError, ValueError):
            pass
        if decision is None and (room["decision"] or room["status"] != "OPEN"):
            counts["invalid_decisions"] += 1
        if decision:
            counts[decision] += 1
        followers = [r for r in members if decision == "MERGE" and room["lead_bureau"] in BUREAUS
                     and r["bureau_code"] != room["lead_bureau"] and r["status"] != "Disposed"]
        overdue = [r for r in followers if r["_sla"]["state"] == "BREACHED"]
        counts["pending_followers"] += len(followers)
        counts["overdue_followers"] += len(overdue)
        elapsed = None
        if decision:
            start, end = _timestamp(room["created_at"]), _timestamp(room["resolved_at"])
            if start is not None and end is not None and end >= start:
                elapsed = (end - start).total_seconds() / 86400
                durations.append(elapsed)
            else:
                counts["invalid_timings"] += 1
        evidence.append({
            "room_id": room["id"], "href": "/rooms/" + quote(room["id"], safe=""),
            "institution": members[0]["inst_name"], "lead_bureau": room["lead_bureau"],
            "status": room["status"], "outcome": decision,
            "selected_cases": len(members), "pending_followers": len(followers),
            "overdue_followers": len(overdue), "decision_days": round(elapsed, 2) if elapsed is not None else None,
            "cases": [{"label": r["case_id"], "href": "/cases/" + quote(r["case_id"], safe="")}
                      for r in members],
        })
    decided = sum(counts[k] for k in OUTCOMES)
    median_days = round(median(durations), 2) if durations else None
    measurements = [
        ("reviewed_pairs", "Pairs reviewed by an officer", len(reviews), "Distinct pairs with an explicit review action; latest decision per pair."),
        ("confirmed_pairs", "Confirmed reviews", review_counts["CONFIRMED"], "Latest explicit officer review was Confirmed."),
        ("rejected_pairs", "Rejected reviews", review_counts["REJECTED"], "Latest explicit officer review was Not related."),
        ("deferred_pairs", "Deferred reviews", review_counts["DEFERRED"], "Latest explicit officer review was Defer."),
        ("open_rooms", "Rooms awaiting a decision", counts["open"], "Current room status is OPEN."),
        ("recorded_decisions", "Rooms with recorded decisions", decided, "Distinct rooms with a valid decision matching the current room status."),
        ("merged_rooms", "Merged under a lead bureau", counts["MERGE"], "Recorded MERGE decisions; complaints remain separate records."),
        ("resolved_rooms", "Coordinated and resolved", counts["RESOLVE"], "Coordination closed with RESOLVE; this does not mean complaints were disposed."),
        ("separate_rooms", "Kept separate", counts["KEEP_SEPARATE"], "Recorded KEEP_SEPARATE decisions; no duplicate-work saving is assumed."),
        ("pending_followers", "Pending cases following a merged lead", counts["pending_followers"], "Current selected open members at a different bureau from the merged lead."),
        ("overdue_followers", "Followers past their configured timeline", counts["overdue_followers"], "Pending follower cases whose configured timeline is breached."),
        ("median_decision_days", "Median days to coordination decision", median_days, "Elapsed calendar days from room creation to its latest decision; valid timings only."),
        ("excluded_timings", "Decision timings excluded", counts["invalid_timings"], "Missing, malformed or negative elapsed times are not treated as zero."),
        ("invalid_decisions", "Decision records needing attention", counts["invalid_decisions"], "Unrecognized decision content or status mismatch is excluded from outcomes."),
    ]
    return {
        "columns": [{"key": "measure", "label": "Recorded measure"}, {"key": "value", "label": "Value"},
                    {"key": "basis", "label": "How it is counted"}],
        "rows": [{"key": key, "measure": label, "value": value, "basis": basis}
                 for key, label, value, basis in measurements],
        "summary": [{"label": "Reviewed pairs", "value": len(reviews)},
                    {"label": "Recorded decisions", "value": decided},
                    {"label": "Pending followers", "value": counts["pending_followers"]},
                    {"label": "Median decision days", "value": median_days if median_days is not None else "—"}],
        "chart": {"x": "outcome", "rows": [{"outcome": label, "rooms": counts[key]} for key, label in
                  [("MERGE", "Merged"), ("RESOLVE", "Coordinated"), ("KEEP_SEPARATE", "Kept separate")]],
                  "series": [{"key": "rooms", "label": "Recorded rooms", "color": "#1d4ed8"}]},
        "evidence": evidence, "reviews": reviews,
        "methodology": "Measured from current room membership, recorded decisions and explicit officer review actions. "
                       "Filters select cases by received date and current bureau. A review requires both cases in the cohort; "
                       "a room is counted once if a linked case is selected. Follower counts include only selected cases. "
                       "These are coordination outcomes, not measured hours saved or complaint disposals.",
    }
