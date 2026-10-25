# Prototype demo and recording

Use the [recording runbook](docs/RECORDING_RUNBOOK.md) for the current four-minute
story, preparation commands, evidence clips, honest answers and recovery steps.
Follow the [merge sequence](docs/MERGE_SEQUENCE.md) to assemble the same feature
set before building.

From the repository root, start a new take:

```sh
AICTE_DB=data/recording-take-01.db .venv/bin/python run.py --no-browser
```

In a second terminal:

```sh
.venv/bin/python scripts/check_recording.py --innovation --demo-login
```

Open **http://127.0.0.1:8000** and sign in as **Senior Management**. Use an unused
database filename for a fresh take. Build the checked-out frontend first; the
runbook includes the commands.

The spine is **notice → explain → coordinate → follow through → measure**.
Data is synthetic. Scores/risk are review aids, aftercare is a chronological
signal, published demo accounts use real local sessions, and recorded decisions are distinct from disposal
or measured time savings.

`scripts/smoke_test.py` mutates and resets its target. Use it only for a disposable
rehearsal instance, not for a take to preserve.
