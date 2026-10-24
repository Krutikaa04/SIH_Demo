# AICTE Integrated Institution Complaint Monitoring & Status Dashboard (SIH Prototype)
## Ported Enhancements & Pull Request Context Document

> **Contribution to `Krutikaa04/SIH_Demo` (master branch alignment)**  
> **Target Problem Statement (SIH PS 26264)**: *Tracking and connecting complaints against institutions across bureaus.*

---

## 1. Context & Architectural Alignment

Per team coordination, this Pull Request **keeps the existing repository (`Krutikaa04/SIH_Demo:master`) as the foundation**. Rather than replacing the codebase with Next.js or external ORMs, the highest-value intelligence features have been natively ported directly into the team's lightweight **React 19 + Vite + Tailwind CSS + FastAPI + SQLite** architecture:

```
                            ┌───────────────────────────────────────────────┐
                            │    AICTE ICMD Frontend (Vite + React 19)      │
                            │  Tailwind CSS v4 • @xyflow/react • Recharts   │
                            └───────────────────────┬───────────────────────┘
                                                    │ REST API + SSE
                                                    ▼
                            ┌───────────────────────────────────────────────┐
                            │        FastAPI Backend Engine (Python 3.13)   │
                            ├───────────────────────────────────────────────┤
                            │ • Connection Galaxy Graph Topology Generator  │
                            │ • Per-Pair Human-in-the-Loop Review & Audit   │
                            │ • Restore & Re-Verify Tamper Recovery Engine  │
                            │ • Evidence-Grounded Executive Briefing Engine │
                            │ • Entity Extractor (Amounts, Circulars, Rolls)│
                            │ • Explainable Overlap Engine (TF-IDF + Cosine)│
                            │ • SHA-256 Hash-Chained Audit Ledger           │
                            └───────────────────────┬───────────────────────┘
                                                    │
                                                    ▼
                            ┌───────────────────────────────────────────────┐
                            │     Database: Zero-Dependency SQLite3         │
                            │     Institutions • Cases • History • Overlaps │
                            └───────────────────────────────────────────────┘
```

---

## 2. Ported Feature Breakdown

### 1. Connection Galaxy (`/galaxy`) — Interactive Knowledge Graph
- **Library**: Built using `@xyflow/react` (React Flow), natively integrated into the team's Vite React bundle.
- **Backend API**: `GET /api/galaxy/graph?bureau={code}` generates nodes and edges directly from SQLite.
- **Node Entities**:
  - **Institution Hubs** (glowing badge with docket counts and cluster indicators).
  - **Case Dockets** (color-coded by regulatory bureau: `RB`, `PGRC`, `AB`, `LC`, `VIG`, with overdue indicators).
  - **Regulatory Bureaus** (authority seals along outer perimeter).
  - **Taskforce Clusters** (active coordination units).
- **Edge Topology**:
  - Glowing Cyan solid lines for Confirmed/Linked overlaps.
  - Violet dashed lines for High AI-suggested overlaps.
  - Amber lines for Taskforce cluster relationships.
- **Interactive Capabilities**:
  - Minimap, zoom/fit controls, and real-time bureau filtering.
  - Contextual **Inspector Drawer**: Click any node or edge to inspect metadata, confidence scores, and navigate directly into the case dossier (`/cases/:id`) or coordination room (`/rooms/:id`).

---

### 2. Per-Pair Review with Mandatory Rationale (`/overlaps`)
- **Workflow**: Empowers investigators to review each AI-suggested candidate pair in the Overlap queue.
- **Actions Available**:
  - **Confirm Link**: Validates cross-bureau systemic connection.
  - **Not Related**: Formally dismisses candidate overlap.
  - **Defer Review**: Retains pair for subsequent inquiry.
- **Mandatory Justification**: Requires investigator rationale before committing to ledger.
- **Cryptographic Audit**:
  - `POST /api/overlaps/{pair_id}/review` updates the pair status (`CONFIRMED`, `REJECTED`, `DEFERRED`).
  - Appends an immutable block record to `action_history` using `db.append_action(...)`, binding the review decision to the case's SHA-256 hash chain.

