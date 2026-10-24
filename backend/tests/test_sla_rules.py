"""Regression tests for configurable SLA rules (Issue #19).

Run from the repository root:
    python -m pytest backend/tests/test_sla_rules.py -q
"""

import sqlite3
from datetime import date

import pytest

from backend.app import sla_rules
from backend.app.constants import SLA_DAYS


@pytest.fixture
def rule_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE sla_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bureau TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '*',
            days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 365),
            warn_pct INTEGER NOT NULL DEFAULT 75 CHECK(warn_pct BETWEEN 1 AND 99),
            use_working_days INTEGER NOT NULL DEFAULT 0,
            UNIQUE(bureau, category)
        );
        CREATE TABLE holidays (
            date TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
        """
    )
    yield conn
    conn.close()


def test_seed_defaults_populates_each_bureau_without_duplicates(rule_conn):
    sla_rules.seed_defaults(rule_conn)
    sla_rules.seed_defaults(rule_conn)
    rows = rule_conn.execute("SELECT bureau, days, category FROM sla_rules").fetchall()
    assert len(rows) == len(SLA_DAYS)
    assert {r["bureau"]: r["days"] for r in rows} == SLA_DAYS
    assert all(r["category"] == "*" for r in rows)


def test_rule_priority_exact_then_default(rule_conn):
    sla_rules.seed_defaults(rule_conn)
    rule_conn.execute(
        "INSERT INTO sla_rules(bureau,category,days,warn_pct,use_working_days) "
        "VALUES ('RB','Fees',9,60,1)"
    )
    exact = sla_rules.rule_for(rule_conn, "RB", "Fees")
    default = sla_rules.rule_for(rule_conn, "RB", "Unrelated")
    assert (exact["days"], exact["warn_pct"], exact["use_working_days"]) == (9, 60, True)
    assert default["category"] == "*"
    assert default["days"] == SLA_DAYS["RB"]


def test_rule_fallback_and_unknown_bureau(rule_conn):
    assert sla_rules.rule_for(rule_conn, "RB", "Any")["days"] == SLA_DAYS["RB"]
    with pytest.raises(ValueError, match="Unknown Bureau"):
        sla_rules.rule_for(rule_conn, "UNKNOWN", "Any")


def test_calendar_day_due_date_counts_weekends():
    rule = {"days": 3, "use_working_days": False}
    assert sla_rules.due_date("2026-10-23", rule) == date(2026, 10, 26)
    assert sla_rules.elapsed_days("2026-10-23", "2026-10-26") == 3


def test_working_days_skip_weekends_and_holidays(rule_conn):
    rule_conn.execute("INSERT INTO holidays(date,name) VALUES('2026-10-26','Test holiday')")
    holidays = sla_rules.holiday_dates(rule_conn)
    assert holidays == {date(2026, 10, 26)}
    rule = {"days": 2, "use_working_days": True}
    # Fri Oct 23 -> skip Sat/Sun and Monday holiday -> Tue + Wed.
    assert sla_rules.due_date("2026-10-23", rule, holidays) == date(2026, 10, 28)
    assert sla_rules.elapsed_days("2026-10-23", "2026-10-28", True, holidays) == 2
    assert sla_rules.elapsed_days("2026-10-23", "2026-10-26", True, holidays) == 0


def test_warning_threshold_and_breach_states():
    case = {
        "received_on": "2026-10-01", "sla_days": 10,
        "sla_warn_pct": 60, "sla_use_working_days": 0,
        "status": "Under Process",
    }
    assert sla_rules.case_progress(case, "2026-10-06")["state"] == "ON_TRACK"
    near = sla_rules.case_progress(case, "2026-10-07")
    assert near["state"] == "NEARING"
    assert near["age_days"] == 6
    assert near["warn_pct"] == 60
    breached = sla_rules.case_progress(case, "2026-10-11")
    assert breached["state"] == "BREACHED"
    assert breached["elapsed_pct"] == 100.0
    assert breached["remaining_days"] == 0


def test_disposed_case_is_closed_even_past_due():
    case = {
        "received_on": "2026-09-01", "sla_days": 5,
        "sla_warn_pct": 75, "sla_use_working_days": 0,
        "status": "Disposed",
    }
    assert sla_rules.case_progress(case, "2026-10-24")["state"] == "CLOSED"


def test_case_snapshot_does_not_change_when_rule_is_edited(rule_conn):
    sla_rules.seed_defaults(rule_conn)
    old_rule = sla_rules.rule_for(rule_conn, "RB", "Fees")
    case = {
        "received_on": "2026-10-01",
        "sla_days": old_rule["days"],
        "sla_warn_pct": old_rule["warn_pct"],
        "sla_use_working_days": int(old_rule["use_working_days"]),
        "status": "Under Process",
    }
    old_progress = sla_rules.case_progress(case, "2026-10-10")
    rule_conn.execute(
        "UPDATE sla_rules SET days=7,warn_pct=50,use_working_days=1 "
        "WHERE bureau='RB' AND category='*'"
    )
    assert sla_rules.rule_for(rule_conn, "RB", "Fees")["days"] == 7
    assert sla_rules.case_progress(case, "2026-10-10") == old_progress


def test_before_receipt_date_elapsed_days_is_zero():
    assert sla_rules.elapsed_days("2026-10-24", "2026-10-20", True) == 0
    assert sla_rules.elapsed_days("2026-10-24", "2026-10-24") == 0


def test_invalid_sla_length_rejected():
    with pytest.raises(ValueError, match="between 1 and 365"):
        sla_rules.due_date("2026-10-24", {"days": 0, "use_working_days": False})
