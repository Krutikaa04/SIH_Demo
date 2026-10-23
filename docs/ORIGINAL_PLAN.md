# AICTE Integrated Complaint Monitoring & Status Dashboard — Original 6-Hour Build Plan (SIH)

> This is the plan that was approved at the start of the project, kept for reference.
> **For what was actually built, how it differs from this plan, and what is left, read [`../PROJECT_HANDOFF.md`](../PROJECT_HANDOFF.md).**
> Note: the team-of-4 split below was the *plan*; in practice the prototype was built by one developer working with an AI assistant. The tracks are still a good way to divide the remaining work.

## Context
AICTE complaints about one institution are handled in silos (RB, PGRC, AB, LC, VIG). Nobody can see who holds what, so work is duplicated and delayed. The goal: a polished, offline, single-laptop prototype of a single-window dashboard within 6 hours / 4 developers, covering all 8 required features and standouts A–K.

Assumptions: AI coding assistant used for boilerplate; estimates are dev-hours (team total 4 × 6 = 24); everything runs offline from one command; all data synthetic, institution names fictional-but-realistic; "Synthetic data: prototype" ribbon in the UI.

---

## 1. Solution summary and demo story
**Summary.** One FastAPI service plus a React single-page app, backed by a pre-seeded SQLite database of ~60 institutions and ~300 cases across 5 Bureaus/Cells and 8 regions. Every complaint is entity-resolved to a master AICTE institution record (works even when the name is misspelled/abbreviated or the AICTE ID is missing). An **explainable overlap engine** (ID match, fuzzy name, TF-IDF text, category, time window) scores every pair of cases about the same institution handled by different Bureaus and raises "Potential Overlapping Cases – Coordination Required" with a visible score breakdown. Officials open a **Coordination Room** to link the cases, pick a lead Bureau, discuss and decide. SLA timers auto-escalate overdue cases. Every action is stored in a hash-chained audit trail. Senior management sees a live dashboard, an India heatmap, institution risk scores and an auto-written briefing.

**Story for judges ("the Pune problem").** A faculty-shortage complaint sits with RB, and a student grievance about the same college sits with PGRC. Names are spelled differently, one has no ID, descriptions differ. Nobody knows. Show dashboard → overlap → Coordination Room → live-simulated new complaint → SLA auto-escalation → integrity check.

**Wow ranking (lead with, in order):** 1. G+A live-simulated complaint with explainable overlap alert · 2. B Coordination Room · 3. D+K1 SLA countdown + time machine · 4. E natural-language search · 5. F hash-chained audit + tamper demo · 6. C risk score · 7. I heatmap · 8. H role switcher · 9. K3 briefing · 10. J exports / K2 effort-saved.

---

## 2. Tech stack
| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI + SQLite (planned: SQLAlchemy 2 — *built with plain `sqlite3`*), Pydantic, `rapidfuzz`, `scikit-learn` (TF-IDF), asyncio background scheduler, SSE | Pure Python, no services to install; OpenAPI doubles as contract; fast on 300 cases; reset = file copy/reseed |
| Frontend | React 18 (built with 19) + Vite + TypeScript (strict off) + Tailwind + Recharts + d3-geo + lucide-react + jsPDF/autotable | Fast to build, looks good, heatmap from bundled GeoJSON with no tiles/internet, fonts bundled (no CDN) |
| Packaging | `python run.py` seeds the DB if missing and serves API + prebuilt `frontend/dist` on one port | One command, no Node needed on the demo laptop; wheelhouse for offline pip |

---

## 3. Feasibility table (verdicts and hour estimates)
Budget: 24 dev-hours = 17.5 core + 2.5 checkpoints (CP1, CP2) + 1.0 CP3/freeze + 3.0 final QA/rehearsal. Spare ≈ 0.5.

### Required features
| # | Feature | Verdict | Hrs | Simplified / faked | Future scope |
|---|---|---|---|---|---|
| R1 | Centralized Institution Profile | FULL | 0.75 | Synthetic fields | Sync with AICTE master DB |
| R2 | Case tracking (all listed fields) | FULL | 1.5 | Seeded data | Two-way sync with Bureau systems (e-Office, CPGRAMS) |
| R3 | Cross-Bureau overlap detection + linking | FULL | 1.25 | English only; rule-based + fuzzy entity resolution | Multilingual embeddings; learned matcher from officer feedback |
| R4 | Real-time dashboard | LITE | 1.25 | "Real-time" = SSE push + refresh, single process | Streaming feed (CDC/Kafka), materialized views |
| R5 | Workflow & action history (+ docs) | FULL (docs LITE) | 1.0 | Docs on local disk, SHA-256 in chain; no preview/DMS/e-sign | e-Office DMS, DSC e-signature |
| R6 | Search & filters (all 8) | FULL | 0.5 | — | OpenSearch with Hindi |
| R7 | Alerts & notifications | LITE | 0.5 | In-app only; email/SMS is MOCK | NIC SMTP + SMS gateway |
| R8 | Reports & analytics | LITE | 1.0 | 7 fixed reports, no custom builder | Report builder, scheduled reports, BI export |

