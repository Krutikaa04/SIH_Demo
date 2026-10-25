# Coordination mutation safety

Room ownership is enforced by the API. A lead must be a recognized Bureau
currently represented among the room's cases. Only participating Bureaus or
Senior Management may choose a lead while the room is open. After a decision,
the lead is fixed; an attempted change returns HTTP 409.

Only the current lead or Senior Management can record a decision. Repeating
the same outcome, lead and trimmed note returns the existing decision without
adding audit entries, comments or events. A conflicting retry returns HTTP 409.
This prototype does not expose a decision amendment workflow.

Case actions and room creation/lead/decision changes acquire SQLite's writer lock before
reading coordination state. Competing writes therefore validate against the
last committed decision. Failed requests roll back and release their transaction.
After a merge, the final open lead-owned case cannot be transferred to another
Bureau while open follower cases remain. Other existing coordination guards
and acknowledgement requirements still apply.

Case and room views remount when their route, acting role or region changes.
This resets pending forms and acknowledgements. Retained responses with a
different record ID or region never display mutation controls. Immediate client
locks prevent repeated submissions while a mutation is in flight. Regional
room reads also enforce institution scope on the server.

Opening the same cluster concurrently returns one existing room, with a single
set of case-link audit entries. Room mutations display their returned state
immediately, so a just-selected lead is used by the next decision even while
the background refresh is still pending.

Validation:

```sh
python -m pytest backend/tests/test_coordination_safety.py -q
node scripts/test_mutation_scope.mjs
```

The API tests cover the permission matrix, valid leads, immutable decisions,
idempotent retries, audit integrity, rollback, final-lead transfers, regional
scope and a concurrent merge/transfer race. The frontend check renders retained
responses under changed case/room routes and Regional scopes. Role and route
keys also remount local form state; this check does not replace a browser-based
interaction test.
