# Joint action commitments

Coordination Rooms can now keep concrete follow-up commitments alongside their decision. The lead Bureau or Senior Management selects a current room case, records a task and agrees a due date. The owning Bureau is copied from that case at creation; callers cannot supply a different owner.

The interface shows open, past-due and completed commitments. The owning Bureau or Senior Management can mark a commitment done with a nonempty evidence note, such as a document reference, recorded response or case-history entry. This is an official's recorded statement, not automatic verification that the evidence proves the complaint resolved. Completion never disposes a complaint or changes the room's decision.

## Workflow and permissions

- Open rooms can plan work. A recorded MERGE or RESOLVE can have follow-up commitments after the decision.
- KEEP_SEPARATE prevents new joint commitments because the cases were judged unrelated. Existing obligations stay visible and can still be completed by their recorded owner or Senior Management.
- Creation requires Senior Management or the room's current lead Bureau. Any selected case must currently belong to that room and its institution.
- The recorded owner stays responsible after a later case transfer or removal from the room. The interface identifies that difference. New case holders cannot mark an old owner's commitment done; Senior Management can record completion when appropriate.
- Regional Offices can read commitments only in a recognized own region and cannot create or complete them. Missing, invalid or another region is rejected. Other prototype roles retain cross-Bureau read visibility.
- Due dates use calendar dates and are agreed commitments, not statutory SLAs. A date must be today or later at creation; an open task becomes past due on the following calendar day.

## API and persistence

`GET /api/rooms/{room_id}/commitments` returns scoped room identity, cases, counts, items and permitted actions. `POST` accepts exactly `case_id`, `title` (1–160 trimmed characters) and `due_on` (`YYYY-MM-DD`). `POST /api/rooms/{room_id}/commitments/{id}/complete` accepts `completion_note` (1–2,000 trimmed characters). Repeating completion preserves the original actor, timestamp and note and adds no audit entry or event.

The additive `coordination_commitments` table is initialized lazily by the new router. Existing databases need no reseed. It is registered in `db.TABLES`, so a demo reset drops its contents together with the synthetic complaints. Creation and completion append `COMMITMENT_CREATED` / `COMMITMENT_COMPLETED` to the linked case's hash-chained history. Refresh events publish after the transaction commits. The interface resets its forms across room/role/region changes and hides responses whose scope identity no longer matches.

## Demonstration

1. Open a detected overlap's Coordination Room as Senior Management or its lead Bureau.
2. Add a commitment for another Bureau's linked case, such as sharing the original circular, due today.
3. Switch to that owning Bureau and record completion with a specific case/document reference.
4. Inspect the case history to see both audit entries. The complaint's status and the room's decision remain unchanged.

Validation: `python -m pytest backend/tests/test_action_plans.py -q`. Tests exercise HTTP permissions, owner snapshots, actual room decisions, invalid inputs, evidence requirements, idempotency, calendar overdue counts, committed events, integrity and reset lifecycle.
