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

**Signing in.** Everything needs a signed-in account. In the default demo mode the sign-in page lists one account per role, all with the
password `Demo@2026` (usernames `rb`, `pgrc`, `ab`, `lc`, `vig`, `senior`, `regional-western`, ...). For anything real run with
`AICTE_DEMO_MODE=0`: no demo accounts or presenter endpoints are created and the first start prints a one-time password for a Senior
`admin` account. Other settings: `AICTE_SESSION_IDLE_HOURS` (8), `AICTE_SESSION_MAX_HOURS` (12), `AICTE_COOKIE_SECURE=1` (behind HTTPS),
`AICTE_DEMO_PASSWORD`.

The built UI is included in the offline demo bundle published through GitHub Releases. Running the demo from a fresh source checkout requires Node.js to build the frontend. The packaged demo laptop needs Python only.

## Develop the UI (optional, needs Node 20+)

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
- Coordination Room: link cases (detected or manual), add/remove cases, pick lead Bureau, comment, record decision
- Dashboard with KPIs, charts, ageing, trend, risk-ranked institutions and live activity
- **Demo mode** (role menu, top right, or Ctrl+Shift+D) shows presenter controls: *File a new complaint* runs a scripted complaint through the real pipeline and fires a live alert
- **SLA engine & Simulated Outbox**: countdown timers, 75% warnings, auto-escalation at 100% (Deputy Director) and 150% (Director),
  ping-pong transfer alerts, daily pending-reminder digests, and simulated email/SMS reminder dispatch with dedicated Outbox archive. Demo tools > "Jump 7 days ahead" triggers it live
- **Case workflow**: remark, assign, transfer, escalate, dispose; every action is hash-chained, with
  "Verify integrity" and a demo "Tamper with a record" button
- **Institution risk score** (volume + severity + repeat offences + overdue), colour-coded, with breakdown
- **Signal design**: a midnight sidebar, saffron and cobalt accents, animated figures, and a one-click **dark theme** (moon/sun button, top bar)
- **Real sign-in** (hashed passwords, server-side sessions, 15-minute lock-out after five wrong passwords, sign-in audit) with
  roles RB, PGRC, AB, LC, VIG, Regional Office and Senior Management: different home screens and a server-enforced permission
  matrix. Senior Management adds and manages accounts on **People and access**

- **Natural-language search** (rule-based, offline): ask e.g. "pending RB cases in Western region older than 30 days";
  the Cases page shows exactly what it understood as chips
- **India region heatmap** (pending / beyond timeline / average risk) - click a region to open its cases
- **Reports & analytics**: Bureau-wise, region-wise, institution-wise, status-wise, ageing, disposal rate, overlaps and
  monthly/quarterly with filter bar, each with CSV and PDF export; the case list and institution history also export to CSV
- **Recorded coordination outcomes**: explicit officer reviews, room decisions, pending followers and decision time with source records; [counting rules](docs/COORDINATION_OUTCOMES.md). [Innovation review and integration findings](docs/INNOVATION_REVIEW.md).
- **Supporting documents** on cases (upload/download, SHA-256 verified, recorded in the hash-chained history)
- **Register complaint** (new page): live institution match and overlap preview while typing, plus bulk CSV import (validate first); complaints whose institution cannot be matched can be saved to the **Review queue** and registered later
- **Coordination guard**: acting on an overlapping case needs a logged acknowledgement; after a MERGE the follower Bureau cannot transfer/escalate/dispose
- **Daily briefing** for Senior Management / Regional Offices, plus a hypothetical workload scenario with explicit assumptions in Reports

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

## Connection Galaxy — Filtering and Case Limits

The Connection Galaxy API provides an interactive graph of cases, institutions,
bureaus, and overlap clusters.

**Endpoint:** `GET /api/galaxy/graph`

| Parameter        | Default          | Description                                        |
| ---------------- | ---------------- | -------------------------------------------------- |
| `bureau`         | All bureaus      | Filter by bureau code                              |
| `region`         | All regions      | Filter by institution region                       |
| `institution_id` | All institutions | Filter by institution ID                           |
| `cluster_only`   | `false`          | Show cases assigned to a cluster only              |
| `limit`          | `120`            | Maximum number of displayed cases; capped at `400` |

The response retains the existing `nodes`, `edges`, `flagshipClusterId`,
`totalCases`, `totalInstitutions`, and `totalOverlaps` fields.

Additional metadata:

- `shownCases`: number of cases included in the graph.
- `truncated`: whether matching cases were omitted because of the limit.
- `filterOptions`: available regions and institutions.

When results are truncated, the frontend displays a notice encouraging users
to narrow their search with filters. Rejected overlap pairs are excluded, and
edges are emitted only when their endpoint nodes are present.
