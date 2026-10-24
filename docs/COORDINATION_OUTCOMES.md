# Recorded coordination outcomes

The Reports page includes **Coordination outcomes**, backed by
`GET /api/reports/coordination` and its CSV export. This measures the actions the
prototype actually records, rather than extrapolating time savings.

- A reviewed pair requires an explicit `OVERLAP_CONFIRMED`, `OVERLAP_REJECTED` or
  `OVERLAP_DEFERRED` audit action identifying the other case. Both case ledgers
  count as one pair. Only the latest review is counted; subsequent room decisions
  do not erase it. Creating a manual link or room does not count as a review.
- Rooms count once by their current valid recorded MERGE, RESOLVE or KEEP_SEPARATE
  decision. A coordination decision does not dispose complaints.
- Pending followers are selected open cases at bureaus other than a merged room's
  current lead. The value changes when cases are disposed or membership changes;
  it is not a historical count of prevented duplicate work.
- Median decision time is elapsed calendar days from creation to the latest
  recorded decision timestamp. Missing, malformed and negative timings are excluded
  and counted separately. No decisions yields no median, rather than zero days.
- Malformed decisions and completed rooms without decision records are flagged for
  attention, without inventing an outcome.

Filters select a cohort by complaint received date and current bureau. Both cases
must be selected to count a pair review. A room counts once when it contains a
selected case; its evidence and follower counts include only selected cases.
Regional officers require a valid region and cannot expand scope. These rules apply
to JSON, on-screen evidence and CSV. Dates do not select a decision-date period.

The CSV contains metric definitions plus scoped review/room evidence. Case links
open the actual case history; room links open the recorded decision. PDF uses the
existing metric-table export. UI rendering and export buttons wait for the response
matching the active report, filters and regional scope.
CSV string cells with spreadsheet formula prefixes are escaped, including prefixes
after leading whitespace or control characters; numeric measurements stay numeric.

The former Effort saved calculator remains accessible as **Workload scenario**.
It explicitly assumes all-pairs manual review and a user-selected candidate
percentage. It reports hypothetical workloads and their signed difference, never
measured operational savings. Larger assisted effort is shown as a negative
scenario difference.

Validation: `python -m pytest backend/tests/test_coordination_reports.py -q`.
The suite exercises real HTTP reviews/decisions, duplicate ledgers, manual links,
repeated decisions, followers, invalid records, durations, scope and CSV.
