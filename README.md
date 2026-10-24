# AICTE Integrated Institution Complaint Monitoring & Status Dashboard (SIH prototype)

> **New to the project? Start with [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md)** — full context: what was planned, what is built, how it works, what is left. Original plan: [`docs/ORIGINAL_PLAN.md`](docs/ORIGINAL_PLAN.md). Demo guide: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

Single-window dashboard that shows every complaint across RB, PGRC, AB, LC and VIG, detects
overlapping cases about the same institution, and lets Bureaus coordinate. Runs fully offline.
All data is synthetic and all institutions are fictional.

## Run it (one command)

```bash
pip install -r requirements.txt   # first time only
python run.py                     # seeds the demo DB on first run, opens http://127.0.0.1:8000
```

Options: `python run.py --reseed` (rebuild the demo data), `python run.py --no-browser`.

The built UI is committed in `frontend/dist`, so Node is **not** needed to run the demo.

## Develop the UI (optional, needs Node 24)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api to the backend on :8000
npm run build      # rebuilds frontend/dist
```

Run the backend in another terminal with `python run.py --no-browser`.

## What's built so far (P0 + P1 + P2)

- Seeded database: 60 institutions, 300 cases, 8 regions, planted overlaps, decoys and SLA cases
- Explainable overlap engine (identity, fuzzy name, TF-IDF text, category, time window) with a "Why flagged" breakdown
- Coordination Room: link cases, pick lead Bureau, comment, record decision
- Dashboard with KPIs, charts, ageing, trend, risk-ranked institutions and live activity
- **Simulate New Complaint** button: files a scripted complaint through the real pipeline and fires a live alert
- **SLA engine**: countdown timers, 75% warnings, auto-escalation at 100% (Deputy Director) and 150% (Director),
  ping-pong transfer alerts and daily pending-reminder digests. Demo > "Time machine: +7 days" triggers it live
- **Case workflow**: remark, assign, transfer, escalate, dispose; every action is hash-chained, with
  "Verify integrity" and a demo "Tamper with a record" button
- **Institution risk score** (volume + severity + repeat offences + overdue), colour-coded, with breakdown
- **Role switcher** (RB, PGRC, AB, LC, VIG, Regional Office, Senior Management): different dashboards and a
  server-enforced permission matrix (no login in this prototype)

- **Natural-language search** (rule-based, offline): ask e.g. "pending RB cases in Western region older than 30 days";
  the Cases page shows exactly what it understood as chips
- **India region heatmap** (pending / beyond timeline / average risk) - click a region to open its cases
- **Reports & analytics**: Bureau-wise, region-wise, institution-wise, ageing, disposal rate, overlaps and
  monthly/quarterly, each with CSV and PDF export; the case list also exports to CSV
- **Supporting documents** on cases (upload/download, SHA-256 verified, recorded in the hash-chained history)
- **Register complaint** (new page): live institution match and overlap preview while typing, plus bulk CSV import (validate first)
- **Coordination guard**: acting on an overlapping case needs a logged acknowledgement; after a MERGE the follower Bureau cannot transfer/escalate/dispose
- **Daily briefing** for Senior Management / Regional Offices and a "duplicate effort saved" estimate on the dashboard

## Rehearsal & safety net

- `DEMO_SCRIPT.md` - the 3-minute script, honest-answer cheat sheet, and "if something goes wrong" table
- `python scripts/smoke_test.py` - runs the whole demo flow twice plus a role sweep against the running app; must say ALL CHECKS PASSED (it leaves the data reset)
- `python -m pytest backend/tests -q` - 23 regression tests (overlap engine incl. decoys, audit chain, SLA engine, NL parser, roles)
- `start_demo.bat` - double-click launcher (installs from `vendor/wheels` offline if needed)
- `powershell -ExecutionPolicy Bypass -File scripts\make_bundle.ps1` - builds `AICTE_ICMD_demo_bundle.zip` for a second laptop
- Use `http://127.0.0.1:8000` (not `localhost`): on Windows `localhost` can add a ~2 s IPv6 delay per request

