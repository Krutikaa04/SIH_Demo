# Shared evidence in overlap scoring

Issue #18 adds explicit shared amounts, circular references and roll/registration
numbers to the existing institution, name, text, category and time signals. It
uses the local extractor from issue #11 and does not call an external model.

## Scoring decision

Keep the five original signals and their weights. After the existing topic gate
passes, add a bounded sixth signal:

| Shared explicit evidence | Bonus |
| --- | ---: |
| At least one equal normalized rupee amount | 4 |
| At least one equal normalized circular/reference identifier | 6 |
| At least one equal normalized roll/registration identifier | 6 |
| Combined maximum | 10 |

Repeated values earn no extra points. Currency formats are compared by numeric
rupee value: `₹45,000`, `Rs. 45000` and `45000 rupees` refer to the same amount.
Reference identifiers are compared in normalized uppercase. The breakdown names
the actual matched values, including zero awarded points when none match.

The awarded bonus also cannot exceed the headroom below 100. A base score of 99
can receive only one point, even if all three evidence types match. The final
integer score is the rounded sum of awarded breakdown points, so rounding can
account for less than one point of difference. The thresholds remain MEDIUM at
50 and HIGH at 70. Shared evidence is supporting context, not a percentage
probability that two complaints are identical.

Scoring explicitly requires the same resolved institution. The original topic
gate runs before the entity bonus. A shared amount therefore cannot rescue an
unrelated-topic pair that fails that gate. Plain unlabelled numbers do not become
amounts, references or roll numbers. A different amount is not negative evidence:
complaints about one matter can quote different components of a payment.

Extraction regexes are compiled at module load and inspect at most the first
20,000 characters of each description. `TextModel` extracts each description once
and reuses its entities across candidate comparisons. Currency at the beginning
of a string or inside parentheses is supported; non-finite numeric inputs are
ignored safely.

## Reproducible benchmark

Run from the repository root after installing the runtime and development
requirements:

```sh
python -m pytest backend/tests/test_entity_scoring.py::test_labelled_entity_ablation -q -s
```

The command seeds a temporary database through the normal isolated test fixture
and prints an `ENTITY_EVALUATION=` JSON object. It never uses `data/demo.db`.
`labelled_benchmark` in that test module defines the corpus and counts.

The 22 labelled examples are deliberately small and synthetic:

- 19 positive pairs: all pairwise combinations of the intended members of the
  11 `seed.PLANTED` scenarios. Labels come from the planting specification,
  independently of detected pair rows or resulting scores.
- Three negative pairs: the existing Mysuru different-topic cases; the same-name
  institutions in Coimbatore and Tirupati; and the Mangaluru fresh complaint
  paired with a case disposed more than 90 days ago.

Both runs use the same fitted TF-IDF model over the same 300 seeded descriptions,
the same institution and recency candidate rules, and the same thresholds. The
baseline disables only the new bonus using `include_entities=False`. The after
run enables it. This ablation isolates the effect of shared evidence instead of
comparing two different datasets.

Measured results:

| Classification threshold | Run | TP | FP | FN | TN | Precision | Recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Any overlap, score ≥ 50 | Original five signals | 19 | 0 | 0 | 3 | 100% | 100% |
| Any overlap, score ≥ 50 | With entity bonus | 19 | 0 | 0 | 3 | 100% | 100% |
| HIGH priority, score ≥ 70 | Original five signals | 18 | 0 | 1 | 3 | 100% | 94.7368% |
| HIGH priority, score ≥ 70 | With entity bonus | 19 | 0 | 0 | 3 | 100% | 100% |

Precision is `TP / (TP + FP)` and recall is `TP / (TP + FN)`. HIGH classification
recall improves by 5.2632 percentage points on this corpus. Any-overlap detection
recall does not change: the promoted pair was already available for review.

## Planted demonstration and regression checks

The existing Kochi unapproved-programme complaints from RB and LC now both quote
`₹45,000`. With the same descriptions and text model, their baseline score is 69
(MEDIUM); the shared normalized amount awards four points, producing 73 (HIGH).
The Mysuru fee complaint and unsafe-hostel complaint also quote `₹45,000`, yet
remain unflagged because they fail the topic gate.

No cases or clusters were added. The standard seed remains 300 cases and 11 HIGH
clusters; hero-cluster, original-decoy, simulation and audit-chain assertions are
retained. Focused tests also cover equivalent currency formats, distinct IDs,
zero evidence, repeated mentions, all three evidence types, score ceiling,
institution mismatch, topic rejection and extraction bounds.

## Limits

These are planted demonstration examples, not a representative or held-out
accuracy study. Three negatives cannot establish a production false-positive
rate. The chosen weights are conservative product rules rather than learned or
calibrated probabilities. Common amounts can recur in unrelated matters; topic
and institution checks reduce that risk but do not prove a shared event. A
shared circular can concern many complaints, and roll IDs can be mistyped.
Matching uses English context markers and exact normalized identifiers, not
semantic or multilingual equivalence. Longer descriptions can contain evidence
beyond the extraction limit.

Existing persisted pair scores are retained by the current detection engine.
Re-seed the synthetic demo to see the changed planted scores. Newly scored
complaints and previews use the sixth signal immediately; this change does not
silently replace previously reviewed pair scores.
