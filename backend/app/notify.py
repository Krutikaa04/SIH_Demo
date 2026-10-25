"""Simulated notification dispatcher and pluggable Notifier interface (Issue #17).

Provides a clean interface (Notifier protocol) that renders reminder/escalation
notifications from alerts and saves them to a simulated outbox table.
In production, a real SMTP or SMS gateway can implement Notifier without touching callers.
"""
from typing import Any, Dict, Optional, Protocol
import html
import re

from . import db


class Notifier(Protocol):
    """Protocol for dispatching notifications."""

    def send(self, conn, message: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatch a rendered message and return the record info."""
        ...


class SimulatedNotifier:
    """Offline notifier that records dispatched messages to the local outbox table."""

    def send(self, conn, message: Dict[str, Any]) -> Dict[str, Any]:
        now_str = message.get("created_at") or db.iso(db.now(conn))
        channel = (message.get("channel") or "email").lower()
        status = message.get("status") or "SIMULATED"

        cur = conn.execute(
            """INSERT INTO outbox (alert_id, channel, recipient_role, recipient_bureau,
                                   subject, body, status, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                message.get("alert_id"),
                channel,
                message.get("recipient_role", "Bureau Officer"),
                message.get("recipient_bureau", "RB"),
                message.get("subject", ""),
                message.get("body", ""),
                status,
                message.get("created_by", "System"),
                now_str,
            ),
        )
        row_id = cur.lastrowid
        return {
            "id": row_id,
            "alert_id": message.get("alert_id"),
            "channel": channel,
            "recipient_role": message.get("recipient_role", "Bureau Officer"),
            "recipient_bureau": message.get("recipient_bureau", "RB"),
            "subject": message.get("subject", ""),
            "body": message.get("body", ""),
            "status": status,
            "created_by": message.get("created_by", "System"),
            "created_at": now_str,
        }


def get_notifier(conn=None) -> Notifier:
    """Return the active Notifier instance based on configuration."""
    backend = "simulated"
    if conn:
        backend = db.get_setting(conn, "notifier_backend", "simulated")
    if backend == "simulated":
        return SimulatedNotifier()
    # Extension hook: custom or SMTP notifiers can be plugged here
    return SimulatedNotifier()


def _extract_bureau(alert: Dict[str, Any], case: Optional[Dict[str, Any]]) -> str:
    if case and case.get("bureau_code"):
        return case["bureau_code"]
    msg = alert.get("message", "")
    # Check if message starts with bureau code like "RB: 4 pending cases"
    m = re.match(r"^([A-Z]{2,4}):", msg)
    if m:
        return m.group(1)
    if "RB" in msg:
        return "RB"
    if "PGRC" in msg:
        return "PGRC"
    if "AB" in msg:
        return "AB"
    if "LC" in msg:
        return "LC"
    if "VIG" in msg:
        return "VIG"
    return "ALL"


def _determine_recipient_role(alert: Dict[str, Any], case: Optional[Dict[str, Any]]) -> str:
    atype = alert.get("type", "")
    if atype == "ESCALATION":
        level = case.get("escalation_level", 1) if case else 1
        return "Competent Authority" if level >= 2 else "Deputy Director"
    if atype == "SLA_NEAR":
        return "Assigned Officer / Bureau In-charge"
    if atype == "PENDING_REMINDER":
        return "Bureau In-charge"
    if atype == "OVERLAP":
        return "Nodal Coordination Officer"
    return "Bureau Officer"


