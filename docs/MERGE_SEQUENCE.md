# Prototype batch merge sequence

Upstream refreshed on 25 October 2026. `master` is now `3daedf8`, including
PRs #50, #51 and #52, real session sign-in (#53), and the Signal redesign (#54).
Do not reapply the earlier UI or role-header implementation over these changes.

The tested next batch uses independent PRs against this baseline:

| Order | PR | Branch | Tested feature head |
| --- | --- | --- | --- |
| 1 | [#59](https://github.com/Krutikaa04/SIH_Demo/pull/59) | `fix/coordination-mutation-safety` | `4d95ea2` |
| 2 | [#60](https://github.com/Krutikaa04/SIH_Demo/pull/60) | `feature/coordination-commitments` | `49a7687` |
| 3 | [#61](https://github.com/Krutikaa04/SIH_Demo/pull/61) | `feature/institution-aftercare` | `1f02a9c` |
| 4 | [#62](https://github.com/Krutikaa04/SIH_Demo/pull/62) | `infra/prototype-recording-readiness` | Application checks at `e4064ea`; later runbook-only changes preserve that code |

All four merges completed without conflicts in this order. The combined
application tree at `7b5aac8` passed **375 backend tests**, **9 preflight tests**,
all **four real-component scope scripts**, the production frontend build, and
the authenticated two-round smoke test plus role sweep. Live authenticated
preflight passed all seven checks. The published `demo/prototype-recording`
branch contains the combined build; a runbook-only follow-up may advance its head.
Existing frontend bundle-size and Starlette/httpx deprecation warnings remain.

Each PR targets `master`, not the preceding feature branch. Merge with the normal
reviewed PR workflow in the order above. Preserve authenticated sessions and
Signal UI. Re-check current heads and CI immediately before each merge. A new
upstream change invalidates the old conflict-free snapshot until revalidated.

## Reproduce the clean sequence locally

Start with a clean checkout and a new branch. These commands assemble a review
tree; they do not merge anything into the shared master branch.

```sh
git fetch origin
git switch -c review/prototype-recording origin/master
git merge --no-ff origin/fix/coordination-mutation-safety
git merge --no-ff origin/feature/coordination-commitments
git merge --no-ff origin/feature/institution-aftercare
git merge --no-ff origin/infra/prototype-recording-readiness
python -m pytest backend/tests -q
python -m unittest discover -s scripts -p test_recording_preflight.py -q
cd frontend
npm ci
npm run build
cd ..
for script in scripts/test_*_scope.mjs; do node "$script"; done
```

For an existing local Python environment, replace `python` with
`.venv/bin/python`. The root checkout used to record already has
`demo/prototype-recording`; use `git switch demo/prototype-recording`, then build
the frontend for that checkout. Follow [the recording runbook](RECORDING_RUNBOOK.md)
for fresh per-take data and sign-in.

## Reviewer focus

- #59: decided-room ownership, participant validation, exact-once concurrent
  operations, rollback on errors, and route/account identity before mutations.
- #60: owner snapshot, agreed calendar due dates, completion evidence and
  attribution, audit integrity, reset cleanup, and read-only Regional access.
- #61: strict receipt-after-closure ordering, latest valid prior disposal,
  preservation after later annotations, scope and read-only data queries.
- #62: operational checks do not mutate cases; optional demo sign-in records
  auth sessions only; CI and video commands use the correct current endpoints.

No generated dist, databases, uploads, secrets or attribution trailers belong in
the PR diffs. Nothing in this batch automatically closes a complaint or claims
measured time savings from a scenario.

PRs #39–#43 are older teammate work. #41 contains #40, #42 contains #40+#41,
and #43 contains #40+#41+#42. Several already conflicted before this batch.
Merge order alone cannot resolve that divergence. Leave them pending for their
owners to reconcile against current master; do not choose an entire old UI or
restore generated `frontend/dist` to clear a conflict.

For a local combined review, start a new integration branch from the reviewed
`origin/master`, merge each reviewed feature head in order, and stop if any merge
reports a conflict. Run the full checks after the final merge and build before
recording. Never use `git reset --hard`, force-push teammate branches, or run
destructive smoke tests against a recording take to make a merge appear clean.
