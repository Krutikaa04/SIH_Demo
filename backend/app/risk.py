"""Institution risk score (0-100): volume + severity + repeat offences + overdue cases. Transparent formula."""
from datetime import datetime

from . import db

BANDS = ((70, "HIGH"), (40, "MEDIUM"), (0, "LOW"))


def band_of(score):
    return next(b for t, b in BANDS if score >= t)


def compute_all(conn, today=None):
    today = today or db.now(conn).date()
    by = {}
    for r in db.rows(conn, "SELECT institution_id,category,severity,status,received_on,due_date FROM cases"):
        by.setdefault(r["institution_id"], []).append(r)
    out = {}
    for inst, cases in by.items():
        recent = [c for c in cases if (today - datetime.strptime(c["received_on"], "%Y-%m-%d").date()).days <= 365]
        volume = min(30, 5 * len(recent))
        wsum = sum(2 if c["status"] != "Disposed" else 1 for c in cases)
        mean = sum((2 if c["status"] != "Disposed" else 1) * c["severity"] for c in cases) / wsum
        sev = round(30 * mean / 5, 1)
        cats = {}
        for c in cases:
            cats[c["category"]] = cats.get(c["category"], 0) + 1
        repeats = [k for k, v in cats.items() if v >= 2]
        repeat = min(20, 10 * len(repeats))
        overdue_n = sum(1 for c in cases if c["status"] != "Disposed" and c["due_date"] < str(today))
        overdue = min(20, 5 * overdue_n)
        score = round(volume + sev + repeat + overdue)
        out[inst] = {"score": score, "band": band_of(score), "breakdown": [
            {"signal": "volume", "label": "Complaint volume", "points": volume, "max": 30,
             "detail": f"{len(recent)} complaint{'s' if len(recent) != 1 else ''} in the last 12 months"},
            {"signal": "severity", "label": "Severity", "points": sev, "max": 30,
             "detail": f"weighted mean severity {mean:.1f} / 5 (open cases count double)"},
            {"signal": "repeat", "label": "Repeat offences", "points": repeat, "max": 20,
             "detail": (f"repeated: {', '.join(repeats[:2])}" if repeats else "no repeated category")},
            {"signal": "overdue", "label": "Overdue cases", "points": overdue, "max": 20,
             "detail": f"{overdue_n} open case{'s' if overdue_n != 1 else ''} beyond timeline"},
        ]}
    return out
