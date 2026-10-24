"""Entity scoring regressions and a reproducible synthetic ablation benchmark."""
import json
from datetime import timedelta
from itertools import combinations

import pytest

from app import db, intel, seed, services


def signal(result):
    return next(item for item in result["breakdown"] if item["signal"] == "entities")


def case(case_id, description, **changes):
    return {"case_id": case_id, "institution_id": "1-1000001", "resolution_method": "NAME",
            "resolution_conf": 95, "submitted_aicte_id": None,
            "submitted_institution_name": "Example College, Pune", "bureau_code": "RB",
            "received_on": "2026-01-01", "category": "Fee Overcharging / Refund",
            "description": description, **changes}


def score(a, b, **options):
    model = intel.TextModel({row["case_id"]: row["description"] for row in (a, b)})
    return intel.score_pair(a, b, model, **options)


@pytest.mark.parametrize("left,right,points,detail", [
    ("₹45,000", "45000 rupees", 4, "₹45,000"),
    ("Rs. 1.5 lakh", "INR 150000", 4, "₹150,000"),
    ("Circular No. AICTE/2026/04", "ref: aicte/2026/04", 6, "AICTE/2026/04"),
    ("Roll no: ENR-99214", "registration no ENR-99214", 6, "ENR-99214"),
    ("₹45,000 Circular No. AICTE/2026/04 Roll no ENR-99214",
     "45000 rupees ref: aicte/2026/04 registration no ENR-99214", 10, "ENR-99214"),
])
def test_shared_evidence_has_bounded_explainable_points(left, right, points, detail):
    a = case("A", f"Refund fee {left}")
    b = case("B", f"Fee refund {right}", bureau_code="PGRC")
    result = score(a, b)
    assert signal(result)["points"] == points
    assert detail in signal(result)["detail"]
    assert result["score"] <= 100
    assert abs(sum(item["points"] for item in result["breakdown"]) - result["score"]) <= 1


def test_absent_entities_preserve_baseline_and_emit_zero_signal():
    a = case("A", "Parents request a fee refund after withdrawal")
    b = case("B", "The fee refund was refused", bureau_code="PGRC")
    result = score(a, b)
    assert result["score"] == score(a, b, include_entities=False)["score"]
    assert signal(result)["points"] == 0
    assert "No shared" in signal(result)["detail"]


def test_distinct_and_unmarked_numbers_do_not_add_points():
    a = case("A", "Refund fee ₹45,000 Circular No. FEE/2026/01 Roll no ABC-1001")
    b = case("B", "Fee refund ₹50,000 Circular No. FEE/2026/02 Roll no ABC-1002 45000 1001")
    assert signal(score(a, b))["points"] == 0


def test_shared_amount_does_not_bypass_topic_gate():
    a = case("A", "Refund fee ₹45,000")
    b = case("B", "Unsafe hostel building ₹45,000", category="Infrastructure Deficiency")
    assert score(a, b) is None


def test_shared_identifiers_do_not_bypass_topic_gate():
    a = case("A", "Refund fee Circular No. 2026/04 Roll no 99214")
    b = case("B", "Unsafe hostel building ref 2026/04 registration 99214",
             category="Infrastructure Deficiency")
    model = intel.TextModel({row["case_id"]: row["description"] for row in (a, b)})
    model.cosine = lambda *args: 0.0
    assert intel.score_pair(a, b, model) is None


def test_shared_evidence_does_not_bypass_institution_check():
    a = case("A", "Refund fee ₹45,000 Circular No. FEE/2026/04")
    b = case("B", a["description"], institution_id="1-9999999")
    assert score(a, b) is None


def test_bonus_uses_only_remaining_headroom():
    a = case("A", "Refund fee ₹45,000 Circular No. FEE/2026/04", resolution_method="ID",
             submitted_aicte_id="1-1000001")
    b = case("B", a["description"], resolution_method="ID", submitted_aicte_id="1-1000001")
    result = score(a, b)
    assert result["score"] == 100
    assert signal(result)["points"] == 0
    assert "₹45,000" in signal(result)["detail"]
    model = intel.TextModel({row["case_id"]: row["description"] for row in (a, b)})
    model.cosine = lambda *args: 0.096
    result = intel.score_pair(a, b, model)
    assert result["score"] == 100
    assert signal(result)["points"] == 1
    assert sum(item["points"] for item in result["breakdown"]) == 100


def test_repeated_evidence_is_not_counted_twice():
    a = case("A", "Refund fee " + "₹45,000 " * 100)
    b = case("B", "Fee refund ₹45,000")
    assert signal(score(a, b))["points"] == 4


