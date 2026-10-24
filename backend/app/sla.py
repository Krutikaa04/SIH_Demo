
"""SLA engine: nearing-timeline warnings, auto-escalation, ping-pong
detection, and pending-reminder digests.

Idempotent: each threshold is stamped on the case
(warned_at / breached_at / severe_at / pingpong_at),
so ticking repeatedly never raises the same alert twice.

Uses the demo clock (time machine).

Issue #19:
- Supports calendar-day and working-day SLA rules.
- Excludes weekends and configured holidays for working-day SLAs.
- Uses the SLA settings stored on each case.
- Supports configurable warning thresholds.
- Preserves escalation thresholds at 100% and 150%.
- Existing cases retain their original SLA settings.
"""

from datetime import timedelta

from . import db, events, sla_rules
from .constants import BUREAU_ORDER


# Default threshold values.
# Individual cases can override WARN through sla_warn_pct.
WARN = 0.75
BREACH = 1.0
SEVERE = 1.5

REMINDER_DAYS = 10


def _alert(
    conn,
    type_,
    severity,
    message,
    case_id=None,
    inst=None,
    created_at=None,
    link=None,
):
    """Create an alert in the alerts table."""

    conn.execute(
        """
        INSERT INTO alerts(
            type,
            severity,
            case_id,
            institution_id,
            message,
            created_at,
            is_read,
            link
        )
        VALUES(?,?,?,?,?,?,0,?)
        """,
        (
            type_,
            severity,
            case_id,
            inst,
            message,
            created_at,
            link,
        ),
    )


def _officers(conn):
    """Build a Bureau-wise lookup of officers by level."""

    out = {}

    for officer in db.rows(
        conn,
        "SELECT * FROM officers ORDER BY level",
    ):
        out.setdefault(
            officer["bureau_code"], {}
        )[officer["level"]] = officer

    return out


def _escalate(conn, c, level, officers, stamp):
    """
    Auto-escalate a case.

    Level 1 = Deputy Director
    Level 2 = Director / Competent Authority

    Escalation always uses the SLA duration originally
    stored on the case, not the latest Bureau rule.
    """

    boss = officers[c["bureau_code"]][2 + level]

    who = f"{boss['name']} ({boss['designation']})"

    day_type = (
        "working days"
        if c.get("sla_use_working_days", 0)
        else "calendar days"
    )

    if level == 2:
        remark = (
            "Timeline exceeded by more than 50%; "
            f"auto-escalated to {who}, Competent Authority"
        )
    else:
        remark = (
            f"Prescribed timeline of {c['sla_days']} "
            f"{day_type} exceeded; auto-escalated to {who}"
        )

    db.append_action(
        conn,
        c["case_id"],
        stamp,
        "SYS",
        "System (SLA engine)",
        c["bureau_code"],
        "AUTO_ESCALATE",
        c["bureau_code"],
        c["bureau_code"],
        remark,
    )

    conn.execute(
        """
        UPDATE cases
        SET status='Escalated',
            escalation_level=?,
            assigned_officer_id=?,
            last_action=?,
            last_action_at=?,
            next_action=?
        WHERE case_id=?
        """,
        (
            level,
            boss["id"],
            f"Auto-escalated to {boss['designation']}",
            stamp,
            (
                "Competent Authority to review and issue directions"
                if level == 2
                else "Deputy Director to review and issue directions"
            ),
            c["case_id"],
        ),
    )

    c["escalation_level"] = level

    return boss["designation"]


def _case_sla_progress(c, today, holidays):
    """
    Calculate SLA progress using the case's stored SLA settings.

    Calendar-day cases:
        Every calendar day counts.

    Working-day cases:
        Saturdays, Sundays, and configured holidays are skipped.

    The same calculation is used by tick() and init_state()
    to ensure consistent threshold behavior.
    """

    return sla_rules.case_progress(
        c,
        today,
        holidays,
    )


