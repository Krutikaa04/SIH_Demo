"""Scoped executive briefings and an evidence-backed coordination action agenda."""
import json
from datetime import date
from urllib.parse import quote, urlencode

from . import db, risk, roles
from .constants import BUREAUS, REGION_STATES


def _case_link(case_id):
    return f"/cases/{quote(case_id, safe='')}"


def _evidence(kind, label, url):
    return {"kind": kind, "label": label, "url": url}


def _timing(cases, today):
    open_cases = [c for c in cases if c["status"] != "Disposed"]
    overdue = [c for c in open_cases if c["due_date"] < today.isoformat()]
    soon = [c for c in open_cases if 0 <= (date.fromisoformat(c["due_date"]) - today).days <= 7]
    return {
        "open_cases": len(open_cases),
        "overdue_cases": len(overdue),
        "due_soon_cases": len(soon),
        "earliest_due": min((c["due_date"] for c in open_cases), default=None),
    }


def _owner(bureau=None):
    return {"bureau": bureau, "label": f"{bureau} · {BUREAUS[bureau]}" if bureau in BUREAUS
            else "Participating Bureaus / Senior Management"}


def _agenda(cases, rooms, memberships, pairs, today):
    by_id = {c["case_id"]: c for c in cases}
    by_cluster = {}
    for pair in pairs:
        if pair["cluster_id"] and pair["status"] in ("OPEN", "DEFERRED", "LINKED", "CONFIRMED"):
            if pair["case_a"] in by_id and pair["case_b"] in by_id:
                by_cluster.setdefault(pair["cluster_id"], set()).update((pair["case_a"], pair["case_b"]))

    agenda = []

    def add(key, kind, title, owner, reason, members, workflow, extra_evidence=()):
        members = sorted(members, key=lambda c: (c["due_date"], c["case_id"]))
        counts = _timing(members, today)
        urgency = "OVERDUE" if counts["overdue_cases"] else "DUE_SOON" if counts["due_soon_cases"] else "REVIEW"
        timing = f"{counts['overdue_cases']} past the configured due date; {counts['due_soon_cases']} due within 7 days."
        agenda.append({
            "id": key, "kind": kind, "title": title, "owner": owner, "urgency": urgency,
            "reason": f"{reason} {timing}", "counts": counts, "next_action": workflow,
            "evidence": [*extra_evidence, *[_evidence("case", c["case_id"], _case_link(c["case_id"])) for c in members]],
        })

    rooms_by_cluster = {r["cluster_id"]: r for r in rooms}
    for cluster_id, ids in sorted(by_cluster.items()):
        members = [by_id[cid] for cid in ids if by_id[cid]["status"] != "Disposed"]
        bureaus = sorted({c["bureau_code"] for c in members})
        if cluster_id in rooms_by_cluster or len(bureaus) < 2:
            continue
        institution = members[0]["inst_name"]
        url = "/overlaps?" + urlencode({"open": cluster_id})
        add(f"overlap:{cluster_id}", "REVIEW_OVERLAP", f"Review a shared complaint at {institution}", _owner(),
            f"{len(members)} open cases involve {', '.join(bureaus)}. This overlap has no Coordination Room; "
            "check the link evidence before starting joint work.", members,
            {"label": "Review overlap evidence", "url": url}, [_evidence("overlap", cluster_id, url)])

    for room in rooms:
        members = [by_id[cid] for cid in memberships.get(room["id"], []) if cid in by_id]
        pending = [c for c in members if c["status"] != "Disposed"]
        room_url = f"/rooms/{quote(room['id'], safe='')}"
        evidence = [_evidence("room", room["id"], room_url)]
        owner = _owner(room["lead_bureau"])
        if room["status"] == "OPEN" and not room["decision"] and pending:
            add(f"decision:{room['id']}", "DECIDE_ROOM", f"Agree the next step for {room['inst_name']}", owner,
                f"{room['id']} has {len(pending)} open cases and no recorded coordination decision. "
                "The lead Bureau or Senior Management can record the agreed outcome.", pending,
                {"label": "Open the decision room", "url": room_url}, evidence)
        elif room["status"] == "MERGED":
            try:
                decision = json.loads(room["decision"] or "{}")
            except (ValueError, TypeError):
                decision = {}
            if not isinstance(decision, dict) or decision.get("outcome") != "MERGE":
                continue
            followers = [c for c in pending if c["bureau_code"] != room["lead_bureau"]]
            if followers:
                bureaus = ", ".join(sorted({c["bureau_code"] for c in followers}))
                add(f"follow-up:{room['id']}", "FOLLOW_UP_MERGE", f"Follow through on the decision at {room['inst_name']}", owner,
                    f"{len(followers)} linked case(s) at {bureaus} remain open under {room['lead_bureau']}'s lead. "
                    "Check their next steps with the lead; a merge does not close the cases.", followers,
                    {"label": "Review the linked cases", "url": room_url}, evidence)

    for case in cases:
        if case["status"] != "Disposed" and case["transfer_count"] >= 3:
            add(f"ownership:{case['case_id']}", "FIX_OWNERSHIP", f"Settle ownership of {case['case_id']}",
                _owner(case["bureau_code"]),
                f"This open case has been transferred {case['transfer_count']} times. "
                f"Its current Bureau is {case['bureau_code']}; check the history and agree who should handle it.",
                [case], {"label": "Review case ownership", "url": _case_link(case["case_id"])})

    urgency_order = {"OVERDUE": 0, "DUE_SOON": 1, "REVIEW": 2}
    agenda.sort(key=lambda a: (urgency_order[a["urgency"]], -a["counts"]["overdue_cases"],
                               a["counts"]["earliest_due"] or "9999-12-31", a["id"]))
    for rank, action in enumerate(agenda, 1):
        action["rank"] = rank
    return agenda


