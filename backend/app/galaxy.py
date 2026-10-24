"""Connection Galaxy: Obsidian-style knowledge graph topology generator for AICTE ICMD."""
import math
from typing import Dict, Any, List, Optional
from . import db

BUREAU_COLORS = {
    "RB": "#2563eb",     # Blue
    "PGRC": "#059669",   # Green
    "AB": "#d97706",     # Amber
    "LC": "#7c3aed",     # Purple
    "VIG": "#dc2626",    # Red
}

def generate_galaxy_graph(conn, bureau_filter: Optional[str] = None) -> Dict[str, Any]:
    """Generates nodes and edges for the @xyflow/react interactive knowledge graph."""
    now_dt = db.now(conn)
    now_iso = db.iso(now_dt)

    # 1. Fetch relevant cases
    where = "WHERE bureau_code=?" if bureau_filter else ""
    params = (bureau_filter,) if bureau_filter else ()
    cases = db.rows(conn, f"SELECT case_id, institution_id, bureau_code, category, severity, status, due_date, cluster_id, escalation_level, submitted_institution_name FROM cases {where} ORDER BY cluster_id DESC LIMIT 120", params)
    case_ids = {c["case_id"] for c in cases}

    # Distinct institution IDs
    inst_ids = {c["institution_id"] for c in cases if c["institution_id"]}
    if not inst_ids:
        # Fallback to top institutions
        top_insts = db.rows(conn, "SELECT aicte_id FROM institutions LIMIT 12")
        inst_ids = {i["aicte_id"] for i in top_insts}

    inst_rows = db.rows(conn, f"SELECT aicte_id, name, city, state, region, type FROM institutions WHERE aicte_id IN ({','.join(['?']*len(inst_ids))})", tuple(inst_ids))
    inst_map = {r["aicte_id"]: r for r in inst_rows}

    # Overlap pairs involving these cases
    pairs = db.rows(conn, "SELECT id, case_a, case_b, institution_id, score, band, status, cluster_id, headline "
                          "FROM overlap_pairs WHERE status != 'REJECTED'")
    
    # Rooms
    rooms = db.rows(conn, "SELECT id, cluster_id, institution_id, lead_bureau, status FROM coordination_rooms")
    room_map = {r["cluster_id"]: r for r in rooms}

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    center_x, center_y = 650, 450
    inst_positions: Dict[str, tuple] = {}

    # Sort institutions so clusters appear prominently
    sorted_insts = sorted(inst_rows, key=lambda x: (
        sum(1 for c in cases if c["institution_id"] == x["aicte_id"] and c["cluster_id"]),
        sum(1 for c in cases if c["institution_id"] == x["aicte_id"])
    ), reverse=True)

    n_inst = max(1, len(sorted_insts))
    radius_inst = 340

    for idx, inst in enumerate(sorted_insts):
        angle = (2 * math.pi / n_inst) * idx - (math.pi / 2)
        r = radius_inst + (idx % 2) * 50
        ix = center_x + r * math.cos(angle)
        iy = center_y + r * math.sin(angle)
        inst_positions[inst["aicte_id"]] = (ix, iy)

        case_count = sum(1 for c in cases if c["institution_id"] == inst["aicte_id"])
        has_cluster = any(c["institution_id"] == inst["aicte_id"] and c["cluster_id"] for c in cases)

        nodes.append({
            "id": f"inst-{inst['aicte_id']}",
            "type": "institutionNode",
            "position": {"x": round(ix), "y": round(iy)},
            "data": {
                "entityType": "institution",
                "id": inst["aicte_id"],
                "label": inst["name"],
                "city": inst.get("city", ""),
                "state": inst.get("state", ""),
                "region": inst.get("region", ""),
                "caseCount": case_count,
                "hasCluster": has_cluster,
            }
        })

    # Place Bureaus at perimeter
    bureaus = ["RB", "PGRC", "AB", "LC", "VIG"]
    for b_idx, b_code in enumerate(bureaus):
        b_angle = (2 * math.pi / len(bureaus)) * b_idx - (math.pi / 4)
        bx = center_x + 580 * math.cos(b_angle)
        by = center_y + 440 * math.sin(b_angle)
        nodes.append({
            "id": f"bureau-{b_code}",
            "type": "bureauNode",
            "position": {"x": round(bx), "y": round(by)},
            "data": {
                "entityType": "bureau",
                "code": b_code,
                "label": f"Bureau: {b_code}",
                "color": BUREAU_COLORS.get(b_code, "#64748b")
            }
        })

    # Place Cases around their institution
    inst_case_idx: Dict[str, int] = {}
    flagship_cluster_id = None

    for c in cases:
        cid = c["case_id"]
        iid = c["institution_id"]
        ip = inst_positions.get(iid, (center_x, center_y))

        c_idx = inst_case_idx.get(iid, 0)
        inst_case_idx[iid] = c_idx + 1

        sub_angle = (2 * math.pi / 6) * c_idx + (c_idx // 6) * 0.4
        offset_dist = 140 + (c_idx % 2) * 35
        cx = ip[0] + offset_dist * math.cos(sub_angle)
        cy = ip[1] + offset_dist * math.sin(sub_angle)

        is_overdue = bool(c.get("due_date") and c["due_date"] < now_iso[:10])

        if c.get("cluster_id") and not flagship_cluster_id:
            flagship_cluster_id = c["cluster_id"]

        nodes.append({
            "id": f"case-{cid}",
            "type": "caseNode",
            "position": {"x": round(cx), "y": round(cy)},
            "data": {
                "entityType": "case",
                "id": cid,
                "label": cid,
                "bureau": c["bureau_code"],
                "category": c.get("category", "General"),
                "severity": c.get("severity", 1),
                "status": c.get("status", "OPEN"),
                "isOverdue": is_overdue,
                "clusterId": c.get("cluster_id"),
                "institutionId": iid,
                "institutionName": c.get("submitted_institution_name") or (inst_map.get(iid, {}).get("name", "")),
                "bureauColor": BUREAU_COLORS.get(c["bureau_code"], "#64748b"),
            }
        })

        # Edge from Case to Institution
        edges.append({
            "id": f"edge-inst-{cid}",
            "source": f"inst-{iid}",
            "target": f"case-{cid}",
            "type": "default",
            "style": {"stroke": "#cbd5e1", "strokeWidth": 1.2, "strokeDasharray": "3,3"},
        })

        # Edge from Case to Bureau
        edges.append({
            "id": f"edge-bur-{cid}",
            "source": f"bureau-{c['bureau_code']}",
            "target": f"case-{cid}",
            "type": "default",
            "style": {"stroke": BUREAU_COLORS.get(c["bureau_code"], "#94a3b8"), "strokeWidth": 1.0, "opacity": 0.45},
        })

    # Place Overlap Edges & Clusters
    added_clusters = set()
    for p in pairs:
        ca, cb = p["case_a"], p["case_b"]
        if ca in case_ids and cb in case_ids:
            score = round(p.get("score") or 0)
            is_confirmed = p.get("status") in ("LINKED", "CONFIRMED", "RESOLVED")
            is_high = p.get("band") == "HIGH"

            # Color & styling
            stroke = "#06b6d4" if is_confirmed else ("#8b5cf6" if is_high else "#f59e0b")
            width = 3.0 if is_confirmed else 2.0

            edges.append({
                "id": f"overlap-{p['id']}",
                "source": f"case-{ca}",
                "target": f"case-{cb}",
                "type": "smoothstep",
                "animated": is_confirmed or is_high,
                "style": {
                    "stroke": stroke,
                    "strokeWidth": width,
                    "strokeDasharray": "" if is_confirmed else "6,4",
                },
                "data": {
                    "pairId": p["id"],
                    "score": score,
                    "band": p.get("band", "MEDIUM"),
                    "headline": p.get("headline", "Overlap detected"),
                    "isConfirmed": is_confirmed,
                    "clusterId": p.get("cluster_id"),
                }
            })

            # Add Cluster node if not yet added
            cid = p.get("cluster_id")
            if cid and cid not in added_clusters:
                added_clusters.add(cid)
                room = room_map.get(cid)
                # Compute position between cases
                c1 = next((c for c in cases if c["case_id"] == ca), None)
                inst_p = inst_positions.get(p.get("institution_id"), (center_x, center_y))
                nodes.append({
                    "id": f"cluster-{cid}",
                    "type": "clusterNode",
                    "position": {"x": round(inst_p[0] + 40), "y": round(inst_p[1] + 40)},
                    "data": {
                        "entityType": "cluster",
                        "id": cid,
                        "label": f"Taskforce: {cid}",
                        "roomId": room["id"] if room else None,
                        "leadBureau": room["lead_bureau"] if room else None,
                        "status": room["status"] if room else "OPEN",
                    }
                })

    return {
        "nodes": nodes,
        "edges": edges,
        "flagshipClusterId": flagship_cluster_id or (list(added_clusters)[0] if added_clusters else None),
        "totalCases": len(cases),
        "totalInstitutions": len(inst_rows),
        "totalOverlaps": len(edges)
    }