## Layout

```
run.py                 one-command launcher
backend/app/           FastAPI app, SQLite access, seed generator, overlap engine
frontend/src/          React + Vite + Tailwind UI
data/demo.db           created on first run
```

## Backend checks

Install test tools with `python -m pip install -r requirements-dev.txt` after runtime
requirements. Run `python -m pytest backend/tests -q` or include coverage with
`python -m pytest backend/tests -q --cov=backend/app --cov-report=term-missing`.
Tests seed one temporary template and copy it for every test; they never use the demo
DB. Fixtures are `db_path`, `conn`, `client`, and `as_role(role, region=None)`.
Use `db.configure(path)` to override the database location, or `db.configure()` to
return to the `AICTE_DB` environment setting, resolved when a connection is opened.

API routes live in `backend/app/routers/`, grouped by domain. `backend/app/main.py`
only wires the routers, background SLA task, middleware and static UI. Register
specific case subroutes before the greedy case detail route, and the SPA fallback last.

## Frontend checks

From `frontend`, run `npm ci`, then `npm run typecheck`, `npm run lint`, `npm test`
and `npm run build`. Vitest uses jsdom and mocked fetch responses, without a backend
or network. Regression tests cover Coordination Room roles, NL-search chips, shared
badges, Card subtitles and API errors. ESLint enforces Hooks rules and reports the
existing dependency-array warnings with a bounded baseline; TypeScript strict mode
stays off. A frontend build does not replace the type-check step.

The frontend uses TypeScript 6, within typescript-eslint's supported peer range;
the previous TypeScript 7 dependency cannot install with that parser. ESLint allows
the six existing exhaustive-deps warnings and fails if the count increases.

## Demo controls

`python run.py` defaults `DEMO_MODE` to `1`; an explicit `DEMO_MODE=0` is respected.
Direct `uvicorn app.main:app` deployments leave it off unless `DEMO_MODE=1` is set.
Reset, clock advance, tamper, restore and simulated complaints return 404 while off,
and require an explicit `X-Role: SENIOR` while on (403 otherwise). The UI displays
these controls only for Senior Management in demo mode. Read-only audit verification
remains available. These checks reuse the prototype role switcher; authenticated
sessions are tracked separately in issue #22.

## Continuous integration and reproducible installs

GitHub Actions runs `backend`, `frontend`, `smoke` and a Windows `bundle` check on every PR, including stacked
PRs, and pushes to `master`. The aggregate `ci` check succeeds only when all four
jobs pass. CI uses Python 3.13 and Node 24. Locally, the pinned Python dependencies
require Python 3.12 or newer. Install with
`python -m pip install -r requirements.txt -r requirements-dev.txt`.
Runtime and test constraints are committed as `requirements.lock` and
`requirements-dev.lock`; direct dependencies remain readable in their `.txt` files.
Update locks from a clean environment and rerun all checks when changing versions.

`python scripts/ci_smoke.py` starts `run.py --no-browser` with a temporary database,
waits for `/api/clock`, runs the two-round smoke suite, propagates failures and stops
the server. Port 8000 must be free. The frontend CI job uploads a fresh `frontend-dist`
artifact used by smoke testing; committed dist remains unchanged as a policy pending #7.
CI also downloads the pinned runtime wheelhouse and verifies a fresh installation
with `pip install --no-index --find-links vendor/wheels -r requirements.txt`.
Wheelhouses must be prepared for the target OS and Python version. The PowerShell
bundle script refreshes the required wheels rather than reusing an unchecked cache.

Maintainers can require the aggregate `ci` status check in a branch-protection rule
for `master`; repository settings are managed by the team. CODEOWNERS is deferred
until the team agrees on owners.

The Windows CI job builds and extracts the actual PowerShell bundle, creates an
empty Python environment, removes Node from the launcher PATH and invokes
`python scripts/ci_smoke.py --batch` from the extracted copy. This exercises
`start_demo.bat`, its offline wheel installation and both demo smoke rounds.