---

### 3. Quantitative Effort-Saved ROI Benchmark (`/reports` -> ROI Tab)
- Replaces rough estimates with the formal combinatorial ROI model:
  $$\text{Manual Review Workload} = \frac{N \times (N - 1)}{2} \times 12\text{ minutes}$$
  $$\text{AI Candidate Review Workload} = \text{Suggested Candidates} \times 3\text{ minutes}$$
  $$\text{Net Hours Saved} = \text{Manual Workload} - \text{AI Workload}$$
- **Interactive Slider**: Evaluators can adjust complaint volume $N$ (50 to 1,500 dockets) and view:
  - Hours Saved (e.g. 8,900+ officer hours).
  - Review Speedup factor (e.g. $40\times$ faster).
  - Net officer-months saved.
  - Interactive comparison bar chart and transparent assumptions.

---

### 4. Evidence-Grounded Executive Briefing (`/briefings`)
- **Backend API**: `GET /api/briefings/executive` synthesizes leadership briefs with **zero hallucination**.
- Every figure, cluster, and high-risk institution carries **clickable citation chips** (e.g., `[CASE-...]`, `[ROOM-...]`, `[1-...]`).
- **Interactive Frontend**:
  - Click any blue docket chip to navigate straight to the case detail dossier or coordination room.
  - Print-friendly layout ready for official Directorate dissemination (`window.print()`).

---

### 5. Audit Vault "Restore & Re-Verify" (`/admin/restore-tamper`)
- Completes the tamper-evident demonstration loop:
  1. Click **"Tamper with a record"** $\rightarrow$ Raw database modification without re-hashing.
  2. Click **"Verify audit trail"** $\rightarrow$ Traverses the chain and flags the corrupted block.
  3. Click **"Restore & re-verify"** $\rightarrow$ Automatically restores the tampered record to its original pristine state and re-runs `db.verify_chain(...)` to restore 100% mathematical integrity.

---

### 6. Entity Extractor for Complaint Text (`intel.py`)
- Added `extract_entities(text)` in `backend/app/intel.py`:
  - **Financial amounts**: `₹45,000`, `Rs. 50000`, `1.5 lakh`.
  - **Regulatory circulars**: `Circular No. AICTE/2026/04`, `Ref No. 12/2025`.
  - **Roll / Registration numbers**: `Roll No: ENR-99214`, `Hall ticket #`.

---

## 3. Automated Quality Assurance

All 28 backend tests pass with 100% success rate:
- 23 original regression tests (`test_prototype.py`, `test_registration_guard.py`).
- 5 new tests covering all ported features (`test_ported_features.py`).

```
tests/test_ported_features.py::TestPortedFeatures::test_entity_extraction PASSED
tests/test_ported_features.py::TestPortedFeatures::test_executive_briefing_generation PASSED
tests/test_ported_features.py::TestPortedFeatures::test_galaxy_graph_generation PASSED
tests/test_ported_features.py::TestPortedFeatures::test_per_pair_review_and_audit_logging PASSED
tests/test_ported_features.py::TestPortedFeatures::test_tamper_and_restore PASSED
tests/test_prototype.py::TestEntityResolution (4 tests) PASSED
tests/test_prototype.py::TestOverlapEngine (4 tests) PASSED
tests/test_prototype.py::TestAuditChain (1 test) PASSED
tests/test_prototype.py::TestSlaEngine (1 test) PASSED
tests/test_prototype.py::TestNaturalLanguage (4 tests) PASSED
tests/test_prototype.py::TestRiskAndRoles (3 tests) PASSED
tests/test_registration_guard.py (6 tests) PASSED
====================== 28 passed in 2.72s ======================
```

**Frontend Bundle**:
`npm run build` compiles in 664ms with 0 errors, updating `frontend/dist`.

---

## 4. How to Run the Demo

```bash
# Backend + UI in one command (offline):
python run.py

# Or develop the UI live:
cd frontend
npm run dev     # http://localhost:5173
```
