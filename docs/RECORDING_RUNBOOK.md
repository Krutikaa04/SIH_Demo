# Prototype recording runbook

Show one complete journey: **notice a new concern → explain related cases → agree
a lead and commitments → verify follow-through → inspect recorded outcomes**.
Use the integrated branch in [the merge sequence](MERGE_SEQUENCE.md). Individual
feature branches do not contain the whole journey.

## Prepare a take

From the repository root, build the exact checkout. On a new machine install
runtime/development requirements and run `npm ci` in `frontend` first. Node is
needed for building; the built app runs from Python on one port.

```sh
git status --short
git rev-parse --short HEAD
cd frontend
npm run build
cd ..
AICTE_DB=data/recording-take-01.db .venv/bin/python run.py --no-browser
```

Choose an unused take filename for fresh synthetic data. Keep the same `AICTE_DB`
for the server session. An existing file retains decisions, clock offset and
audit changes; this command does not reseed it. Do not switch branches or rebuild
while recording.

In a second terminal:

```sh
.venv/bin/python scripts/check_recording.py --innovation --demo-login
```

The preflight checks built entry assets, metadata, clock, audit integrity,
dashboard, hero overlap and innovation API contracts. It reports all failures and
returns nonzero when prerequisites are missing. It does not reset, register,
decide, advance time or complete tasks. `--demo-login` signs in and out of the
published Senior demo account on loopback only; that creates authentication
session/log records. Operational checks use GET. It refuses automatic sign-in
when demo mode is off. It does not replace a browser rehearsal.

Open **http://127.0.0.1:8000**, sign in as **Senior Management** (`senior` with the
published demo password, default `Demo@2026`), and rehearse on a
separate take database. Use a fresh take for the final recording. Save the commit
ID with the video. Enable Demo mode only when its controls are needed.

`scripts/smoke_test.py` resets and mutates its target twice. It registers cases,
records decisions, advances the clock and tampers with history. Use it only on an
explicitly disposable rehearsal database, never on a take you want to preserve.

## Four-minute story

| Time | Screen and action | Suggested narration |
| --- | --- | --- |
| 0:00–0:20 | Home as Senior Management. Show pending workload and overlap alert. | "One institution can have separate complaints at several Bureaus. We connect the records and give each official a clear next step." |
| 0:20–0:45 | Institutions → Sahyadri → New concerns after closure. Open previous/current case evidence. | "Another concern arrived after a case in this category was closed. That prompts a review of both histories; it does not prove wrongdoing or a failed resolution." |
| 0:45–1:20 | Review overlaps → Sahyadri → Why flagged. Explain the breakdown. Confirm one pair with a reason. | "Identity, wording, category, timing and shared identifiers support review. The score prioritizes evidence; an official decides. We record that review in both case histories." |
| 1:20–2:00 | Start coordinating. Keep RB as lead. Create a commitment for a linked PGRC case with a future due date and concrete deliverable. Record One Bureau leads. | "One agreed lead, plus a named Bureau responsible for the next deliverable. Coordination has an owner and a due date." |
| 2:00–2:35 | Account menu → Switch demo account → Public Grievance Cell. Open its follower case and show guarded competing actions. Return to the room and complete PGRC's commitment with a concrete completion note. | "The follower can contribute evidence and deliver its commitment. Conflicting case actions remain guarded. Completing a commitment does not silently close a complaint." |
| 2:35–3:05 | Return to Senior Management → Executive briefing. Show an item, owner, reason and source link. | "Management gets a rule-based action agenda grounded in case records, including ownership problems and pending follow-through." |
| 3:05–3:35 | Reports → Coordination outcomes. Show reviews, decisions, followers and source links; download Spreadsheet. | "These are recorded actions. Each reviewed pair counts once across both ledgers. A merge is not a disposal; current followers are work to follow up, not invented savings." |
| 3:35–4:00 | Open case history → Check the record, or Demo tools → Verify the audit trail. | "The workflow is real and traceable, running locally. Data is synthetic. These are real local sign-in sessions with published demo accounts; production needs AICTE SSO, MFA and source-system connectors." |

If a step takes longer, omit a secondary chart or export. Keep the full journey
visible instead of rushing through every navigation item.

## Optional evidence clips

- Intake preview: Legal Cell role, institution `Malabar Govt. College of Engg Kochi`,
  category `Affiliation / Approval Dispute`, description `Writ petition by students
  regarding an unapproved programme and invalid degree; approval status disputed
  (₹45,000).` Shared-amount points appear before saving. A new complaint's score
  can differ from the historical planted pair because its date/name differ.
- Negative control: the unrelated-topic Mysuru pair shares an amount and remains
  unflagged. Shared identifiers cannot override topic guards.
- Plain-language search: `pending RB cases in Western region older than 30 days`.
  Show the parsed filter chips so the audience sees what was understood.
- Timeline escalation: on a disposable take, Demo tools → Jump 7 days ahead.
  Show a System (SLA engine) event. Timelines are configured prototype rules.
- Tamper detection: on a disposable take, verify, tamper, verify again. Call it
  tamper-evident. Start a fresh take afterwards.
- Workload scenario: show visible assumptions and a negative difference when
  assisted review takes longer. Do not present scenario hours as measured savings.

## Defensible answers

| Question | Answer |
| --- | --- |
| What is distinctive? | Institution resolution, explained overlap evidence, guarded ownership, Bureau commitments, aftercare chronology and measured outcomes form one inspectable workflow. |
| Does a score prove duplication? | No. It ranks evidence for official review; it is not a calibrated probability. |
| What accuracy was measured? | A small 22-pair synthetic ablation moved HIGH recall from 18/19 to 19/19 without changing three negative classifications. Any-overlap recall stayed the same. This does not establish production accuracy. |
| Were the scenario hours saved? | No time study has been done. Reviews/decisions and current followers are recorded; workload scenarios use assumptions. |
| Does a new concern prove recurrence of wrongdoing? | No. Aftercare is a chronological same-category review prompt. Inspect the earlier outcome and both case records. |
| Does completing a commitment close the case? | No. It records its own attributed event and evidence note; disposal still uses normal permissions and coordination checks. |
| Is it tamper-proof or authenticated? | Hash chains reveal inconsistent records; a database administrator could recompute them. Local password sign-in and server-side sessions are implemented. Demo accounts share a published password; production needs AICTE SSO/MFA, consistent authorization and independent digest anchoring. |
| Does it need a paid model service? | Demonstrated matching and rules run locally. Email/SMS dispatch is simulated. Source-system integration and multilingual evaluation remain future work. |

## Recovery

1. Stop the take and preserve the recording; do not edit source or merge mid-take.
2. Inspect the terminal and run preflight. Missing assets suggest an unbuilt or
   mismatched frontend. A settled hero, shifted clock or altered chain suggests
   an already-used take database.
3. Stop the server with Ctrl+C, select a new unused take filename and restart.
   Earlier recordings and databases remain intact.
4. Keep a backup video and validated commit ID. A second laptop needs the built
   frontend and runtime dependencies; a source clone excludes `frontend/dist`.
