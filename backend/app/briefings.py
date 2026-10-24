"""Executive briefing generation with clickable case and room citations."""
from datetime import datetime
from typing import Dict, Any, List
from . import db, risk

def generate_executive_briefing(conn) -> Dict[str, Any]:
    """Generates an evidence-grounded executive briefing citing real dockets."""
    now_dt = db.now(conn)
    date_str = now_dt.strftime("%B %d, %Y")

    total_cases = db.one(conn, "SELECT COUNT(*) as c FROM cases")["c"]
    pending_cases = db.one(conn, "SELECT COUNT(*) as c FROM cases WHERE status != 'Disposed'")["c"]
    
    # Overdue cases
    today_iso = db.iso(now_dt)[:10]
    overdue_rows = db.rows(conn, "SELECT case_id, institution_id, bureau_code, category, due_date FROM cases WHERE status != 'Disposed' AND due_date < ?", (today_iso,))
    overdue_count = len(overdue_rows)
    overdue_rate = round((overdue_count / total_cases * 100), 1) if total_cases > 0 else 0.0

    # Coordination Rooms / Clusters
    rooms = db.rows(conn, "SELECT r.id, r.cluster_id, r.institution_id, r.lead_bureau, r.status, i.name as inst_name FROM coordination_rooms r LEFT JOIN institutions i ON r.institution_id=i.aicte_id")
    
    # Top Risk Institutions
    all_risks = risk.compute_all(conn)
    sorted_insts = sorted(all_risks.items(), key=lambda x: x[1]["score"], reverse=True)[:4]
    inst_names = {r["aicte_id"]: r["name"] for r in db.rows(conn, "SELECT aicte_id, name FROM institutions")}

    citations: Dict[str, str] = {}

    sections: List[Dict[str, Any]] = []

    # Section 1: Executive Overview
    risk_assessment = "HIGH ATTENTION REQUIRED" if overdue_count >= 10 or len(rooms) >= 3 else "STANDARD REGULATORY SURVEILLANCE"
    overview_text = (
        f"As of {date_str}, the AICTE Integrated Complaint Monitoring Dashboard tracks {total_cases} total grievances "
        f"across all regulatory bureaus (RB, PGRC, AB, LC, VIG). Currently, {pending_cases} cases remain active/pending, "
        f"of which {overdue_count} cases ({overdue_rate}%) have breached statutory SLA response timelines. "
        f"Inter-bureau overlap correlation has identified multiple multi-agency clusters requiring joint coordination."
    )
    sections.append({
        "id": "overview",
        "title": "1. Executive Summary & Regulatory Stance",
        "badge": risk_assessment,
        "content": overview_text,
    })

    # Section 2: Active Coordination Clusters
    cluster_lines = []
    for r in rooms:
        rid = r["id"]
        cid = r["cluster_id"]
        iid = r["institution_id"]
        iname = r.get("inst_name") or iid
        
        # Cases in this room
        c_in_room = [x[0] for x in conn.execute("SELECT case_id FROM room_cases WHERE room_id=?", (rid,))]
        
        # Add citations
        citations[f"[{rid}]"] = f"/rooms/{rid}"
        citations[f"[{iid}]"] = f"/institutions/{iid}"
        for c in c_in_room[:3]:
            citations[f"[{c}]"] = f"/cases/{c}"

        case_cite_str = " ".join([f"[{c}]" for c in c_in_room[:3]])
        cluster_lines.append(
            f"• Coordination Room [{rid}] (Cluster {cid}): Active inquiry into institution [{iid}] ({iname}). "
            f"Lead Bureau: {r['lead_bureau']}, Status: {r['status']}. Linked dockets: {case_cite_str}."
        )

    if not cluster_lines:
        cluster_lines.append("No active coordination rooms currently open. Automated overlap scan continues to monitor incoming filings.")

    sections.append({
        "id": "clusters",
        "title": "2. High-Priority Multi-Bureau Taskforces",
        "badge": f"{len(rooms)} Active Rooms",
        "content": "\n\n".join(cluster_lines),
    })

    # Section 3: Institutional Review Priority & Risk Hotspots
    inst_lines = []
    for rank, (iid, inst_info) in enumerate(sorted_insts, start=1):
        iname = inst_names.get(iid, iid)
        score = inst_info["score"]
        band = inst_info["band"]
        
        # Get pending cases for this institution
        inst_cases = [r[0] for r in conn.execute("SELECT case_id FROM cases WHERE institution_id=? AND status != 'Disposed' LIMIT 3", (iid,))]
        citations[f"[{iid}]"] = f"/institutions/{iid}"
        for c in inst_cases:
            citations[f"[{c}]"] = f"/cases/{c}"

        case_chips = " ".join([f"[{c}]" for c in inst_cases])
        inst_lines.append(
            f"#{rank}. [{iid}] - {iname} | Risk Score: {score}/100 ({band}). "
            f"Grievances flagged across bureaus with pending investigations: {case_chips if case_chips else 'No active dockets'}."
        )

    sections.append({
        "id": "institutions",
        "title": "3. Institutional Review Priority & Risk Hotspots",
        "badge": "Automated Heuristic Score",
        "content": "\n\n".join(inst_lines),
    })

    # Section 4: SLA Escalation & Statutory Horizon
    overdue_sample = overdue_rows[:4]
    overdue_chips = []
    for row in overdue_sample:
        cid = row["case_id"]
        citations[f"[{cid}]"] = f"/cases/{cid}"
        overdue_chips.append(f"[{cid}] ({row['bureau_code']} - {row['category']})")

    sla_text = (
        f"A total of {overdue_count} cases are currently beyond statutory disposition deadlines. "
        f"Under automatic statutory escalation rules, Level 2 supervisor alerts and Level 3 Directorate escalations "
        f"are active. Recent critical overdue cases include: {' '.join(overdue_chips) if overdue_chips else 'None'}."
    )
    sections.append({
        "id": "sla",
        "title": "4. Statutory SLA & Compliance Health",
        "badge": f"{overdue_count} Breached",
        "content": sla_text,
    })

    return {
        "generated_at": date_str,
        "total_cases": total_cases,
        "pending_cases": pending_cases,
        "overdue_cases": overdue_count,
        "active_rooms": len(rooms),
        "sections": sections,
        "citations": citations,
    }
