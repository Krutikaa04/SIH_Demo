# Institution aftercare

The institution profile now links an open complaint to the latest valid earlier
closure in the same exact complaint category at that institution. It answers:
"Was a new concern recorded after a similar category of complaint was closed?"
Officers can open both source cases and review the earlier outcome and final
disposal action before deciding whether further follow-up is appropriate.

The UI calls this **New concern after closure**. Timing and category do not prove
a repeated violation, a shared cause, or that a previous remedy failed. The
feature does not automatically reopen cases, change risk scores or alter records.

## API and counting rules

`GET /api/institutions/{institution_id}/aftercare` returns the institution,
request role/region scope, generation time, matched items, counts and limitations.
Each item contains current and previous case links, recorded closure outcome,
final action sequence/timestamp/actor/remarks/hash, and elapsed calendar days.

- The current case must have a recognized open status and a valid non-future
  receipt date.
- The earlier case must be `Disposed`, with the same institution ID and exact
  category. Case prefix is not used as current Bureau ownership.
- Its valid disposal date must not precede its own receipt or lie in the future.
- Its latest `DISPOSE` audit action by sequence must have a valid application
  timestamp on the recorded disposal date, and not lie before receipt or after
  the application clock. Missing or contradictory disposal evidence is excluded.
  Later remarks, coordination and commitment annotations do not erase a closure
  while the case's current status remains Disposed.
- The current receipt date must be **strictly after** the disposal date. Same-day
  filings are excluded because receipt dates have no time-of-day precision.
- Choose the latest preceding valid closure once per open case. A later closure
  cannot hide an eligible earlier closure, and multiple old cases do not multiply
  the current case's count. Ties use action time, then case ID for determinism.
- Gap is `current received date - previous disposal date` in calendar days.

The seeded Sahyadri institution already demonstrates a 116-day gap; the seed is
unchanged. No text similarity is inferred, and no claim of causation is made.
An empty result means no qualifying chronology was found in the available data.
It does not certify that no earlier problems occurred. Excluded incomplete or
malformed records are counted separately.

## Access and read-only behavior

Regional viewers require an exact valid region. Missing/unknown regions fail
closed with 403; an institution outside the region also returns 403. Unknown
institutions return 404. Bureau and Senior viewers retain the prototype's
institution-level read access. These header roles are the existing demonstration
identity model, not authentication.

The router is mounted at the end of the existing extras router, preserving its
registration before the main application's greedy case routes. It opens SQLite in
`mode=ro`, respects the demo-reset readiness lock, and runs only SELECT queries.
It bypasses the normal connection helper's migration DDL. A missing database
returns 503 without creating a file. No schema changes or migrations are needed.

Institution and aftercare components remount on institution/role/region identity
changes and validate returned scope. Old global, other-region or other-institution
records are hidden while the matching response loads. Loading, errors and empty
results are explicit; source links and long notes wrap on small screens.

## Verification

```sh
python -m pytest backend/tests/test_recurrence.py -q
python -m pytest backend/tests -q
node scripts/test_aftercare_scope.mjs
cd frontend
npm run build
```

Tests cover the seeded example, strict chronology, latest preceding closure,
duplicate prevention, exact category/institution isolation, invalid final actions,
regional scope, empty results, missing database behavior, enforced read-only
connections, byte-identical database contents and unchanged audit verification.
The component regression checks retained global/other-region/other-institution
responses, source links, role changes, and loading/error/empty states.
The result exposes source audit evidence; it does not itself verify each hash
chain or replace the existing record-verification action.
