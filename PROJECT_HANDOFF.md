# Project handoff — AICTE Integrated Complaint Monitoring Dashboard (SIH prototype)

> **Read this first.** It explains what the project is, what has been built, how it differs from the original plan, how everything works, how to run/test it, and what is left to do. Companion files: [`README.md`](README.md) (short run guide), [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (3-minute demo + Q&A), [`docs/ORIGINAL_PLAN.md`](docs/ORIGINAL_PLAN.md) (the approved plan we started from).

---

## 0. TL;DR

- **What:** a single-window dashboard for AICTE officials that shows every complaint across all Bureaus/Cells (RB, PGRC, AB, LC, VIG), finds **overlapping complaints about the same institution** even when names/IDs/descriptions differ, and lets Bureaus **coordinate**. Everything runs **offline** on one laptop with **no paid APIs**.

- **State:** the planned scope (P0 + P1 + P2) is **built and rehearsed**, plus two post-review additions: **complaint registration / CSV import** and a **coordination guard** (see §2). The baseline documents report 23 automated tests and a passing full-flow smoke test; rerun both after the SLA changes. The baseline demo is ready; the configurable-SLA change still needs integration testing. Remaining work includes polish/extension (see [§13](#13-not-built--known-limitations) and [§14](#14-suggested-backlog-for-the-team)).

- **Run it:**

  ```bash

  pip install -r requirements.txt     # first time only (Python 3.11+, tested on 3.13)

  python run.py                       # seeds data on first run, opens http://127.0.0.1:8000

  ```

  Use **`127.0.0.1`**, not `localhost` (on Windows `localhost` can add ~2 s per request). Node is **not** needed to run — the built UI is in `frontend/dist`.

- **Data is synthetic.** All 60 institutions are fictional. A "Prototype / synthetic data" notice is in the sidebar.

---

## 1. Problem statement (short)

AICTE complaints about the same institution are received and handled separately by different Bureaus/Cells (Regulation Bureau, Public Grievance Redressal Cell, others). Result: duplicated effort, delays, and nobody can see which Bureau holds what for a given institution.

Required: one dashboard with (1) institution profile, (2) case tracking, (3) cross-Bureau overlap detection with the alert **"Potential Overlapping Cases - Coordination Required"** and case linking, (4) real-time dashboard, (5) workflow/action history, (6) search & filters, (7) alerts & notifications, (8) reports & analytics. Users: RB, PGRC, other Bureaus, Regional Offices, senior management, Competent Authority. Innovation expected: data matching / rule-based / AI-assisted analytics. Full text in [`docs/ORIGINAL_PLAN.md`](docs/ORIGINAL_PLAN.md).

---

## 2. Status at a glance — plan vs. what exists

Legend: ✅ built and tested · 🟡 built, simplified on purpose (LITE) · 🎭 intentionally mocked / not real · ❌ not built

### Required features

| # | Feature | Status | Where it lives |

|---|---|---|---|

| R1 | Centralized institution profile | ✅ | `pages/Institution.tsx`, `GET /api/institutions/{id}` |

| R2 | Case tracking (all required fields) | ✅ | `pages/Cases.tsx`, `pages/CaseDetail.tsx`, `GET /api/cases` |

| R2+ | **Register a complaint** (form with live institution match + overlap preview) and **bulk CSV import** | ✅ | `pages/Register.tsx`, `services.register_complaint()`, `POST /api/complaints*` |

| R3 | Cross-Bureau overlap detection + linking | ✅ | `backend/app/intel.py`, `pages/Overlaps.tsx`, `pages/Room.tsx` |

| R4 | Real-time dashboard | 🟡 SSE push + refresh, single process | `pages/Dashboard.tsx`, `events.py`, `GET /api/events` |

| R5 | Workflow & action history (+ documents) | ✅ / 🟡 docs on local disk, no preview | `POST /api/cases/{id}/actions`, `extras.py` (documents) |

| R6 | Search & filters (all 8 filters) | ✅ | `Cases.tsx`, `services.case_where()` |

| R7 | Alerts & notifications | 🟡 in-app only; 🎭 email/SMS not sent | `sla.py`, `pages/Alerts.tsx`, bell in `Layout.tsx` |

| R8 | Reports & analytics (7 reports) | 🟡 fixed set, no custom builder | `reports.py`, `pages/Reports.tsx` |

### Standout features (A–K) and extras

| # | Feature | Status | Notes |

|---|---|---|---|

| A | Explainable overlap engine (score breakdown) | ✅ | 5 signals, "Why flagged" drawer |

| B | Coordination Room | 🟡 | Link → lead Bureau → comments → decision (MERGE / RESOLVE / KEEP_SEPARATE). "Merge" is logical, not a physical record merge |

| B+ | **Coordination guard** | ✅ | Acting on an overlapping case needs a logged acknowledgement; after a MERGE the non-lead Bureau is blocked from transfer/escalate/dispose (`services.coordination_guard`) |

| C | Institution risk score | ✅ | `risk.py`; badge + breakdown on profile, list, dashboard |

| D | Configurable SLA rules + auto-escalation | ✅ | `sla_rules.py` selects Bureau/category rules and calculates working-day timelines; `sla.py` escalates; `CaseDetail.tsx` displays the assigned timeline |

| E | Natural-language search | 🟡 | Rule-based parser `nlsearch.py`; shows "I understood" chips |

| F | Hash-chained audit trail + verify | ✅ | `db.append_action` / `db.verify_chain`; tamper demo endpoint |

| G | Simulate New Complaint | ✅ | Real pipeline, 6 scripted scenarios |

| H | Role switcher + permissions | 🟡 | Header-based roles, server-enforced matrix, **no login** |

| I | India region heatmap | 🟡 | Region-level choropleth, bundled GeoJSON, 3 metrics |

| J | CSV/PDF export | ✅ CSV / 🟡 PDF (table only, no charts) | `Reports.tsx`, `pdf.ts`, `/api/export/cases` |

| K1 | Time machine (+7 days) | ✅ | Demo menu; shifts the SLA clock and runs the engine |

| K2 | "Duplicate effort saved" counter | 🟡 | Estimate with visible assumptions |

| K3 | Daily briefing + ping-pong detector | 🟡 | Template text from live numbers; ping-pong = ≥3 transfers |

| K4 | Case-network graph (stretch) | ❌ | Not started |

| — | Real data ingestion / SSO | 🎭 | Seed data and role switcher stand in |

---

## 3. Plan vs. reality — deviations the team should know about

| Topic | Original plan | What was actually done | Why |

|---|---|---|---|

| Team | 4 devs in parallel tracks | Built by one developer with an AI assistant | Time/availability. The 4-track split in `docs/ORIGINAL_PLAN.md` is still a good way to divide the **remaining** work |

| ORM | SQLAlchemy 2 | Plain `sqlite3` + helper functions (`db.rows`, `db.one`) | Fewer moving parts, faster |

| Text-similarity scale | cosine/0.40 = full points | **cosine/0.10** (`TEXT_FULL_COSINE` in `intel.py`) | Short paraphrased complaints rarely exceed cosine 0.1–0.2; 0.40 made true overlaps score too low |

| False-positive guard | (not in plan) | **Topic gate**: a pair is only a candidate if `text_pts + category_pts ≥ 10` | Same institution + same time window alone gave ~60/100 baseline → noisy matches |

| "Pending" definition | Received + Under Process + Pending Info | **Pending = any case not Disposed** (incl. Transferred, Escalated) | Matches how officials talk; "Under process" is its own tile |

| Escalation ladder | L1 Director, L2 Competent Authority | **L1 = Deputy Director (at 100% of SLA), L2 = Director "Competent Authority" (at 150%)** | Matches the 4 officer levels seeded per Bureau |

| Role set | RB / PGRC / Regional / Senior | RB, PGRC, AB, LC, VIG, Regional Office, Senior Management | Same logic, trivial to support all Bureaus |

| Reminders | per-case reminders | **One digest alert per Bureau per (demo) day** for cases with no action for ≥10 days | Avoids alert floods |

| Burst alerts | — | If one engine tick escalates >4 cases, it creates **one digest alert** instead of many | The +7-day time machine otherwise spawns dozens |

| K-ideas | 3 extras | K1 time machine, K2 effort saved, K3 briefing (+ ping-pong). **K4 graph not built** | Time |

| Reset | copy pristine DB file | **Re-seed** (`POST /api/admin/reset`), guarded by a lock | Dates are relative to "today", so a pristine file would go stale |

| Registration & guard | not in the plan | Added after a gap review against the problem statement: there was no way to get data **in** except the seed/Simulate, and overlaps were informational only | Needed for a credible "single source of truth" and to "prevent conflicting or parallel actions" |

| Added beyond plan | — | Overlap-page search box, demo-flow smoke test, 23 pytest tests, offline wheelhouse + bundle script, `start_demo.bat` | Rehearsal/robustness |

---

## 4. Architecture

```

 Browser (React SPA, served by FastAPI)                         Offline, one process, one port (8000)

 ┌──────────────────────────────────────────────┐   REST /api/*  ┌────────────────────────────────────────┐

 │ pages: Dashboard · Cases · CaseDetail ·      │ ─────────────► │ FastAPI  (backend/app/main.py, extras) │

 │ Overlaps · Room · Institutions · Reports ·   │ ◄── SSE ────── │   routers, role context (roles.py)     │

 │ Alerts   + toasts, role switcher, Demo menu  │  /api/events   │ services.py  serialisers, read models  │

 └──────────────────────────────────────────────┘                │ intel.py     entity resolution + overlap│

                                                                 │ sla.py       SLA engine (30 s asyncio)  │

 X-Role / X-Region headers on every request                      │ risk.py · reports.py · nlsearch.py      │

                                                                 │ db.py        SQLite + hash chain        │

                                                                 └───────────────┬────────────────────────┘

                                                                                 │ data/demo.db (+ data/uploads/)

```

**Stack:** Python 3.11+ (FastAPI, uvicorn, rapidfuzz, scikit-learn) · SQLite · React + Vite + TypeScript (strict off) + Tailwind 4 + Recharts + d3-geo + jsPDF/autotable + lucide-react. Fonts (`@fontsource-variable/inter`) and the India GeoJSON are bundled — **no CDN, no internet at runtime**.

### Repository map

```

run.py                         one-command launcher (seed if needed → uvicorn on 127.0.0.1:8000)

start_demo.bat                 double-click launcher (offline pip install from vendor/wheels if needed)

requirements.txt               fastapi, uvicorn, rapidfuzz, scikit-learn

README.md · PROJECT_HANDOFF.md · DEMO_SCRIPT.md · docs/ORIGINAL_PLAN.md

backend/app/

  constants.py                 bureaus, SLA days, statuses, categories(+groups), regions→states, headlines

  db.py                        schema, connection, settings, demo clock, append_action + verify_chain, READY reset lock

  seed.py                      synthetic data generator + planted scenarios + simulate_spec()

  intel.py                     name normalisation, Registry.resolve(), TextModel (TF-IDF), score_pair(), detect(), recluster()

  services.py                  case_where() filter builder, SLA info, serialisers, clusters_view(), simulate_complaint()

  sla.py                       tick() engine, reminder_digest(), init_state()
  sla_rules.py                 rule selection, working-day calculations, holidays, case progress

  risk.py                      institution risk score

  roles.py                     roles, personas, allowed_actions()

  nlsearch.py                  rule-based natural-language parser

  reports.py                   7 reports, CSV builders, daily briefing

  extras.py                    APIRouter: NL search, reports, CSV export, documents (upload/list/download)

  events.py                    in-process SSE broadcaster

  main.py                      FastAPI app: all other endpoints, SSE, static UI serving

backend/tests/test_prototype.py  baseline regression tests (throw-away DB)
backend/tests/test_sla_rules.py  configurable SLA rule and working-day tests (new; verify before claiming passed)

frontend/src/

  main.tsx                     routes · api.ts fetch wrapper, role store, SSE bus, useApi hook, download()

  Layout.tsx                   sidebar, header (search, role switcher, Simulate, bell, Demo menu)

  toast.tsx                    toast system + overlap / SLA toasts   ·  ui.tsx shared components

  pdf.ts                       jsPDF report export

  components/IndiaMap.tsx      d3-geo heatmap   ·  assets/india-regions.json (simplified GeoJSON, region-tagged)

  pages/                       Dashboard, Cases, CaseDetail, Overlaps, Room, Institutions, Institution, Alerts, Reports

frontend/dist/                 built UI (committed on purpose, so Node isn't needed to run)

scripts/smoke_test.py          pre-demo end-to-end check (runs the demo flow twice + role sweep)

scripts/make_bundle.ps1        builds AICTE_ICMD_demo_bundle.zip (offline copy for a 2nd laptop)

data/                          demo.db and uploads/ are created at runtime (gitignored)

vendor/wheels/                 offline pip wheelhouse (gitignored; created by pip download)

```

---

## 5. How to run, develop, test

| Task | Command |

|---|---|

| Run the demo | `python run.py` (options: `--reseed`, `--no-browser`) |

| Double-click run (Windows) | `start_demo.bat` |

| UI dev with hot reload | terminal 1: `python run.py --no-browser` · terminal 2: `cd frontend && npm install && npm run dev` → http://localhost:5173 (proxies `/api` to :8000) |

| Rebuild the UI after frontend changes | `cd frontend && npm run build` (**commit `frontend/dist`**) |

| Unit/regression tests | `python -m pytest backend/tests -q` → expect **17 passed** (~6 s, uses a temp DB) |

| Full demo-flow smoke test | start the app, then `python scripts/smoke_test.py` → expect **ALL CHECKS PASSED** (it resets data at start/end) |

| Offline bundle for 2nd laptop | `powershell -ExecutionPolicy Bypass -File scripts\make_bundle.ps1` → `AICTE_ICMD_demo_bundle.zip` |

| Offline pip install | `pip install --no-index --find-links vendor/wheels -r requirements.txt` |

**After changing the DB schema or seed logic:** delete `data/demo.db` (or run `python run.py --reseed`). There are no migrations — the demo DB is always rebuilt from `seed.py`.

---

## 6. The synthetic dataset (`seed.py`)

Deterministic (`random.Random(42)`) except that **dates are relative to "today"** (so SLA states are always realistic). Result: **60 institutions** (8 regions, fictional names like "Sahyadri Government College of Engineering, Pune"), **~300 cases** across RB/PGRC/AB/LC/VIG, ~1,200 hash-chained history events, small downloadable text documents on ~half the cases, and alerts.

Every seeded complaint is created by **rendering a name variant** ("Govt." / "Engg" / UPPERCASE / city alias "Bangalore" / typo / full) and then running the **real resolver** on it, so entity resolution is exercised, not faked.

**Planted scenarios (so the demo always works):**

| What | Detail |

|---|---|

| **11 overlap clusters** (all HIGH) | `PLANTED` list: Pune (hero), Mumbai, Chennai, Kolkata, Kochi, Lucknow, Delhi, Hyderabad, Bhopal, Jaipur, Nagpur. Different Bureaus describe the **same problem** in **different words** (`TOPIC` bank), with some cases lacking an AICTE ID |

| **Hero: Sahyadri Govt. College of Engineering, Pune** (`1-4520311`) | RB + PGRC + AB cases ("Govt. College of Engg Pune" / full name / UPPERCASE), pairs score ~70–79 %. Also has 4 old closed cases (repeat offender) → risk score ≈ 72–77 (HIGH) |

| **6 simulation targets** | `SIM` list: one staged open case at Bengaluru, Ahmedabad, Patna, Visakhapatnam, Indore, Ludhiana. "Simulate New Complaint" files a complaint from a **different Bureau** under a different spelling and no ID (cycles through the 6; each scores HIGH) |

| **Decoys (must NOT link)** | same name in different cities (Coimbatore vs Tirupati "Vidyasagar Institute of Technology"); a 14-month-old closed case + fresh case (Mangaluru); same institution & period but unrelated topics (Mysuru) |

| **SLA mix** | ~45 beyond timeline, ~24 nearing; breached cases are already Escalated (L1, and L2 beyond 150 %); some "ping-pong" cases with 3 transfers |

| **Stale cases** | extra old open cases (e.g. RB/Western) so NL queries like "pending RB cases in Western region older than 30 days" return real rows (~6) |

Background cases are generated with an **exact collision check** using the real scorer, so only planted overlaps flag.

**Reset behaviour:** **Demo ▾ → Reset demo data** (or `POST /api/admin/reset`) re-seeds everything, **including** the demo clock, tamper state, uploaded docs, and settings counters.

---

## 7. Domain logic in detail

### 7.1 Entity resolution (`intel.Registry.resolve`)

1\. If a submitted AICTE ID exists in the master → method `ID`, confidence 100.

2\. Else normalise the name (lowercase, strip punctuation, expand `ABBR` govt→government, engg→engineering, coll→college, inst→institute, tech→technology…, map `CITY_ALIAS` bangalore→bengaluru, bombay→mumbai, madras→chennai…, drop stopwords).

3\. If a known city appears in the name → compare only against that city's institutions (**city blocking**); else compare against names without the city and require a clear winner (gap ≥5).

4\. `rapidfuzz.token_sort_ratio`; ≥88 → `NAME`, 80–88 → `NAME_LOW`, else unresolved. Ties/ambiguity (within 2 points) → unresolved.

5\. Unresolved complaints are **not** handled by a review queue yet (see backlog).

### 7.2 Overlap scoring (`intel.score_pair`) — total 100

| Signal | Max | Rule |

|---|---|---|

| Identity | 30 | both quote the same AICTE ID = 30; both resolve to the same master by name at ≥88 = 18; 80–88 = 10; otherwise not a candidate |

| Name similarity | 15 | `15 × clamp((token_set_ratio − 70)/30)` on normalised submitted names |

| Text similarity | 25 | TF-IDF cosine (1–2-grams, sublinear tf, domain synonym map e.g. teacher/staff→faculty, fees/refund→fee): `25 × min(1, cosine / 0.10)` |

| Category | 15 | same category 15 · same category group 9 · shared inferred topic 6 · else 0 |

| Time window | 15 | ≤30 days apart = 15, linearly to 0 at 180 days |

- **Topic gate:** discard if `text_pts + category_pts < 10`.

- **Bands:** ≥70 **HIGH** ("Potential Overlapping Cases - Coordination Required") · 50–69 **MEDIUM** ("Possible Overlap - Review Recommended") · <50 discarded.

- **Type:** different current Bureaus → `CROSS_BUREAU`; same Bureau → `DUPLICATE`.

- **Candidates** (`detect`): same `institution_id`, other case is open **or disposed within 90 days**.

- **Clusters** (`recluster`): union-find over pairs; cluster IDs (`OVL-0001`…) are stable across re-runs.

- Each pair stores `breakdown` JSON (signal, label, points, max, human detail) + a plain-text `explanation`; the UI renders them in the **Why flagged** drawer.

- **To retune:** change weights/thresholds in `intel.py`, then re-run `pytest` (the labelled positives + decoys in `test_prototype.py` are the safety net).

### 7.3 Risk score (`risk.py`) — 0–100

`volume (≤30: 5 × complaints in last 12 months)` + `severity (≤30: 30 × weighted mean severity/5, open cases weigh double)` + `repeat offences (≤20: 10 × categories with ≥2 complaints)` + `overdue (≤20: 5 × open cases past due)`. Bands: LOW <40, MEDIUM 40–69, HIGH ≥70. Returned with a per-signal breakdown.

### 7.4 Configurable SLA rules & escalation (`sla_rules.py`, `sla.py`)

SLA timelines are configurable per Bureau and complaint category. The values are illustrative, not verified statutory deadlines.

**Rule selection priority:**

1. Exact Bureau + category rule.
2. Bureau-wide default (`category = '*'`).
3. Fallback to `constants.SLA_DAYS` when no configured rule applies.

Illustrative Bureau defaults: RB 30, PGRC 21, AB 45, LC 60, VIG 45 days.

**Rule fields:**

- `days`: prescribed duration, 1–365 days.
- `warn_pct`: warning threshold, 1–99%, default 75%.
- `use_working_days`: whether to exclude Saturdays, Sundays and configured holidays.

**Case-level SLA snapshots:** When a complaint is registered, the chosen rule is snapshotted in `sla_days`, `sla_warn_pct`, `sla_use_working_days`, and `due_date`. Editing a rule affects newly registered complaints, not existing cases.

**Working-day calendar:** `holidays(date, name)` stores optionally excluded dates. Working-day SLAs skip weekends and configured holidays; the receipt date is day zero. Calendar-day SLAs count every day. The holiday calendar is empty by default and requires authoritative dates before production use.

**Escalation:** A background asyncio task calls `sla.tick()` every **30 seconds**, and the time-machine clock change triggers an immediate check.

- At the case's configured `warn_pct` threshold: `SLA_NEAR` alert.
- At 100%: automatic level-1 escalation to Deputy Director, recorded as `AUTO_ESCALATE` in the hash-chained case history.
- At 150%: automatic level-2 escalation to Director / Competent Authority.
- At three or more transfers: `PING_PONG` alert.
- After 10 calendar days without action: daily Bureau-level pending-reminder digest.

The case fields `warned_at`, `breached_at`, `severe_at`, and `pingpong_at` prevent duplicate notifications and escalations.

**Configuration API:** `GET /api/sla-rules` lists rules; `PUT /api/sla-rules/{rule_id}` updates `days`, `warn_pct`, and `use_working_days` for the `SENIOR` role. Updates are validated and recorded in the `settings` audit log. No rule-creation API or holiday-management UI is included in this change.

**Demo clock:** `settings.clock_offset_days` is added to application time (`db.now`). `POST /api/admin/clock {add_days:7}` advances it; resetting the demo returns the clock to its default.

### 7.5 Roles and permissions (`roles.py`)

No login. The UI sends `X-Role` (`RB|PGRC|AB|LC|VIG|REGIONAL|SENIOR`) and `X-Region` (for `REGIONAL`); the **server enforces** the matrix:

| Role | Reads | Case actions |

|---|---|---|

| RB / PGRC / AB / LC / VIG | everything (single window) | remark, assign, transfer, escalate, dispose — **only on cases currently assigned to their Bureau** |

| REGIONAL | own region only (cases, institutions, alerts, dashboard) | remark only, only in own region |

| SENIOR | everything | remark, escalate (not transfer/dispose) |

- Coordination Room: any non-regional role can open a room (anyone can comment); **only the lead Bureau or Senior can record the decision**; only participating Bureaus/Senior can set the lead.

- Bureau roles get a **"My desk"** panel on the dashboard; Senior/Regional get the **Daily briefing**.

- Default role when no header is sent: `SENIOR`. Role is remembered in `localStorage` (`icmd.role`).

### 7.6 Tamper-evident history (`db.py`)

`action_history` rows form a **per-case hash chain**: `hash = sha256(prev_hash + canonical JSON of [case_id, seq, ts, actor_id, actor_bureau, action_type, from, to, remarks])`, genesis = 64 zeros. `append_action()` is the **only** writer (the seed uses it too). `verify_chain(case_id=None)` recomputes and reports the first broken record. `POST /api/admin/tamper` does a raw `UPDATE` to demonstrate detection. Uploaded documents' SHA-256 is embedded in the history remark. **Tamper-evident, not tamper-proof** (someone with DB admin rights could recompute the chain).

### 7.6b Registering complaints (`services.py`, `pages/Register.tsx`)

Every new complaint — from the **Register form**, a **CSV import**, or the **Simulate** button — goes through one function, `services.register_complaint()`: validate (`clean_complaint`) → resolve the institution → duplicate check (same institution + Bureau + text while still open) → least-loaded desk officer → insert case → two history events → `intel.detect(only_case=…)` → overlap alerts → SSE push.

- **Live check:** `POST /api/complaints/preview` (no writes) returns the resolved institution (+ method/confidence), up to 5 `suggestions` when the match is missing or low-confidence (ranking ignores generic words like "college/institute"), the institution's open cases, and the **potential overlaps with score breakdown** — so the official sees "Potential Overlapping Cases" **before** submitting.

- **Unresolved names:** `register` returns `422 UNRESOLVED_INSTITUTION` with suggestions; the user picks the institution (method `MANUAL`) or searches the master list. There is still **no review queue** for unresolved rows (backlog).

- **CSV import:** `POST /api/complaints/import {csv_text, dry_run}`; column aliases are accepted (`institution`, `complaint`, `date`…); max 500 rows; `dry_run:true` validates + previews every row (ready / needs review / error); the real run registers valid rows sequentially (so later rows can overlap with earlier ones) and sends one summary toast instead of one per row.

- Bureau roles always register into **their own Bureau** (the bureau field is locked/ignored); Senior/Regional choose the Bureau.

### 7.6c Coordination guard (`services.coordination_guard`, enforced in `main.case_action`)

Applies to `transfer`, `escalate`, `dispose` only (remark / assign / documents are never blocked):

| Situation | Level | Effect |

|---|---|---|

| Case is in an overlap cluster that is OPEN/LINKED (no decision yet) | `ack` (`OPEN_OVERLAP`) | `409 OVERLAP_ACK_REQUIRED` unless the request has `acknowledge_overlap:true`; the UI shows a warning with a link to the Coordination Room and a checkbox; the acknowledgement is **appended to the history remark** (`[Acted with open coordination issue OVL-…: acknowledged by …]`) |

| Room decision = **MERGE** and this case's Bureau is **not the lead** | `block` (`FOLLOWS_LEAD`) | `403`; buttons greyed out; banner "Actions restricted". **Senior is exempt from the block** but must acknowledge |

| MERGE and this case is the **lead's**, dispose while followers are still open | `ack` (`LEAD_WITH_OPEN_FOLLOWERS`, dispose only) | acknowledgement required |

`GET /api/cases/{id}` returns `guard` (level, code, message, `applies_to`, room/lead/other Bureaus) and removes blocked actions from `allowed_actions`. RESOLVE / KEEP_SEPARATE decisions lift the guard.

### 7.7 Natural-language search (`nlsearch.parse`)

Rule-based grammar → the same filter params the Cases page uses + a list of **chips** ("I understood…"). Understands: status (pending/open, disposed, under process, transferred, escalated, pending info), flags (overdue/beyond timeline, nearing, overlap), Bureau names/codes, region names (longest match first so "south-western" ≠ "western") and states, categories (keyword → canonical), ages ("older than 30 days/2 months", "last 2 weeks", "this month/year", "since March"), AICTE ID, case ID, institution (fuzzy), city, and leftover keywords. Unknown text falls back to keyword search.

### 7.8 Reports (`reports.py`)

`bureau`, `region`, `institution`, `ageing`, `disposal`, `overlaps`, `periodic` (month/quarter). Each returns `{title, columns, rows, chart, summary, scope, generated_at}`; `?format=csv` returns UTF-8-with-BOM CSV. Regional role is auto-scoped. PDF is generated **client-side** in `pdf.ts` (table + KPIs, no charts).

### 7.9 Live updates (SSE)

`GET /api/events` streams: `dashboard.invalidate`, `case.created`, `case.updated`, `overlap.detected`, `alert.created`, `room.created`, `room.updated`, `sla.escalated`, `clock.changed`, `reset`. `useApi()` refetches on these events; `toast.tsx` shows the red overlap toast (de-duplicated by pair id) and the orange SLA-escalation toast.

---

## 8. Data model (SQLite, `db.py` → `SCHEMA`)

| Table | Key fields |

|---|---|

| `institutions` | `aicte_id` (PK, "1-xxxxxxx"), name, city, state, region, address, type, programmes (JSON), est_year, head_name, phone, email |

| `officers` | id (`OFF-RB-01`…), name, bureau_code, designation, level 1–4 (1–2 desk, 3 Deputy Director, 4 Director) |

| `cases` | `case_id` (PK `RB/2026/00054`; prefix = **originating** Bureau), reference_no, institution_id, submitted_institution_name, submitted_aicte_id, resolution_method (`ID`/`NAME`/`NAME_LOW`), resolution_conf, source, received_on, category, category_group, severity 1–5, description, status, origin_bureau, **bureau_code (current handler)**, assigned_officer_id, last_action(+\_at), next_action, sla_days, due_date, escalation_level, transfer_count, disposed_on, outcome, room_id, cluster_id, warned_at/breached_at/severe_at/pingpong_at, **sla_warn_pct**, **sla_use_working_days** |

| `action_history` | case_id, seq, ts, actor_id/name/bureau, action_type (RECEIVED, ASSIGNED, REMARK, TRANSFER, ESCALATE, AUTO_ESCALATE, DISPOSE, LINKED, COORDINATION, DOC_ADDED), from/to bureau, remarks, prev_hash, hash — unique (case_id, seq) |

| `overlap_pairs` | id (`PR-0001`), case_a, case_b, institution_id, type, score, band, breakdown (JSON), explanation, headline, cluster_id, status (OPEN/LINKED/RESOLVED/DISMISSED), detected_at |

| `coordination_rooms` / `room_cases` / `room_comments` | room id (`ROOM-0001`), cluster_id, lead_bureau, status (OPEN/MERGED/RESOLVED), decision (JSON), comments |

| `alerts` | type (OVERLAP, SLA_NEAR, SLA_BREACH, ESCALATION, PENDING_REMINDER, PING_PONG), severity, case_id, institution_id, pair_id, cluster_id, message, created_at, is_read, link |

| `documents` | case_id, seq, filename, path, sha256, size, uploaded_by, uploaded_at (files under `data/uploads/\<case>/`) |

| `sla_rules` | id (PK), bureau, category (`*` for Bureau default), days, warn_pct, use_working_days; unique (bureau, category) |
| `holidays` | date (YYYY-MM-DD, PK), name; excluded from working-day SLA calculations |
| `settings` | key/value: `clock_offset_days`, `cluster_seq`, `pair_seq`, `room_seq`, `sim_counter`, `reminder_day` |

**Case statuses:** Received, Under Process, Pending Info, Transferred, Escalated, Disposed. **Bureaus:** RB, PGRC, AB (Approval Bureau), LC (Legal Cell), VIG (Vigilance Cell). **Regions (8):** Northern, North-Western, Central, Eastern, Western, South-Western, South-Central, Southern (verify naming against AICTE's actual regional offices before any real use). **Categories (12, in 4 groups)** are in `constants.CATEGORIES`.

---

## 9. API reference (base `/api`, JSON; headers `X-Role`, `X-Region`)

> **Case IDs contain slashes** (`RB/2026/00054`). The routes use `{case_id:path}`; clients should URL-encode (`RB%2F2026%2F00054`). The `extras` router is registered **before** the main routes so `/api/cases/{id}/documents` isn't swallowed by the generic case route — keep that order.

| Method & path | Purpose |

|---|---|

| `GET /meta`, `/meta/officers`, `/clock` | enums (bureaus, regions, categories, statuses, roles); officers; demo clock |
| `GET /sla-rules` · `PUT /sla-rules/{rule_id}` | List configured SLA rules; SENIOR-only updates to `days`, `warn_pct` and `use_working_days`, recorded in the settings audit log |

| `GET /dashboard/summary` | totals, workload, top-risk institutions, trend, ageing, regions (heatmap), activity, overlap stats, effort saved, **briefing**, **desk** (bureau roles) |

| `GET /cases?q&bureau&region&category&status&institution_id&date_from&date_to&overdue&overlap&nearing&age_gt&age_lt&sort&page&page_size` | filtered list (`status=Pending` = not disposed) |

| `GET /cases/{id}` · `/cases/{id}/history` | detail (+`allowed_actions`, `sla`, `overlap`, `room`) · hash-chained history (+documents per event) |

| `POST /cases/{id}/actions` `{type: remark\|assign\|transfer\|escalate\|dispose, remarks, to_bureau, officer_id, next_action, acknowledge_overlap}` | workflow action (permission- and coordination-guard-checked) |

| `GET/POST /cases/{id}/documents` · `GET /documents/{id}/download` | list / upload (base64 JSON, ≤2 MB) / download; `verified` = file hash still matches |

| `GET /institutions?q&region` · `GET /institutions/{aicte_id}` | list with risk; profile with cases, clusters, stats, risk breakdown |

| `GET /overlaps?status=active\|all` · `GET /overlaps/{pair_id}` | clusters with pairs + breakdowns · one pair |

| `POST /rooms {cluster_id}` · `GET /rooms/{id}` · `POST /rooms/{id}/comments` · `/lead` · `/decision` | Coordination Room (decision outcomes `MERGE`, `RESOLVE`, `KEEP_SEPARATE`) |

| `GET /alerts?unread&type&limit` · `POST /alerts/{id}/read` · `POST /alerts/read-all` | alerts (each has a `link`) |

| `GET /search/nl?q=` | natural-language parse → `{chips, params}` |

| `GET /reports/{bureau\|region\|institution\|ageing\|disposal\|overlaps\|periodic}?format=json\|csv&period=month\|quarter` | reports |

| `GET /export/cases?\<same filters>` | CSV export of the filtered case list |

| `GET /audit/verify?case_id=` | verify the hash chain (all cases if omitted) |

| `POST /complaints/preview` · `POST /complaints` · `POST /complaints/import` | register-form live check (no writes) · register one complaint (`422 UNRESOLVED_INSTITUTION` + suggestions) · bulk CSV import (`dry_run`) |

| `POST /simulate/complaint {scenario?:1..6}` | file a scripted complaint through the real pipeline (uses `register_complaint`) |

| `POST /admin/clock {add_days}` · `/admin/tamper` · `/admin/reset` | demo tools |

| `GET /events` | SSE stream |

Interactive docs: `http://127.0.0.1:8000/docs` (FastAPI Swagger) while the app runs.

---

## 10. Frontend guide

- **Routes** (`main.tsx`): `/` Dashboard · `/cases` · `/cases/\<case-id…>` (splat route because IDs have slashes) · `/overlaps` (`?open=OVL-xxxx` opens the Why-flagged drawer) · `/rooms/:id` · `/institutions` · `/institutions/:id` · `/reports` · `/alerts` · `/register` (Register complaint: single form + bulk CSV).

- **Data fetching:** `useApi(path)` (in `api.ts`) fetches and **auto-refreshes on SSE events and on role change**. It sets `data=null` on error so 403/404 show an `ErrorBox`. Use `post()`/`api()` for writes; `download()` for files (it sends the role headers; a plain `\<a href>` can't).

- **Role:** `useRole()` / `setRole()` (persisted in `localStorage`). The header dropdown calls `setRole`; every `api()` call adds the headers. UI greys out actions using the `allowed_actions` the server returns — **the server is the source of truth**.

- **Shared UI** (`ui.tsx`): `BureauBadge`, `StatusChip`, `SlaChip`, `RiskBadge`, `ScoreRing`, `Card`, `Drawer`, `Countdown` (live SLA timer using server clock), formatters.

- **Conventions:** Tailwind utility classes; theme tokens in `index.css` (`navy`, `navy-2`, `saffron`); status/bureau colours live in `ui.tsx`. TypeScript is intentionally loose (`any` is common) — tighten if you add shared types.

- **Gotcha:** after editing the frontend, run `npm run build`, then hard-refresh the browser (the server sends `Cache-Control: no-cache` for `index.html`, but an open tab keeps its old bundle).

---

## 11. Conventions & gotchas (read before changing things)

1\. **Always use `127.0.0.1`**, not `localhost` (Windows IPv6 fallback ≈ +2 s per request).

2\. **After the time machine or tamper button, press Reset** — the clock stays advanced and the audit chain stays "broken" until you do.

3\. **`append_action()` is the only way to write history.** Never `UPDATE action_history` (except the tamper demo) or the chain breaks.

4\. **`db.get_conn` is a per-request connection**; `check_same_thread=False` is set because FastAPI runs a sync dependency and its endpoint in different worker threads.

5\. **Reset lock:** `db.READY` makes requests wait while a reset rebuilds tables. Don't bypass it with your own long-running DB work.

6\. **Case ID prefix ≠ current Bureau.** `case_id` prefix is the Bureau that received it; the current handler is `bureau_code`. Overlap type and permissions use `bureau_code`.

7\. **In `seed.py` the module is imported as `sla_engine`** because a local variable called `sla` exists there.

8\. **Seed/engine change → re-run tests and the smoke test.** The tests pin: 11 clusters, hero is HIGH across RB/PGRC/AB, decoys unlinked, all 6 simulate scenarios HIGH, SLA engine idempotent, chain intact after escalations.

9\. **SLA schema support.** `db.py` adds the `sla_rules` and `holidays` tables and case SLA snapshot columns to the demo schema, with a compatibility migration on connection. Re-seed (`python run.py --reseed`) for fresh synthetic data; verify migrations and persistence in tests.

10\. **Git:** this folder currently sits inside a larger, unrelated Documents-level git repo. Create a dedicated repo for `SIH_DEMO` (`git init` here) before the team starts branching. `data/demo.db`, `data/uploads/`, `vendor/`, `*.zip`, `node_modules/`, `__pycache__/` are gitignored; **`frontend/dist` is deliberately committed**.

11\. **Dark corners worth knowing:** the dashboard "received vs disposed" trend is skewed to the latest month (most open cases are recent); the hero cluster is not the top-ranked row on the Overlaps page (use the search box); the sidebar is hidden below the `md` breakpoint (no mobile nav yet).

---

## 12. Demo & rehearsal materials

- [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md): timed 3-minute script (exact clicks + talk track), honest answers to likely judge questions ("is it AI?", "how accurate?", "tamper-proof?", "real data?"), failure/fallback table, rehearsal checklist.

- `scripts/smoke_test.py`: automates the demo flow twice + sweeps every read endpoint for every role (no 5xx, all <1 s; typical latency 10–50 ms).

- The honest framing to keep: **prototype on synthetic data; matching, SLA, audit and workflow logic are real; production adds connectors to Bureau systems/AICTE master, SSO, and real email/SMS.**

---

## 13. Not built / known limitations

- **No authentication** (roles are header-based and server-enforced, but anyone can change the header). Production: AICTE SSO / e-Office, RBAC+ABAC, MFA.

- **No email/SMS** — alerts are in-app only; "send reminder" isn't implemented at all (planned as a message preview/outbox mock).

- **Data is synthetic**; officials can now register complaints and import CSVs, but there are still no live feeds from CPGRAMS/Bureau systems; the institution master is the seeded table.

- **English only**; no Hindi/regional-language matching.

- **No review queue** for complaints whose institution can't be resolved: the Register form asks the user to pick from suggestions, and CSV rows that don't match are reported as "needs review" and **skipped** (fix the CSV and re-upload). Nothing is parked for later.

- **Weights are hand-set** (calibrated on the test pairs), not learned from feedback; no officer "was this right?" loop.

- **SLA values are illustrative**, not verified statutory deadlines. Bureau/category rules and a working-day calendar are implemented; holidays must be populated with authoritative dates before operational use. No rule-creation API, holiday-management UI or legal validation is provided.

- **Coordination "merge" is logical** — cases are linked under a lead Bureau (and the guard restricts follower Bureaus), but nothing syncs to systems of record. A room can only be opened from a **detected** cluster: there is **no manual link/unlink** of arbitrary cases yet.

- **Alerts are not role-targeted:** every role sees every alert (the Regional Office is filtered by region).

- **PDF has no charts**; no custom report builder, saved filters, or scheduled reports.

- **Documents:** local disk only, ≤2 MB, no inline preview, no e-signature.

- **Heatmap is region-level** (no district drill-down). Region names (8) should be verified against AICTE's real regional-office structure.

- **K4 case-network graph** not built.

- **Scale:** SQLite, single process, in-memory TF-IDF refit per detection run — fine for hundreds of cases; production needs PostgreSQL, a worker queue, and incremental indexing.

- **UI:** desktop-first; sidebar hidden on narrow screens; TypeScript loosely typed; no automated frontend tests.

---

## 14. Suggested backlog for the team

Suggested split mirrors the original four tracks. Effort is a rough developer-hour guess.

**Track A — Backend / platform**

- Real auth stub (JWT + role claims) replacing header roles, keeping the same `roles.allowed_actions` matrix (3–4 h).

- DB migrations (Alembic or a tiny versioned-SQL runner) so schema changes don't force a reseed (2–3 h).

- Move to PostgreSQL + a real job runner for the SLA tick (4–6 h, production scope).

**Track B — Intelligence**

- **Review queue for unresolved/ambiguous institution matches** (park the complaint, let an officer confirm later; reuse `Registry.suggest`) (3 h).

- **Manual link/unlink of cases** and add/remove case in a Coordination Room (2 h).

- **Role-targeted alerts** (RB sees alerts about RB cases and overlaps it is part of) (1 h).

- **Officer feedback on overlaps** ("was this right?" thumbs) storing labels; script to re-tune weights/thresholds (3–4 h).

- Multilingual (Hindi) matching via on-prem embeddings, e.g. MuRIL/IndicBERT (research, 6+ h).

- Add more labelled pairs + edge cases to `test_prototype.py` as the data grows.

**Track C — Frontend**

- **K4 case-network graph** on the institution profile (institution → Bureaus → cases) (3–4 h).

- Mobile/tablet navigation (collapsible sidebar) and a responsive pass (2 h).

- Tighten TypeScript types (generate from the OpenAPI schema) (2 h).

- Embed charts in the PDF export (2 h); saved filters for reports (2 h).

- Risk-trend sparkline on the institution page (needs monthly risk snapshots) (2 h).

**Track D — Product / demo**

- **Outbox (simulated email/SMS)** page + "Send reminder" message preview (2 h) — closes the R7 gap honestly.

- Inline document preview (PDF/image) (2 h); @mentions + decision templates in the Coordination Room (2–3 h).

- Record a backup screen capture, polish the slide for "future scope" (use §13), rehearse the script 3× (see `DEMO_SCRIPT.md`).

- Frontend tests (Playwright) for the demo path, run alongside `smoke_test.py`.

---

## 15. Recipes

| I want to… | Do this |

|---|---|

| Add a complaint **category** | add to `constants.CATEGORIES` (+ `BUREAU_CATEGORIES`), add text templates in `seed.DESC`, keyword in `nlsearch.CATEGORY_RULES`, topic words in `intel.TOPICS` if relevant, re-seed |

| Change an SLA | Use `PUT /api/sla-rules/{rule_id}` as the `SENIOR` role; existing case snapshots stay unchanged. |

| Retune overlap scoring | edit weights/`TEXT_FULL_COSINE`/thresholds in `intel.py`; run `pytest` + `scripts/smoke_test.py`; adjust planted data in `seed.py` if clusters move |

| Add a new **alert type** | create it in `sla.py` (or the relevant endpoint) via an `INSERT INTO alerts`, give it a `link`, add an icon + tab in `pages/Alerts.tsx` |

| Add a new **report** | write `_mykind(conn, ctx, rows, today)` in `reports.py` returning `{columns, rows, chart}`, register it in `KINDS`, add a tab in `pages/Reports.tsx` |

| Add a workflow **action** | extend `ACTION_LABEL` + branch in `case_action` (`main.py`), permission in `roles.allowed_actions`, button in `CaseDetail.tsx` |

| Add a **role** | add to `roles.PERSONAS` / `ROLE_LABELS`, update `allowed_actions`; the dropdown reads `/api/meta` |

| Add an **institution field** | `db.SCHEMA` + `seed.build_institutions` + `Institution.tsx`, re-seed |

| Reset everything | Demo ▾ → Reset demo data, or `python run.py --reseed` |

---

## 16. Glossary

**RB** Regulation Bureau · **PGRC** Public Grievance Redressal Cell · **AB** Approval Bureau · **LC** Legal Cell · **VIG** Vigilance Cell · **SLA / prescribed timeline** days within which a case should be disposed · **Cluster** a group of cases flagged as the same real-world problem at one institution · **Coordination Room** the shared space where the Bureaus in a cluster pick a lead and record a decision · **Hash chain** each history record includes the previous record's hash so edits are detectable · **Time machine** demo control that advances the app's clock · **LITE / MOCK** how much of a feature is real in the prototype (see [§2](#2-status-at-a-glance--plan-vs-what-exists)).

## Backend test isolation

Install `requirements-dev.txt` for pytest, HTTP client tests and coverage. Run

`python -m pytest backend/tests -q --cov=backend/app --cov-report=term-missing`.

`backend/tests/conftest.py` supplies an isolated database copy per test from one

session-seeded template, plus `conn`, `client` and `as_role` fixtures. Test modules

must not set `AICTE_DB` at import time. `db.configure(path)` overrides the DB path;

`db.configure()` restores environment-based configuration. Mark expensive workflow

tests with `pytest.mark.slow` when appropriate.

## Issue #10 � Connection Galaxy Truncation and Filters

- Added accurate `totalCases`, `shownCases`, and `truncated` response fields.

- Added region, institution, and clustered-cases-only filters.

- Added a configurable case limit (default 120, maximum 400).

- Prioritized active-cluster cases, then overdue cases and higher severity.

- Optimized institution counts and prevented dangling graph edges.

- Kept rejected overlap pairs hidden and preserved existing response keys and node types.

- Added frontend filter controls and a truncation notice.

**API:** `GET /api/galaxy/graph`

**Query parameters:** `bureau`, `region`, `institution_id`, `cluster_only`, `limit`.

**Validation:**

- Backend tests: `py -3.12 -m pytest backend/tests -q`

- Frontend build: `cd frontend; npm run build`

- Measured graph-generation time: 6.7 ms on the current test database (target: under 300 ms).

## Issue #19 — Configurable SLA Rules (implementation checklist)

The change introduces `backend/app/sla_rules.py` for category-aware rule selection, holiday-aware due dates, and progress calculations. `db.py` adds `sla_rules`, `holidays`, `sla_warn_pct`, and `sla_use_working_days`. `services.py` snapshots the selected rule at case creation, `sla.py` uses those snapshots for warnings and escalation, and `main.py` exposes rule list/update endpoints. `CaseDetail.tsx` labels each prescribed timeline as working days or calendar days.

**Compatibility expectations:** Existing cases retain their due dates, day-count method and warning threshold when a rule changes. Rules are keyed by `(bureau, category)`, with `category='*'` as the Bureau default. Holidays are optional; weekends are always excluded in working-day mode.

**Verification before merging:**

```bash
python -m pytest backend/tests/test_sla_rules.py -q
python -m pytest backend/tests -q
cd frontend && npm run build
```

Run `python scripts/smoke_test.py` against a running application, and verify the SENIOR-only rule update, case snapshot immutability, Saturday/Sunday skips and holidays. Do not mark Issue #19 tested until these commands pass.