### Standout features
| # | Feature | Verdict | Hrs | Simplified / faked | Future scope |
|---|---|---|---|---|---|
| A | Explainable overlap engine | FULL | 0.75 | Hand-set weights calibrated on labelled pairs | Learned weights from link/dismiss feedback |
| B | Coordination Room | LITE | 1.0 | "Merge" is logical (linked under lead Bureau), no sync to systems of record | Formal merge workflow with approvals |
| C | Institution risk score | FULL | 0.5 | Transparent formula, not statistically validated | Calibrated predictive model |
| D | Auto-escalation + SLA timers | FULL | 0.75 | SLA days illustrative | Statutory per-category SLAs, working-day calendars |
| E | Natural-language search | LITE | 0.75 | ~12-pattern rule-based grammar, English only; always shows "I understood" chips | On-prem small LLM / semantic parser, Hindi |
| F | Hash-chained audit trail + verify | FULL | 0.5 | Tamper-*evident*, not tamper-proof | Anchor digests to WORM store; per-officer DSC signatures |
| G | Simulate New Complaint | FULL | 0.5 | Scripted payloads; pipeline is real | Real intake channels |
| H | Role switcher + permissions | LITE | 0.5 | Role via `X-Role` header; server enforces matrix; no login | AICTE SSO, RBAC/ABAC, MFA |
| I | India region heatmap | LITE | 0.75 | Region choropleth from simplified GeoJSON, no district drill-down | District-level GIS |
| J | CSV/PDF export | CSV FULL, PDF LITE | 0.5 | PDF client-side, table only (no charts) | Server-rendered signed PDFs |
| K1 | Demo time machine (+7 days) | FULL | 0.25 | Offsets a settings clock | — |
| K2 | "Duplicate effort saved" counter | LITE | 0.25 | Estimate with visible assumptions | Measure real avoided parallel notices |
| K3 | Auto-written daily briefing + ping-pong detector | LITE | 0.25 | Template narrative from live numbers | On-prem LLM narrative |
| — | Infra (skeleton, contract, `run.py`, fixtures) | FULL | 0.5 | | |
| — | Synthetic data generator | FULL | 1.25 | Deterministic (seed 42) | Real ingestion connectors |
| — | Real data ingestion / real SSO | MOCK | 0 | Seed data stands in | Connectors/ETL |

Stretch (spare capacity only): **K4** case-network graph on the institution profile (~1.0h).

---

## 4. Team split (as planned)
| Dev | Track | Owns |
|---|---|---|
| Dev 1 | Backend core | Skeleton, `run.py`, schema, CRUD + filters, workflow actions + history + docs, hash chain, SLA/escalation/alerts/time machine, Coordination Room backend, contract/OpenAPI |
| Dev 2 | Intelligence & data | Data generator, overlap engine (normalize, resolve, score, explain, cluster, persist), risk score, NL parser, dashboard/report aggregates + CSV, simulate + SSE |
| Dev 3 | Frontend 1 | Shell, routing, role switcher, API client, dashboard, heatmap, alerts panel + toasts + SSE client, cases list/search/filters/NL UI, shared components |
| Dev 4 | Frontend 2 + demo | Institution profile, case detail/timeline/actions/verify UI, Coordination Room + "Why flagged" drawer, reports + CSV/PDF, Simulate button, demo prep |

Git rules planned: monorepo; each dev in own folders; short-lived branches `devN/…`; Dev 1 integrates to `main`; `git pull --rebase` before push; never force-push; contract/constants changes via PR; tags `contract-v1`, `cp1`, `cp2`, `v-freeze`, `v-demo`.

---

## 5. Build priority order
**P0 (demo spine):** one-command app · case list/detail/history from real DB · overlap engine + persisted pairs + HIGH alert + "Why flagged" · dashboard KPIs/charts · Coordination Room · Simulate New Complaint.
**P1:** SLA timers + auto-escalation + time machine · hash chain + verify · institution profile + risk score · role switcher · alerts panel · search & filters.
**P2:** heatmap · NL search · reports + exports · briefing + effort saved · document upload.
**P3 (spare only):** K4 network graph + upgrade items.

