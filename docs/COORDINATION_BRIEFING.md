# Coordination action briefing

The executive briefing now connects stored complaint evidence to the next review step. It suggests work without making a decision or modifying a case.

The action agenda covers four situations:

- Active overlap pairs involving two or more Bureaus with open cases and no room: review the overlap evidence and decide whether to start coordination.
- An open room with pending cases and no recorded decision: the lead Bureau or Senior Management can record an agreed outcome.
- A recorded merge with pending cases outside the lead Bureau: review those followers with the lead. Linking cases does not dispose of them.
- An open case transferred at least three times: its current Bureau should review the history and agree ownership.

The ordering is deterministic: past-due work, then work due within seven days, then other reviews. Within each group, more past-due cases come first, followed by the earliest due date and a stable reference order. The interface shows six recommendations initially and can reveal the full list; printing includes all recommendations.

`GET /api/briefings/executive` retains the existing `sections` and `citations` fields and adds `action_agenda`, `agenda_method`, `scope`, `as_of`, and `overdue_rate`. Each action includes a stable `id`, `kind`, `rank`, `urgency`, `owner`, `reason`, case counts, evidence links, and a `next_action` link to an existing workflow. A recommendation can include the same case as another recommendation when two different reviews are needed; the number of recommendations is not a count of unique cases.

Regional Office requests require a recognized region. Cases, room membership, institution candidates, agenda items and citation links are restricted to that region. Missing or unrecognized regions return 403. Bureau and Senior roles retain the existing cross-Bureau oversight visibility.

The room headline counts only rooms whose stored status is `OPEN`. Merged rooms with pending followers appear in follow-up recommendations rather than the open-room total. The overdue percentage uses open cases as its denominator and considers a case overdue after its stored due date. Cases due today are in the seven-day group. Escalation counts come from recorded case levels, institution risk is labelled as a heuristic, and prototype timelines are described as configured rather than statutory.

Verification: `backend/tests/test_briefings.py` exercises priority, decisions removing reviews, merged follower completion, inactive pairs and disposed cases, empty scopes, recorded escalation counts, regional isolation and fail-closed validation, and slash-containing case links that open the correct API case.