def test_entity_extraction_is_bounded_and_handles_numeric_overflow():
    assert intel.extract_entities("₹45,000")["amount_values"] == [45000]
    assert intel.extract_entities("(₹45,000)")["amount_values"] == [45000]
    assert intel.extract_entities("₹" + "9" * 1000)["amount_values"] == []
    assert intel.extract_entities(" " * 20000 + "₹45,000 Circular No. FEE/2026/04")["amount_values"] == []


def planted_case(conn, city, index, bureau, days):
    inst = db.rows(conn, "SELECT aicte_id FROM institutions WHERE city=? ORDER BY rowid", (city,))[index]
    received_on = str(db.now(conn).date() - timedelta(days=days))
    rows = db.rows(conn, "SELECT * FROM cases WHERE institution_id=? AND origin_bureau=? AND received_on=?",
                   (inst["aicte_id"], bureau, received_on))
    topic = next((topic for key, topic, members in seed.PLANTED if key == (city, index)
                  and any(member[:2] == (bureau, days) for member in members)), None)
    if topic:
        expected = seed.TOPIC[(topic, bureau)][1].rstrip(".")
        rows = [row for row in rows if row["description"].startswith(expected)]
    assert len(rows) == 1
    return rows[0]


def labelled_benchmark(conn):
    examples = []
    for (city, index), topic, members in seed.PLANTED:
        cases = [planted_case(conn, city, index, bureau, days) for bureau, days, *_ in members]
        examples.extend((True, a, b) for a, b in combinations(cases, 2))
    decoys = [
        (planted_case(conn, "Mysuru", 1, "PGRC", 7), planted_case(conn, "Mysuru", 1, "RB", 5)),
        (planted_case(conn, "Coimbatore", 1, "RB", 12), planted_case(conn, "Tirupati", 1, "PGRC", 10)),
        (planted_case(conn, "Mangaluru", 0, "PGRC", 430), planted_case(conn, "Mangaluru", 0, "RB", 9)),
    ]
    examples.extend((False, a, b) for a, b in decoys)
    cases = intel.load_cases(conn)
    model = intel.TextModel({row["case_id"]: row["description"] for row in cases})
    now = db.now(conn)
    results = {}
    for include_entities in (False, True):
        for threshold in (intel.MEDIUM, intel.HIGH):
            counts = dict(tp=0, fp=0, fn=0, tn=0)
            for positive, a, b in examples:
                eligible = intel._eligible(a, now) and intel._eligible(b, now)
                result = intel.score_pair(a, b, model, include_entities=include_entities) if eligible else None
                predicted = result is not None and result["score"] >= threshold
                counts[("t" if positive == predicted else "f") + ("p" if predicted else "n")] += 1
            precision = counts["tp"] / (counts["tp"] + counts["fp"])
            recall = counts["tp"] / (counts["tp"] + counts["fn"])
            results[f"{'entities' if include_entities else 'baseline'}_{threshold}"] = {
                **counts, "precision": round(precision, 6), "recall": round(recall, 6)}
    return results


def test_planted_shared_amount_promotes_medium_pair_without_new_clusters(conn):
    a = planted_case(conn, "Kochi", 0, "RB", 19)
    b = planted_case(conn, "Kochi", 0, "LC", 7)
    model = intel.TextModel({row["case_id"]: row["description"] for row in intel.load_cases(conn)})
    baseline = intel.score_pair(a, b, model, include_entities=False)
    upgraded = intel.score_pair(a, b, model)
    assert baseline["band"] == "MEDIUM"
    assert upgraded["band"] == "HIGH"
    assert upgraded["score"] == baseline["score"] + 4
    assert signal(upgraded)["points"] == 4
    assert len(intel.load_cases(conn)) == 300
    clusters = services.clusters_view(conn)
    assert len(clusters) == 11
    assert all(cluster["band"] == "HIGH" for cluster in clusters)
    a = planted_case(conn, "Mysuru", 1, "PGRC", 7)
    b = planted_case(conn, "Mysuru", 1, "RB", 5)
    assert intel.extract_entities(a["description"])["amount_values"] == [45000]
    assert intel.extract_entities(b["description"])["amount_values"] == [45000]
    assert intel.score_pair(a, b, model) is None


def test_labelled_entity_ablation(conn):
    results = labelled_benchmark(conn)
    print("\nENTITY_EVALUATION=" + json.dumps(results, sort_keys=True))
    assert results["baseline_70"] == {"tp": 18, "fp": 0, "fn": 1, "tn": 3,
                                      "precision": 1.0, "recall": 0.947368}
    assert results["entities_70"] == {"tp": 19, "fp": 0, "fn": 0, "tn": 3,
                                      "precision": 1.0, "recall": 1.0}
    assert results["baseline_50"] == results["entities_50"]