def generate_executive_briefing(conn, ctx=None):
    """Count stored case facts and suggest review steps; no action or decision is performed."""
    now_dt = db.now(conn)
    today = now_dt.date()
    date_str = now_dt.strftime("%B %d, %Y")
    regional = ctx is not None and ctx.role == "REGIONAL"
    if regional and ctx.region not in REGION_STATES:
        roles.forbid("A recognized region is required for a Regional Office briefing")
    where, params = (" WHERE i.region=?", (ctx.region,)) if regional else ("", ())
    cases = db.rows(conn, "SELECT c.*, i.name AS inst_name, i.region AS inst_region FROM cases c "
                         "JOIN institutions i ON i.aicte_id=c.institution_id" + where + " ORDER BY c.case_id", params)
    rooms = db.rows(conn, "SELECT r.*, i.name AS inst_name FROM coordination_rooms r "
                         "JOIN institutions i ON i.aicte_id=r.institution_id" + where + " ORDER BY r.id", params)
    scoped_ids = {c["case_id"] for c in cases}
    room_ids = {r["id"] for r in rooms}
    memberships = {}
    for membership in db.rows(conn, "SELECT room_id,case_id FROM room_cases ORDER BY room_id,case_id"):
        if membership["room_id"] in room_ids and membership["case_id"] in scoped_ids:
            memberships.setdefault(membership["room_id"], []).append(membership["case_id"])
    pairs = db.rows(conn, "SELECT cluster_id,case_a,case_b,status FROM overlap_pairs")
    agenda = _agenda(cases, rooms, memberships, pairs, today)
    pending = [c for c in cases if c["status"] != "Disposed"]
    overdue = sorted((c for c in pending if c["due_date"] < today.isoformat()),
                     key=lambda c: (c["due_date"], c["case_id"]))
    overdue_rate = round(len(overdue) / len(pending) * 100, 1) if pending else 0.0
    open_rooms = [r for r in rooms if r["status"] == "OPEN"]
    scope = f"{ctx.region} region" if regional else "All regions"
    citations = {}

    def cite_case(case_id):
        token = f"[{case_id}]"
        citations[token] = _case_link(case_id)
        return token

    sections = [{
        "id": "overview", "title": "1. Where complaints stand",
        "badge": scope,
        "content": f"As of {date_str}, {scope.lower()} has {len(cases)} complaints on record. "
                   f"{len(pending)} remain open; {len(overdue)} ({overdue_rate}% of open cases) are past their "
                   "configured due date. The action list highlights unresolved coordination and ownership work.",
    }]
    cluster_lines = []
    for room in open_rooms:
        rid, iid = room["id"], room["institution_id"]
        citations[f"[{rid}]"] = f"/rooms/{quote(rid, safe='')}"
        citations[f"[{iid}]"] = f"/institutions/{quote(iid, safe='')}"
        case_chips = " ".join(cite_case(cid) for cid in memberships.get(rid, [])[:3]) or "No linked cases"
        cluster_lines.append(f"[{rid}] · [{iid}] {room['inst_name']}. Lead: {room['lead_bureau'] or 'Not selected'}. "
                             f"Linked cases: {case_chips}.")
    sections.append({
        "id": "clusters", "title": "2. Rooms still open", "badge": f"{len(open_rooms)} Open Rooms",
        "content": "\n\n".join(cluster_lines) or "No Coordination Rooms are currently open in this scope.",
    })
    all_risks = risk.compute_all(conn)
    inst_names = {c["institution_id"]: c["inst_name"] for c in cases}
    ranked = sorted(((iid, all_risks[iid]) for iid in inst_names if iid in all_risks),
                    key=lambda item: (-item[1]["score"], item[0]))[:4]
    inst_lines = []
    for rank, (iid, info) in enumerate(ranked, 1):
        citations[f"[{iid}]"] = f"/institutions/{quote(iid, safe='')}"
        inst_cases = sorted((c for c in pending if c["institution_id"] == iid),
                            key=lambda c: (c["due_date"], c["case_id"]))[:3]
        case_chips = " ".join(cite_case(c["case_id"]) for c in inst_cases) or "No open cases"
        inst_lines.append(f"{rank}. [{iid}] {inst_names[iid]} · heuristic risk {info['score']}/100 ({info['band']}). "
                          f"Open case evidence: {case_chips}.")
    sections.append({
        "id": "institutions", "title": "3. Institutions to review", "badge": "Heuristic risk score",
        "content": "\n\n".join(inst_lines) or "No institution complaints are recorded in this scope.",
    })
    level_two = sum(1 for c in pending if c["escalation_level"] == 2)
    level_three = sum(1 for c in pending if c["escalation_level"] >= 3)
    overdue_chips = " ".join(cite_case(c["case_id"]) for c in overdue[:4]) or "None"
    sections.append({
        "id": "sla", "title": "4. Configured timelines and escalation", "badge": f"{len(overdue)} Past due",
        "content": f"{len(overdue)} open cases are past their configured due date. "
                   f"Recorded escalation levels among open cases: Level 2: {level_two}; Level 3 or above: {level_three}. "
                   f"Oldest due dates first: {overdue_chips}. "
                   "Prototype timelines are illustrative and are not a statement of statutory deadlines.",
    })
    for action in agenda:
        for evidence in action["evidence"]:
            citations[f"[{evidence['label']}]"] = evidence["url"]
    return {
        "generated_at": date_str, "as_of": db.iso(now_dt), "scope": scope,
        "total_cases": len(cases), "pending_cases": len(pending), "overdue_cases": len(overdue),
        "overdue_rate": overdue_rate, "active_rooms": len(open_rooms), "sections": sections, "citations": citations,
        "action_agenda": agenda,
        "agenda_method": "Past-due work first, then work due within 7 days, then other reviews. "
                         "Within each group: more past-due cases, earlier due dates, then a stable reference order. "
                         "Suggestions do not record decisions or change cases.",
    }
