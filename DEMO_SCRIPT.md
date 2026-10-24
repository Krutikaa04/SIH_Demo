# Demo script (3 minutes) and rehearsal guide

Open **http://127.0.0.1:8000** (use `127.0.0.1`, not `localhost`: on Windows `localhost` can add a ~2 s IPv6 delay).
Browser full screen, 100% zoom, role = **Senior Management**.

## Before you go on stage (2 minutes)
1. `python run.py`, then in another terminal `python scripts/smoke_test.py`. It must print **ALL CHECKS PASSED**. It also leaves the data reset.
2. Refresh the browser. Check: role says *Senior Management*, no "Demo date +Nd" chip, bell shows unread alerts.
3. Start your screen recorder as insurance (Windows: **Win+Alt+R**).
4. Switch **Demo mode** on: click your role chip (top right, *Viewing as…*) and turn on the **Demo mode** switch. A **Demo tools** button appears bottom-right (Ctrl+Shift+D toggles it).
5. Know the reset: **Demo tools → Reset all demo data** (restores everything, also the clock and the audit trail).

## The 3-minute run
| Time | Do this | Say this | Proves |
|---|---|---|---|
| 0:00–0:20 | **Home** (as Senior Management). Point at the red banner, the headline figures (the red *Past due date* tile), *What stands out today*, then scroll to the **Regions** map (Western is darkest). | "One Pune college, three Bureaus, nobody knows. Today each Bureau sees only its own file. This is the single window: every complaint, every Bureau, one place." | Real-time dashboard, region view, briefing |
| 0:20–0:40 | **Cases** → click the example chip *pending RB cases in Western region older than 30 days* (or type it). Point at **"I understood:"**. | "Plain-English search. It's a rule-based parser, so it tells you exactly what it understood, runs offline, no AI service." | Natural-language search, filters |
| 0:40–0:55 | **Institutions** → search *Sahyadri* → open it. Show the **risk score**, its breakdown, and the history across RB, PGRC and AB. | "One master profile by AICTE ID. Risk score from volume, severity, repeat offences and overdue cases. This one is a repeat offender." | Institution profile, risk score |
| 0:55–1:25 | Click **Review overlaps** on the red banner, then **Why flagged?** on a cluster. Click through the three pairs. | "RB's case has no AICTE ID and spells the name 'Govt. College of Engg'. PGRC wrote it in full. The descriptions differ. We still match them, and show *why*: identity, name, text, category, time, with points." | Explainable overlap engine |
| 1:25–1:55 | **Start coordinating** → step 2 keep **RB** as lead → write a message → step 3 choose *One Bureau leads* → **Record the decision**. | "Instead of two show-cause notices, one lead Bureau, one decision, written into every case's history." Show the dashboard's *effort saved* later. | Coordination Room |
| 1:55–2:20 | Open **Demo tools → File a new complaint**. The toast pops. Then click your role chip (top right) and choose **Public Grievance Cell**. | "A new complaint arrives with a different spelling and no ID. Detected in under a second. Now I'm PGRC: my desk, and I can't act on RB's case." | Live alert, role switcher |
| 2:20–2:40 | **Demo tools → Jump 7 days ahead**. Toast: cases auto-escalated. Open **Cases**, choose *More filters → Status → Escalated*, open one: countdown and "System (SLA engine)" row. | "SLA timers on every case. When a timeline is crossed, it escalates by itself: Deputy Director, then Director." | SLA timers, auto-escalation |
| 2:40–2:55 | **Demo tools → Verify the audit trail** (green). **Tamper with a record.** **Verify** again (red). | "Every action is hash-chained. Change one record in the database and we see exactly which one." | Tamper-evident audit trail |
| 2:55–3:00 | **Reports** → **Export PDF**. | "Bureau, region, institution, ageing, disposal rate, overlaps, monthly and quarterly, as CSV or PDF. Offline, explainable, zero paid APIs." | Reports and export |

**After the run:** Demo tools → **Reset all demo data** (the audit trail stays "tampered" and the clock stays advanced until you do).

## Optional 20-second add-on (if you have time, swap with the Reports step)
**Add complaint** → type *Sahyadri Govt Coll of Engg Poona*, choose *Public Grievance Cell*, category *Academic Quality*, paste a one-line description. Point at the **Live check** panel: it matched the misspelt name, lists what is already open at the institution, and shows **Potential Overlapping Cases** *before* you submit. Say: "New complaints get checked on the way in, not after the damage is done." Then open any case in an overlap and press **Escalate** to show **"Coordinate before acting"** (the guard). Remember to reset afterwards.

## Being honest about what is a prototype (say this once, near the end)
> "This is a prototype on synthetic data. In production it would connect to the Bureau systems and the AICTE master through connectors, use AICTE single sign-on instead of this role switcher, and send real email and SMS. The matching, SLA and audit logic you saw is the real logic."

| Judge asks about... | Honest answer |
|---|---|
| Is this AI? | "Explainable data-matching and NLP: fuzzy name matching and TF-IDF text similarity, with rules. We chose it on purpose: every flag must be defensible to an officer, and nothing leaves AICTE's network." |
| How accurate is it? | "Weights are hand-set and checked against labelled test pairs, including decoys that must *not* link: same name in another city, an old closed case, unrelated topics. 17 automated tests. Production would learn from officers' link/dismiss feedback." |
| Real data? Real login? | "Synthetic, all institutions are fictional. Roles are simulated; the server still enforces the permission matrix. Production: SSO plus the real AICTE institution master." |
| Tamper-**proof**? | "Tamper-*evident*. Someone with database admin rights could recompute the chain; production would anchor daily digests to an external store and add officer digital signatures." |
| Hindi complaints? | "English today. Future scope: multilingual embeddings (e.g. MuRIL/IndicBERT) on-premise." |
| Scale? | "Candidates are only compared within one institution, so cost grows per institution, not across the whole database. SQLite here; PostgreSQL in production." |
| Where do SLAs come from? | "Illustrative values in config (RB 30 days, PGRC 21 and so on); AICTE's prescribed timelines replace them." |
| Where does the data come from? | "Officials register complaints in the form or bulk-import a CSV; both run through the same matching pipeline. Production adds live connectors to the Bureau systems and CPGRAMS." |
| Does it stop duplicate action? | "It warns and logs: acting on an overlapping case needs an acknowledgement, and after a Coordination decision the follower Bureaus can't transfer or dispose, only the lead can." |
| Email/SMS alerts? | "In-app today. Delivery is future scope (NIC SMTP / SMS gateway)." |

## If something goes wrong
| Problem | Fix |
|---|---|
| Page won't load / blank | Check the terminal running `python run.py` is alive; reopen `http://127.0.0.1:8000`; if not, run `python run.py` again (about 5 s). |
| Numbers look wrong / earlier tamper or time machine still on | **Demo tools → Reset all demo data**. |
| Toast didn't appear after Simulate | Open the bell (alerts are already there) or go to **Coordination** → *Why flagged?* on any cluster; run *File a new complaint* again. |
| Live demo impossible (laptop dead) | Play the screen recording; second laptop has the bundle (`start_demo.bat`). |
| Browser shows an old page | Hard-refresh (Ctrl+F5). |

## Rehearsal checklist
- [ ] Run the 3-minute script **three times**, resetting in between. Time it.
- [ ] One person drives, one talks. Practise the role switch (role chip, top right) and the Demo tools without looking.
- [ ] Run once with **Wi-Fi off** (the app needs no internet).
- [ ] Run once on the **second laptop** from the bundle.
- [ ] Record a clean take as backup.