def tick(conn, notify=True):
    """
    Run the SLA monitoring engine.

    Evaluates open cases against their prescribed timelines.

    Warning:
        Case-specific percentage (default 75%).

    Breach:
        100% elapsed.

    Severe breach:
        150% elapsed.

    Each threshold is processed only once per case.

    The demo clock is used so that simulated date changes
    trigger the same calculations as real time.
    """

    now_dt = db.now(conn)
    today = now_dt.date()
    stamp = db.iso(now_dt)

    # Read the optional holiday calendar once per engine cycle.
    holidays = sla_rules.holiday_dates(conn)

    officers = _officers(conn)

    summary = {
        "near": 0,
        "escalated": 0,
        "severe": 0,
        "pingpong": 0,
        "reminders": 0,
        "cases": [],
    }

    nears = []
    escs = []

    cases = db.rows(
        conn,
        "SELECT * FROM cases WHERE status!='Disposed'",
    )

    for c in cases:

        # Use the SLA snapshot stored on this individual case.
        progress = _case_sla_progress(
            c,
            today,
            holidays,
        )

        # Keep the internal threshold values as ratios.
        # Avoid using the rounded display percentage.
        age = progress["age_days"]
        days = progress["days"]

        pct = age / days

        warn_threshold = progress["warn_pct"] / 100

        sets = {}

        # --------------------------------------------------
        # Warning threshold
        # --------------------------------------------------

        if pct >= warn_threshold and not c["warned_at"]:

            sets["warned_at"] = stamp

            # Only show a nearing alert if the case has
            # not already reached the breach threshold.
            if pct < BREACH:

                nears.append(c)
                summary["near"] += 1

        # --------------------------------------------------
        # 100% SLA breach
        # --------------------------------------------------

        if pct >= BREACH and not c["breached_at"]:

            sets["breached_at"] = stamp

            if c["escalation_level"] < 1:

                designation = _escalate(
                    conn,
                    c,
                    1,
                    officers,
                    stamp,
                )

                escs.append((c, designation))

                summary["escalated"] += 1
                summary["cases"].append(c["case_id"])

        # --------------------------------------------------
        # 150% severe SLA breach
        # --------------------------------------------------

        if pct >= SEVERE and not c["severe_at"]:

            sets["severe_at"] = stamp

            if c["escalation_level"] < 2:

                designation = _escalate(
                    conn,
                    c,
                    2,
                    officers,
                    stamp,
                )

                escs.append((c, designation))

                summary["severe"] += 1
                summary["cases"].append(c["case_id"])

        # --------------------------------------------------
        # Ping-pong transfer detection
        # --------------------------------------------------

        if (
            c["transfer_count"] >= 3
            and not c["pingpong_at"]
        ):

            sets["pingpong_at"] = stamp

            _alert(
                conn,
                "PING_PONG",
                "MEDIUM",
                (
                    f"{c['case_id']} has been transferred "
                    f"{c['transfer_count']} times — possible "
                    "ping-pong; fix ownership"
                ),
                c["case_id"],
                c["institution_id"],
                stamp,
            )

            summary["pingpong"] += 1

        # --------------------------------------------------
        # Persist threshold stamps
        # --------------------------------------------------

        if sets:

            conn.execute(
                "UPDATE cases SET "
                + ",".join(f"{key}=?" for key in sets)
                + " WHERE case_id=?",
                (
                    *sets.values(),
                    c["case_id"],
                ),
            )

    # ------------------------------------------------------
    # Nearing timeline alerts
    # ------------------------------------------------------

    # A few events create individual alerts.
    # A burst creates a single digest to keep the feed readable.

    if len(nears) <= 4:

        for c in nears:

            _alert(
                conn,
                "SLA_NEAR",
                "MEDIUM",
                (
                    f"{c['case_id']} is nearing its "
                    f"timeline (due {c['due_date']})"
                ),
                c["case_id"],
                c["institution_id"],
                stamp,
            )

    elif nears:

        _alert(
            conn,
            "SLA_NEAR",
            "MEDIUM",
            (
                f"{len(nears)} cases are now nearing "
                "their prescribed timeline"
            ),
            created_at=stamp,
            link="/cases?status=Pending",
        )

    # ------------------------------------------------------
    # Escalation alerts
    # ------------------------------------------------------

    if len(escs) <= 4:

        for c, designation in escs:

            _alert(
                conn,
                "ESCALATION",
                "HIGH",
                (
                    f"{c['case_id']} auto-escalated to "
                    f"{designation} — timeline exceeded"
                ),
                c["case_id"],
                c["institution_id"],
                stamp,
            )

    elif escs:

        _alert(
            conn,
            "ESCALATION",
            "HIGH",
            (
                f"{len(escs)} cases auto-escalated — "
                "prescribed timeline exceeded"
            ),
            created_at=stamp,
            link="/cases?status=Escalated",
        )

    # ------------------------------------------------------
    # Pending reminder digest
    # ------------------------------------------------------

    summary["reminders"] = reminder_digest(
        conn,
        now_dt,
    )

    conn.commit()

    # ------------------------------------------------------
    # Publish real-time notifications
    # ------------------------------------------------------

    if notify and (
        summary["escalated"]
        or summary["severe"]
        or summary["near"]
        or summary["reminders"]
    ):

        events.publish(
            "sla.escalated",
            {
                k: v
                for k, v in summary.items()
                if k != "cases"
            }
            | {
                "cases": summary["cases"][:5]
            },
        )

        events.publish(
            "dashboard.invalidate",
            {},
        )

    return summary


