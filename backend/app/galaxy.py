
"""Connection Galaxy: Obsidian-style knowledge graph topology generator for AICTE ICMD."""

import math
from typing import Any, Dict, List, Optional

from . import db


BUREAU_COLORS = {
    "RB": "#2563eb",     # Blue
    "PGRC": "#059669",   # Green
    "AB": "#d97706",     # Amber
    "LC": "#7c3aed",     # Purple
    "VIG": "#dc2626",    # Red
}

DEFAULT_LIMIT = 120
MAX_LIMIT = 400


def generate_galaxy_graph(
    conn,
    bureau_filter: Optional[str] = None,
    region: Optional[str] = None,
    institution_id: Optional[str] = None,
    cluster_only: bool = False,
    limit: int = DEFAULT_LIMIT,
) -> Dict[str, Any]:
    """Generate the Connection Galaxy graph with optional filters.

    totalCases is the count of all cases matching the active filters before
    pagination. shownCases is the number included in the graph. Cases belonging
    to active clusters are prioritized before the result limit is applied.
    """

    now_dt = db.now(conn)
    now_iso = db.iso(now_dt)
    today = now_iso[:10]

    # Enforce safe limits even when this function is called outside the API.
    limit = max(1, min(int(limit), MAX_LIMIT))

    # Fetch filter options independently of the active graph filters so that
    # users can change filters without losing the available choices.
    option_rows = db.rows(
        conn,
        """
        SELECT aicte_id, name, region
        FROM institutions
        ORDER BY name
        """,
    )

    regions = sorted(
        {
            str(row["region"]).strip()
            for row in option_rows
            if row.get("region") and str(row["region"]).strip()
        },
        key=str.casefold,
    )

    institution_options = [
        {
            "id": row["aicte_id"],
            "label": row.get("name") or str(row["aicte_id"]),
            "region": row.get("region") or "",
        }
        for row in option_rows
    ]

    # Build shared filter conditions for both the count query and the
    # limited case query. The LEFT JOIN allows cases without institution
    # records to remain visible unless a region filter is selected.
    conditions: List[str] = []
    params: List[Any] = []

    if bureau_filter:
        conditions.append("c.bureau_code = ?")
        params.append(bureau_filter)

    if region:
        conditions.append("LOWER(TRIM(i.region)) = LOWER(TRIM(?))")
        params.append(region)

    if institution_id:
        conditions.append("c.institution_id = ?")
        params.append(institution_id)

    if cluster_only:
        conditions.append("c.cluster_id IS NOT NULL")

    where_clause = (
        "WHERE " + " AND ".join(conditions)
        if conditions
        else ""
    )

    institution_join = (
        "LEFT JOIN institutions i ON i.aicte_id = c.institution_id"
    )

    # Count all matching cases before applying the display limit.
    count_row = conn.execute(
        f"""
        SELECT COUNT(*)
        FROM cases c
        {institution_join}
        {where_clause}
        """,
        tuple(params),
    ).fetchone()

    total_cases = int(count_row[0]) if count_row else 0

    # Active-cluster cases are prioritized first. Within each priority group,
    # overdue cases and higher-severity cases appear before lower-priority ones.
    cases = db.rows(
        conn,
        f"""
        SELECT
            c.case_id,
            c.institution_id,
            c.bureau_code,
            c.category,
            c.severity,
            c.status,
            c.due_date,
            c.cluster_id,
            c.escalation_level,
            c.submitted_institution_name
        FROM cases c
        {institution_join}
        {where_clause}
        ORDER BY
            CASE
                WHEN c.cluster_id IS NOT NULL
                 AND EXISTS (
                    SELECT 1
                    FROM overlap_pairs op
                    WHERE op.cluster_id = c.cluster_id
                      AND op.status != 'REJECTED'
                 )
                THEN 0
                ELSE 1
            END ASC,
            CASE
                WHEN c.due_date IS NOT NULL
                 AND c.due_date < ?
                THEN 0
                ELSE 1
            END ASC,
            COALESCE(c.severity, 0) DESC,
            c.case_id ASC
        LIMIT ?
        """,
        tuple(params) + (today, limit),
    )

    shown_cases = len(cases)
    truncated = shown_cases < total_cases
    case_ids = {case["case_id"] for case in cases}

    # Count cases per institution once instead of repeatedly scanning all
    # cases while sorting and building institution nodes.
    institution_counts: Dict[str, int] = {}
    clustered_counts: Dict[str, int] = {}

    for case in cases:
        iid = case.get("institution_id")
        if not iid:
            continue

        institution_counts[iid] = institution_counts.get(iid, 0) + 1

        if case.get("cluster_id"):
            clustered_counts[iid] = clustered_counts.get(iid, 0) + 1

    # Only create institution nodes for institutions represented by the
    # displayed cases. This avoids unrelated nodes when filters return no cases.
    inst_ids = {
        case["institution_id"]
        for case in cases
        if case.get("institution_id")
    }

    inst_rows: List[Dict[str, Any]] = []

    if inst_ids:
        placeholders = ",".join("?" for _ in inst_ids)
        inst_rows = db.rows(
            conn,
            f"""
            SELECT aicte_id, name, city, state, region, type
            FROM institutions
            WHERE aicte_id IN ({placeholders})
            """,
            tuple(inst_ids),
        )

    inst_map = {row["aicte_id"]: row for row in inst_rows}

    # Fetch only non-rejected overlap pairs. Edges are subsequently created
    # only when both endpoint cases are present in the graph.
    pairs = db.rows(
        conn,
        """
        SELECT
            id, case_a, case_b, institution_id, score, band,
            status, cluster_id, headline
        FROM overlap_pairs
        WHERE status != 'REJECTED'
        """,
    )

    rooms = db.rows(
        conn,
        """
        SELECT id, cluster_id, institution_id, lead_bureau, status
        FROM coordination_rooms
        """,
    )
    room_map = {room["cluster_id"]: room for room in rooms}

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    center_x, center_y = 650, 450
    inst_positions: Dict[str, tuple] = {}

    # Cluster-heavy institutions are placed first. Dictionary lookups keep
    # this sorting step efficient as the number of displayed cases increases.
    sorted_insts = sorted(
        inst_rows,
        key=lambda inst: (
            clustered_counts.get(inst["aicte_id"], 0),
            institution_counts.get(inst["aicte_id"], 0),
            str(inst.get("name") or "").casefold(),
        ),
        reverse=True,
    )

    n_inst = max(1, len(sorted_insts))
    radius_inst = 340

    for idx, inst in enumerate(sorted_insts):
        iid = inst["aicte_id"]

        angle = (2 * math.pi / n_inst) * idx - (math.pi / 2)
        radius = radius_inst + (idx % 2) * 50
        ix = center_x + radius * math.cos(angle)
        iy = center_y + radius * math.sin(angle)

        inst_positions[iid] = (ix, iy)

        nodes.append(
            {
                "id": f"inst-{iid}",
                "type": "institutionNode",
                "position": {
                    "x": round(ix),
                    "y": round(iy),
                },
                "data": {
                    "entityType": "institution",
                    "id": iid,
                    "label": inst.get("name") or str(iid),
                    "city": inst.get("city") or "",
                    "state": inst.get("state") or "",
                    "region": inst.get("region") or "",
                    "caseCount": institution_counts.get(iid, 0),
                    "hasCluster": clustered_counts.get(iid, 0) > 0,
                },
            }
        )

    # Retain all standard bureau nodes and add any additional bureau codes
    # encountered in the selected cases, ensuring case-to-bureau edges connect.
    standard_bureaus = ["RB", "PGRC", "AB", "LC", "VIG"]
    case_bureaus = {
        case.get("bureau_code")
        for case in cases
        if case.get("bureau_code")
    }
    bureaus = standard_bureaus + sorted(
        case_bureaus - set(standard_bureaus)
    )

    for b_idx, b_code in enumerate(bureaus):
        b_angle = (2 * math.pi / len(bureaus)) * b_idx - (math.pi / 4)
        bx = center_x + 580 * math.cos(b_angle)
        by = center_y + 440 * math.sin(b_angle)

        nodes.append(
            {
                "id": f"bureau-{b_code}",
                "type": "bureauNode",
                "position": {
                    "x": round(bx),
                    "y": round(by),
                },
                "data": {
                    "entityType": "bureau",
                    "code": b_code,
                    "label": f"Bureau: {b_code}",
                    "color": BUREAU_COLORS.get(b_code, "#64748b"),
                },
            }
        )

    # Place cases around their institution where possible. Missing institution
    # records do not create invalid institution edges.
    inst_case_idx: Dict[str, int] = {}
    flagship_cluster_id = None

    for case in cases:
        cid = case["case_id"]
        iid = case.get("institution_id")

        ip = inst_positions.get(iid, (center_x, center_y))

        c_idx = inst_case_idx.get(iid, 0)
        inst_case_idx[iid] = c_idx + 1

        sub_angle = (2 * math.pi / 6) * c_idx + (c_idx // 6) * 0.4
        offset_dist = 140 + (c_idx % 2) * 35
        cx = ip[0] + offset_dist * math.cos(sub_angle)
        cy = ip[1] + offset_dist * math.sin(sub_angle)

        due_date = case.get("due_date")
        is_overdue = bool(due_date and due_date < today)

        if case.get("cluster_id") and not flagship_cluster_id:
            flagship_cluster_id = case["cluster_id"]

        bureau_code = case.get("bureau_code")
        bureau_color = BUREAU_COLORS.get(bureau_code, "#64748b")

        nodes.append(
            {
                "id": f"case-{cid}",
                "type": "caseNode",
                "position": {
                    "x": round(cx),
                    "y": round(cy),
                },
                "data": {
                    "entityType": "case",
                    "id": cid,
                    "label": cid,
                    "bureau": bureau_code,
                    "category": case.get("category") or "General",
                    "severity": case.get("severity") or 1,
                    "status": case.get("status") or "OPEN",
                    "isOverdue": is_overdue,
                    "clusterId": case.get("cluster_id"),
                    "institutionId": iid,
                    "institutionName": (
                        case.get("submitted_institution_name")
                        or inst_map.get(iid, {}).get("name", "")
                    ),
                    "bureauColor": bureau_color,
                },
            }
        )

        # Add the institution edge only if its node exists.
        if iid in inst_positions:
            edges.append(
                {
                    "id": f"edge-inst-{cid}",
                    "source": f"inst-{iid}",
                    "target": f"case-{cid}",
                    "type": "default",
                    "style": {
                        "stroke": "#cbd5e1",
                        "strokeWidth": 1.2,
                        "strokeDasharray": "3,3",
                    },
                }
            )

        # Bureau nodes are always added for each case's bureau code.
        if bureau_code:
            edges.append(
                {
                    "id": f"edge-bur-{cid}",
                    "source": f"bureau-{bureau_code}",
                    "target": f"case-{cid}",
                    "type": "default",
                    "style": {
                        "stroke": bureau_color,
                        "strokeWidth": 1.0,
                        "opacity": 0.45,
                    },
                }
            )

    # Add overlap edges only when both cases are in the displayed graph.
    # Rejected overlap pairs are excluded by the query above.
    added_clusters = set()

    for pair in pairs:
        case_a = pair["case_a"]
        case_b = pair["case_b"]

        if case_a not in case_ids or case_b not in case_ids:
            continue

        score = round(pair.get("score") or 0)
        is_confirmed = pair.get("status") in (
            "LINKED",
            "CONFIRMED",
            "RESOLVED",
        )
        is_high = pair.get("band") == "HIGH"

        stroke = (
            "#06b6d4"
            if is_confirmed
            else ("#8b5cf6" if is_high else "#f59e0b")
        )
        width = 3.0 if is_confirmed else 2.0

        edges.append(
            {
                "id": f"overlap-{pair['id']}",
                "source": f"case-{case_a}",
                "target": f"case-{case_b}",
                "type": "smoothstep",
                "animated": is_confirmed or is_high,
                "style": {
                    "stroke": stroke,
                    "strokeWidth": width,
                    "strokeDasharray": "" if is_confirmed else "6,4",
                },
                "data": {
                    "pairId": pair["id"],
                    "score": score,
                    "band": pair.get("band") or "MEDIUM",
                    "headline": pair.get("headline") or "Overlap detected",
                    "isConfirmed": is_confirmed,
                    "clusterId": pair.get("cluster_id"),
                },
            }
        )

        cluster_id = pair.get("cluster_id")

        if cluster_id and cluster_id not in added_clusters:
            added_clusters.add(cluster_id)

            room = room_map.get(cluster_id)
            institution_position = inst_positions.get(
                pair.get("institution_id"),
                (center_x, center_y),
            )

            nodes.append(
                {
                    "id": f"cluster-{cluster_id}",
                    "type": "clusterNode",
                    "position": {
                        "x": round(institution_position[0] + 40),
                        "y": round(institution_position[1] + 40),
                    },
                    "data": {
                        "entityType": "cluster",
                        "id": cluster_id,
                        "label": f"Taskforce: {cluster_id}",
                        "roomId": room["id"] if room else None,
                        "leadBureau": room["lead_bureau"] if room else None,
                        "status": room["status"] if room else "OPEN",
                    },
                }
            )

    overlap_count = sum(
        1 for edge in edges if edge["id"].startswith("overlap-")
    )

    return {
        # Existing response keys retained for backward compatibility.
        "nodes": nodes,
        "edges": edges,
        "flagshipClusterId": (
            flagship_cluster_id
            or (sorted(added_clusters)[0] if added_clusters else None)
        ),
        "totalCases": total_cases,
        "totalInstitutions": len(inst_rows),
        # This key now accurately counts overlap edges, not all graph edges.
        "totalOverlaps": overlap_count,

        # Additive metadata for pagination and frontend filters.
        "shownCases": shown_cases,
        "truncated": truncated,
        "filterOptions": {
            "regions": regions,
            "institutions": institution_options,
        },
    }