Degrade-not-delete ladder if behind: PDF → print page (CSV kept); heatmap → tile grid; NL search → 6 patterns; doc upload → seeded docs only; reports → 4 tables + CSV.

---

## 6. Overlap algorithm (as planned)
1. Normalise names (lowercase, strip punctuation, expand abbreviations govt→government etc., drop stopwords, city as blocking key).
2. Resolve institution: exact AICTE ID, else best fuzzy match (rapidfuzz) within the same city/state; ≥88 auto-resolve, 80–88 low confidence, <80 unresolved.
3. Candidates: other cases at the same institution that are open or disposed within 90 days.
4. Score five signals (total 100): identity 30 · name similarity 15 · text similarity 25 · category 15 · time window 15.
5. Classify: ≥70 HIGH ("Potential Overlapping Cases - Coordination Required"), 50–69 MEDIUM, <50 discarded; cross-Bureau vs same-Bureau duplicate.
6. Cluster with union-find; 7. persist pair + breakdown + explanation, raise alert, emit SSE; 8. planted negative controls prove precision.

Risk score (0–100): volume (≤30) + severity (≤30) + repeat offences (≤20) + overdue (≤20); bands Low <40, Medium 40–69, High ≥70.

---

## 7. Hour-by-hour schedule (as planned)
Checkpoints: CP1 at 2:00 (FE flips to live API), CP2 at 4:00 (full demo walkthrough, triage), CP3 at 5:00 (hard feature freeze, tag). No new feature starts after 3:30. Last hour: clean-machine test with Wi-Fi off, rehearsals ×3, backup recordings, code lock at 5:50.

---

## 8. Top risks (as planned)
1. Overlap engine misfires / Dev 2 slips → labelled test pairs, planted scenarios, freeze weights at CP2.
2. Integration drift → freeze contract at 0:30, shared fixtures, CP1 live flip.
3. Scope overrun → priority order, degrade ladder, feature freeze.
4. Demo-day environment failure → one command, prebuilt dist, no CDNs, wheelhouse, second laptop, recordings.
5. Live Simulate / time machine misbehaves → deterministic payloads, rehearsed 3×, Reset button, pre-seeded alert.

---

## Appendix: original problem statement (AICTE)
Build an "Integrated Institution Complaint Monitoring and Status Dashboard". AICTE complaints about the same institution are received and processed separately by different Bureaus/Cells (Regulation Bureau RB, Public Grievance Redressal Cell PGRC, and others), causing overlapping actions, duplicated effort, delays, and no way to see which Bureau is handling which institution. One single-window dashboard for authorized AICTE officials.

**Objectives:** view all institution-related complaints in one place · identify the Bureau/Cell currently handling each case · track full status and movement · identify overlap between RB/PGRC/other Bureaus on the same institution · avoid duplicate action and ensure coordination · monitor pending, disposed, under-process, transferred and escalated cases · institution-wise, region-wise, Bureau/Cell-wise and status-wise reports · alerts for pending cases and cases nearing prescribed timelines.

**Required features:** (1) Centralized Institution Profile (unique AICTE Permanent ID, name, address, region, details, consolidated complaint history). (2) Complaint/Case Tracking (case ID, date of receipt, nature/category, status, assigned Bureau/Cell, assigned officer, last action, next action, date of last action, expected disposal date). (3) Cross-Bureau/Cell Overlap Detection even when descriptions or case references differ; alert "Potential Overlapping Cases - Coordination Required"; linking/mapping of related cases. (4) Real-time dashboard (total received, pending, under process, disposed, transferred, pending beyond timelines, institution-wise status, Bureau-wise workload). (5) Workflow and action history (chronological, officer/Bureau per action, timestamps, remarks and supporting documents, transfer/escalation history). (6) Search & filters (institution name, AICTE ID, case ID, Bureau/Cell, region, category, status, date range). (7) Alerts & notifications (duplicate/overlap, pending reminders, escalation, timeline/SLA). (8) Reports & analytics (Bureau-wise, region-wise, institution-wise history, pending ageing, disposal rate, overlapping/duplicate cases, monthly/quarterly performance).

**Target users:** RB, PGRC, other Bureaus/Cells, Regional Offices, senior management, Competent Authority. **Innovation expected:** data matching, rule-based logic and/or AI-assisted analytics to detect same-institution complaints.

**Hackathon constraints:** zero paid APIs, no internet during the demo, runs on a laptop, pre-seeded demo DB, starts with one command.
