
import time

import pytest

from app import galaxy


def test_limit_reports_true_total_and_shown_cases(conn):
    expected_total = conn.execute(
        "SELECT COUNT(*) FROM cases"
    ).fetchone()[0]

    graph = galaxy.generate_galaxy_graph(conn, limit=10)

    assert graph["totalCases"] == expected_total
    assert graph["shownCases"] == min(expected_total, 10)
    assert graph["truncated"] is (expected_total > 10)


def test_limit_is_capped_at_400(conn):
    graph = galaxy.generate_galaxy_graph(conn, limit=999)

    assert graph["shownCases"] <= 400


def test_cluster_only_returns_clustered_cases(conn):
    expected = conn.execute(
        "SELECT COUNT(*) FROM cases WHERE cluster_id IS NOT NULL"
    ).fetchone()[0]

    graph = galaxy.generate_galaxy_graph(conn, cluster_only=True, limit=400)
    case_nodes = [
        node for node in graph["nodes"] if node["type"] == "caseNode"
    ]

    assert graph["totalCases"] == expected
    assert all(node["data"]["clusterId"] for node in case_nodes)


def test_institution_filter(conn):
    row = conn.execute(
        "SELECT institution_id FROM cases "
        "WHERE institution_id IS NOT NULL LIMIT 1"
    ).fetchone()

    if not row:
        pytest.skip("No seeded cases with an institution ID")

    iid = row[0]
    expected = conn.execute(
        "SELECT COUNT(*) FROM cases WHERE institution_id = ?", (iid,)
    ).fetchone()[0]

    graph = galaxy.generate_galaxy_graph(
        conn, institution_id=iid, limit=400
    )
    case_nodes = [
        node for node in graph["nodes"] if node["type"] == "caseNode"
    ]

    assert graph["totalCases"] == expected
    assert all(node["data"]["institutionId"] == iid for node in case_nodes)


def test_region_filter(conn):
    row = conn.execute(
        """
        SELECT i.region
        FROM cases c
        JOIN institutions i ON i.aicte_id = c.institution_id
        WHERE i.region IS NOT NULL AND TRIM(i.region) != ''
        LIMIT 1
        """
    ).fetchone()

    if not row:
        pytest.skip("No seeded cases with an institution region")

    region = row[0]
    expected = conn.execute(
        """
        SELECT COUNT(*)
        FROM cases c
        JOIN institutions i ON i.aicte_id = c.institution_id
        WHERE LOWER(TRIM(i.region)) = LOWER(TRIM(?))
        """,
        (region,),
    ).fetchone()[0]

    graph = galaxy.generate_galaxy_graph(conn, region=region, limit=400)

    assert graph["totalCases"] == expected


def test_graph_has_no_dangling_edges(conn):
    graph = galaxy.generate_galaxy_graph(conn, limit=400)
    node_ids = {node["id"] for node in graph["nodes"]}

    for edge in graph["edges"]:
        assert edge["source"] in node_ids, edge
        assert edge["target"] in node_ids, edge


def test_rejected_overlap_pairs_are_hidden(conn):
    pair = conn.execute(
        "SELECT id FROM overlap_pairs LIMIT 1"
    ).fetchone()

    if not pair:
        pytest.skip("No seeded overlap pairs")

    pair_id = pair[0]
    conn.execute(
        "UPDATE overlap_pairs SET status = 'REJECTED' WHERE id = ?",
        (pair_id,),
    )

    graph = galaxy.generate_galaxy_graph(conn, limit=400)
    edge_ids = {edge["id"] for edge in graph["edges"]}

    assert f"overlap-{pair_id}" not in edge_ids


def test_graph_generation_target_latency(conn):
    start = time.perf_counter()
    galaxy.generate_galaxy_graph(conn, limit=400)
    elapsed = time.perf_counter() - start

    print(f"Galaxy graph generation: {elapsed * 1000:.1f} ms")
    assert elapsed < 0.300, (
        f"Graph generation took {elapsed * 1000:.1f} ms; target is under 300 ms"
    )
