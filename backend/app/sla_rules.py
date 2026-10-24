"""Configurable complaint SLAs with optional working-day/holiday calendars.

A rule is selected once at registration. cases.sla_* and due_date are snapshots:
editing the source rule never retroactively changes an existing complaint.
"""

from datetime import date, datetime, timedelta

from .constants import SLA_DAYS


def _date(value):
    """Accept a date, datetime, or ISO date/datetime string."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value[:10])
    raise ValueError(f"Expected a date or ISO date string, got {value!r}")


def _field(row, key, default=None):
    """Read either a dictionary or sqlite3.Row without relying on .get()."""
    try:
        value = row[key]
    except (KeyError, IndexError, TypeError):
        return default
    return default if value is None else value


def seed_defaults(conn):
    """Insert one wildcard/default rule per Bureau, preserving user edits."""
    conn.executemany(
        """INSERT OR IGNORE INTO sla_rules
           (bureau, category, days, warn_pct, use_working_days)
           VALUES (?, '*', ?, 75, 0)""",
        [(bureau, int(days)) for bureau, days in SLA_DAYS.items()],
    )


def rule_for(conn, bureau, category):
    """Match Bureau+category, then Bureau default, then legacy constants."""
    row = conn.execute(
        """SELECT id, bureau, category, days, warn_pct, use_working_days
           FROM sla_rules
           WHERE bureau=? AND category IN (?, '*')
           ORDER BY CASE WHEN category=? THEN 0 ELSE 1 END
           LIMIT 1""",
        (bureau, category, category),
    ).fetchone()
    if row is not None:
        return {
            "id": row["id"],
            "bureau": row["bureau"],
            "category": row["category"],
            "days": int(row["days"]),
            "warn_pct": int(row["warn_pct"]),
            "use_working_days": bool(row["use_working_days"]),
        }
    if bureau not in SLA_DAYS:
        raise ValueError(f"Unknown Bureau: {bureau}")
    return {
        "id": None,
        "bureau": bureau,
        "category": "*",
        "days": int(SLA_DAYS[bureau]),
        "warn_pct": 75,
        "use_working_days": False,
    }


def holiday_dates(conn):
    """Return a set of holiday date objects from the optional calendar."""
    return {
        _date(row[0])
        for row in conn.execute("SELECT date FROM holidays")
    }


def _working_day(day, holidays):
    return day.weekday() < 5 and day not in holidays


def elapsed_days(received, today, use_working_days=False, holidays=None):
    """Count elapsed SLA days in (received, today]; receipt is day zero."""
    start, end = _date(received), _date(today)
    if end <= start:
        return 0
    if not use_working_days:
        return (end - start).days
    excluded = {_date(x) for x in (holidays or ())}
    current = start
    count = 0
    while current < end:
        current += timedelta(days=1)
        if _working_day(current, excluded):
            count += 1
    return count


def due_date(received, rule, holidays=None):
    """Return the due date after `days` calendar/working days from receipt."""
    start = _date(received)
    days = int(_field(rule, "days"))
    if not 1 <= days <= 365:
        raise ValueError("SLA days must be between 1 and 365")
    if not bool(_field(rule, "use_working_days", False)):
        return start + timedelta(days=days)
    excluded = {_date(x) for x in (holidays or ())}
    current = start
    counted = 0
    while counted < days:
        current += timedelta(days=1)
        if _working_day(current, excluded):
            counted += 1
    return current


def case_progress(case, today, holidays=None):
    """Evaluate one case using its persisted SLA snapshot, not current rules."""
    days = int(_field(case, "sla_days", 1))
    days = max(1, days)
    warn_pct = int(_field(case, "sla_warn_pct", 75))
    working = bool(_field(case, "sla_use_working_days", False))
    age = elapsed_days(_field(case, "received_on"), today, working, holidays)
    remaining = days - age
    pct = 100.0 * age / days
    if _field(case, "status") == "Disposed":
        state = "CLOSED"
    elif pct >= 100:
        state = "BREACHED"
    elif pct >= warn_pct:
        state = "NEARING"
    else:
        state = "ON_TRACK"
    return {
        "days": days,
        "age_days": age,
        "remaining_days": remaining,
        "elapsed_pct": round(pct, 1),
        "warn_pct": warn_pct,
        "use_working_days": working,
        "state": state,
    }
