# Innovation review — 25 October 2026

## Synced baseline

Reviewed `master` at `2fd7961` after the case-file UI redesign. The working
prototype already includes 300 synthetic complaints, explainable overlap
detection, institution matching, case workflows, manual linking, coordination
room membership and decisions, role-aware alerts, unmatched intake review,
timeline reminders, simulated outbox, reports and audit history. The synced
baseline passed 165 backend tests.

The strongest demonstration is a complete chain: detect a related complaint,
show the evidence, give an officer a clear next action, record the decision,
then show what actually happened. Three gaps interrupted that chain.

## Implemented improvements

| Gap | Change | Review scope |
| --- | --- | --- |
| Shared amounts and identifiers were extracted but did not affect overlap scores. | Add a bounded, explained sixth entity signal while retaining topic and institution guards. Include a reproducible synthetic evaluation and a shared-number decoy. | [Issue #18](https://github.com/Krutikaa04/SIH_Demo/issues/18) |
| Management briefings described the workload without an evidence-linked, owned action agenda. | Rank uncoordinated overlaps, rooms awaiting decisions, merged followers and repeated transfers. Each action includes an owner, reason, source links and a next step. Regional briefing scope is enforced in the API and during UI transitions. | [Issue #48](https://github.com/Krutikaa04/SIH_Demo/issues/48) |
| The effort calculator could be mistaken for observed operational savings. | Add recorded review, decision, follower and decision-time measures with source records and exportable definitions. Relabel the calculator as a hypothetical workload scenario with visible assumptions and signed differences. | [Issue #49](https://github.com/Krutikaa04/SIH_Demo/issues/49), [counting rules](COORDINATION_OUTCOMES.md) |

Each improvement is submitted on its own feature branch against `master`.
Synthetic test improvements are evidence about this demo corpus; they do not
establish production matching accuracy or officer time savings.

## Team integration findings

PRs #33–#38 and #44–#47 are present in the reviewed baseline. Open PRs #39–#43
cover audit export, galaxy filtering, configurable timelines, accessibility and
input hardening; this batch avoids replacing those changes.

Earlier PRs #29–#32 were marked merged into their preceding feature branches.
Their router split, frontend quality checks, demo endpoint gates and dependency/CI
work did not reach `master`. PR #28's test fixtures did. Recover that work through
fresh diffs against current `master`, preserving the later redesign and using
independent PR bases; do not copy the old branches wholesale.

## Next steps after this batch

1. Integrate and validate the existing teammate PRs, especially input hardening
   and configurable timelines, before extending the feature surface further.
2. Restore the missing infrastructure changes through reviewed PRs. The current
   role header switcher remains prototype identity, not authenticated access;
   production needs trusted identities and consistent authorization across routes.
3. Evaluate matching on a larger, separately labelled complaint set and observe
   real review effort before making precision, recall or savings claims. Keep
   evidence provenance, ambiguous cases and officer override in that evaluation.
4. Rehearse the detect → explain → coordinate → measure journey with a fresh demo
   database. Existing persisted pairs are not automatically rescored by #18;
   reseed disposable demo data to show the updated scoring examples.

Generated `frontend/dist` remains ignored and is produced by the existing build
workflow. Backend validation for this batch is local; a successful frontend build
does not imply that the missing backend CI work has been restored.