def reminder_digest(conn, now_dt):
    """
    One digest alert per Bureau per demo day.

    Detects pending cases that have had no recent action
    for REMINDER_DAYS calendar days.

    This is an inactivity reminder, not a prescribed SLA
    threshold, so it deliberately remains calendar-based.
    """

    day = str(now_dt.date())

    if db.get_setting(conn, "reminder_day") == day:
        return 0

    cutoff = db.iso(
        now_dt - timedelta(days=REMINDER_DAYS)
    )

    made = 0

    for bureau in BUREAU_ORDER:

        n = conn.execute(
            """
            SELECT COUNT(*)
            FROM cases
            WHERE bureau_code=?
              AND status!='Disposed'
              AND last_action_at<?
            """,
            (
                bureau,
                cutoff,
            ),
        ).fetchone()[0]

        if n:

            _alert(
                conn,
                "PENDING_REMINDER",
                "MEDIUM",
                (
                    f"{bureau}: {n} pending "
                    f"case{'s' if n != 1 else ''} "
                    f"with no action for "
                    f"{REMINDER_DAYS}+ days"
                ),
                created_at=db.iso(now_dt),
                link=(
                    f"/cases?bureau={bureau}"
                    "&status=Pending"
                ),
            )

            made += 1

    db.set_setting(
        conn,
        "reminder_day",
        day,
    )

    return made


def init_state(conn):
    """
    Initialize SLA threshold stamps after seeding.

    Cases that have already crossed a threshold are stamped
    immediately so subsequent engine ticks only react to
    NEW threshold crossings.

    Uses the exact same calendar/working-day calculations
    as the regular SLA engine.
    """

    now_dt = db.now(conn)
    today = now_dt.date()
    stamp = db.iso(now_dt)

    # Load the optional holiday calendar once.
    holidays = sla_rules.holiday_dates(conn)

    cases = db.rows(
        conn,
        """
        SELECT
            case_id,
            received_on,
            sla_days,
            sla_use_working_days,
            sla_warn_pct,
            transfer_count,
            status
        FROM cases
        WHERE status!='Disposed'
        """,
    )

    for c in cases:

        progress = _case_sla_progress(
            c,
            today,
            holidays,
        )

        pct = (
            progress["age_days"]
            / progress["days"]
        )

        warn_threshold = (
            progress["warn_pct"]
            / 100
        )

        sets = {}

        # Stamp warning threshold.
        if pct >= warn_threshold:
            sets["warned_at"] = stamp

        # Stamp 100% breach threshold.
        if pct >= BREACH:
            sets["breached_at"] = stamp

        # Stamp 150% severe threshold.
        if pct >= SEVERE:
            sets["severe_at"] = stamp

        # Stamp previously detected ping-pong transfers.
        if c["transfer_count"] >= 3:
            sets["pingpong_at"] = stamp

        if sets:

            conn.execute(
                "UPDATE cases SET "
                + ",".join(f"{key}=?" for key in sets)
                + " WHERE case_id=?",
                (
                    *sets.values(),
                    c["case_id"],
                ),
            )

        # Preserve seeded ping-pong alert behaviour.
        if c["transfer_count"] >= 3:

            _alert(
                conn,
                "PING_PONG",
                "MEDIUM",
                (
                    f"{c['case_id']} has been transferred "
                    f"{c['transfer_count']} times — possible "
                    "ping-pong; fix ownership"
                ),
                c["case_id"],
                None,
                db.iso(
                    now_dt - timedelta(hours=11)
                ),
            )

    reminder_digest(
        conn,
        now_dt,
    )