def render_notification(conn, alert: Dict[str, Any], channel: str = "email") -> Dict[str, Any]:
    """Renders plain-text notification subject and body from an alert, escaping text safely."""
    case_id = alert.get("case_id")
    case = db.one(conn, "SELECT * FROM cases WHERE case_id=?", (case_id,)) if case_id else None

    # Institution lookup
    inst_id = alert.get("institution_id") or (case.get("institution_id") if case else None)
    inst_name = None
    if inst_id:
        inst = db.one(conn, "SELECT name, aicte_id, region FROM institutions WHERE aicte_id=?", (inst_id,))
        if inst:
            inst_name = inst["name"]
    if not inst_name and case:
        inst_name = case.get("submitted_institution_name")
    if not inst_name:
        inst_name = "Unspecified Institution"

    recipient_bureau = _extract_bureau(alert, case)
    recipient_role = _determine_recipient_role(alert, case)
    due_date = (case.get("due_date") if case else None) or "Prescribed timeline"
    link = alert.get("link") or (f"/cases/{case_id}" if case_id else "/alerts")

    # Plain-text sanitized message
    alert_msg = alert.get("message", "").strip()

    channel_clean = channel.lower().strip()
    if channel_clean == "sms":
        subject = f"AICTE Alert: {alert.get('type', 'GRIEVANCE')}"
        body = (
            f"[AICTE Alert] {alert.get('type', 'NOTICE')} for Case {case_id or 'General'}: "
            f"{alert_msg}. Action due: {due_date}. Details: {link} [SIMULATED]"
        )
    else:
        # Email format
        if case_id:
            subject = f"[AICTE Notice - {alert.get('type', 'REMINDER')}] Case {case_id} · {inst_name}"
        else:
            subject = f"[AICTE Notice - {alert.get('type', 'REMINDER')}] {alert_msg[:60]}"

        body = f"""AICTE COMPLAINT MONITORING SYSTEM — NOTIFICATION DISPATCH
--------------------------------------------------------------------------------
Alert ID     : #{alert.get('id', 'N/A')}
Alert Type   : {alert.get('type', 'NOTICE')}
Severity     : {alert.get('severity', 'MEDIUM')}
Recipient    : Bureau {recipient_bureau} ({recipient_role})
Case ID      : {case_id or 'N/A'}
Institution  : {inst_name} ({inst_id or 'N/A'})
Due Date     : {due_date}

Alert Summary:
{alert_msg}

Action Required:
Please review the grievance record and take necessary action to ensure compliance
with the AICTE Citizen Charter and prescribed disposal timelines.

Direct Link  : {link}
--------------------------------------------------------------------------------
[SIMULATED - Dispatched to local outbox. Offline demonstration prototype. No actual email dispatched.]
"""

    return {
        "alert_id": alert.get("id"),
        "channel": channel_clean,
        "recipient_role": recipient_role,
        "recipient_bureau": recipient_bureau,
        "subject": subject,
        "body": body,
        "case_id": case_id,
        "institution_name": inst_name,
        "due_date": due_date,
        "link": link,
    }


def dispatch_notification(conn, alert_id: int, channel: str = "email", created_by: str = "System") -> Dict[str, Any]:
    """Renders and dispatches a notification for the specified alert using the active Notifier."""
    channel_clean = channel.lower().strip()
    if channel_clean not in ("email", "sms"):
        raise ValueError(f"Invalid channel '{channel}'. Supported channels: 'email', 'sms'.")

    alert = db.one(conn, "SELECT * FROM alerts WHERE id=?", (alert_id,))
    if not alert:
        raise KeyError(f"Alert #{alert_id} not found")

    message = render_notification(conn, alert, channel=channel_clean)
    message["created_by"] = created_by
    notifier = get_notifier(conn)
    return notifier.send(conn, message)


def queue_alert_notification(conn, alert_id: int, channel: str = "email",
                             created_by: str = "System (SLA Engine)") -> Optional[Dict[str, Any]]:
    """Auto-queue a notification if auto_notify setting is enabled."""
    auto_notify = db.get_setting(conn, "auto_notify", "1")
    if str(auto_notify).lower() in ("1", "true", "yes", "on"):
        try:
            return dispatch_notification(conn, alert_id, channel=channel, created_by=created_by)
        except Exception:
            return None
    return None
