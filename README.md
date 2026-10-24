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
- Coordination Room: link cases, pick lead Bureau, comment, record decision
- Dashboard with KPIs, charts, ageing, trend, risk-ranked institutions and live activity
- **Simulate New Complaint** button: files a scripted complaint through the real pipeline and fires a live alert
- **SLA engine**: configurable Bureau-wide and category-specific timelines, calendar-day or working-day calculations (excluding weekends and configured holidays), configurable warning thresholds (default 75%), automatic escalation at 100% (Deputy Director) and 150% (Director), countdown timers, ping-pong transfer alerts and daily pending-reminder digests. SLA settings are snapshotted when each complaint is registered, so subsequent rule changes do not alter existing case timelines. Demo > "Time machine: +7 days" triggers the engine live.
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

## Configurable SLA Rules (Issue #19)

The system supports different prescribed complaint timelines for each Bureau and complaint category.

### Rule priority

When a complaint is registered, its SLA rule is selected in this order:

1. Exact match: Bureau + complaint category.
2. Bureau default: category `*`.
3. Legacy fallback from `SLA_DAYS` if no matching rule exists.

The selected rule is stored on the complaint. Updating a rule affects newly registered complaints only.

### Rule fields

| Field              | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `bureau`           | Bureau code, such as `RB` or `PGRC`                           |
| `category`         | Complaint category, or `*` for the Bureau default             |
| `days`             | Prescribed timeline (1–365 days)                              |
| `warn_pct`         | Percentage at which a warning is raised (1–99), default 75    |
| `use_working_days` | Whether to exclude Saturdays, Sundays and configured holidays |

### Working-day calculations

- Calendar-day rules count every calendar day.
- Working-day rules exclude Saturdays, Sundays and dates in the `holidays` database table.
- The receipt date counts as day zero.
- The due date is calculated from the selected rule when the case is registered.
- The SLA engine uses the demo clock when calculating progress and escalations.

The holiday calendar is empty by default. Administrators can populate the `holidays` table with ISO-formatted dates (`YYYY-MM-DD`) and holiday names.

### API endpoints

**List rules**

`GET /api/sla-rules`

Returns all configured Bureau defaults and category-specific rules.

**Update a rule**

`PUT /api/sla-rules/{rule_id}`

Only the `SENIOR` role can update SLA rules.

Example request:

```json
{
  "days": 14,
  "warn_pct": 70,
  "use_working_days": true
}
```

Each field is validated before updating. Changes are recorded in the settings audit log and do not modify existing complaints.

### Case-level SLA snapshot

Every complaint stores:

- `sla_days`
- `sla_warn_pct`
- `sla_use_working_days`
- `due_date`

These values remain unchanged if the corresponding Bureau or category rule is subsequently edited.

### Tests

Run:

```bash
python -m pytest backend/tests/test_sla_rules.py -q
```

Then run the full regression suite:

```bash
python -m pytest backend/tests -q
```

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
