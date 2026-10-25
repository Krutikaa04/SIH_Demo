# Prototype batch merge sequence

Upstream refreshed on 25 October 2026. `master` is now `3daedf8`, including
PRs #50, #51 and #52, real session sign-in (#53), and the Signal redesign (#54).
Do not reapply the earlier UI or role-header implementation over these changes.

The next batch is being integrated against this baseline on separate branches:

1. `fix/coordination-mutation-safety`: ownership enforcement and safe UI mutation targets.
2. `feature/coordination-commitments`: case-linked Bureau deliverables and completion evidence.
3. `feature/institution-aftercare`: chronology and source evidence after earlier closure.
4. `infra/prototype-recording-readiness`: preflight and video runbook.

Each branch must merge into current `master`, preserve authenticated sessions and
the Signal UI, and pass backend tests, its component regression and frontend
build. Reviewer PR descriptions record the final tested order and exact heads.
Do not merge an outdated head because its earlier checks were green.

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
