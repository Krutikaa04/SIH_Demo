"""Unit tests for simulated outbox, notification dispatch, and offline guarantee (Issue #17)."""
import socket
import pytest
from app import db, notify, sla


def test_simulated_notifier_renders_template_and_handles_missing_institution(conn):
    # Alert with case and institution
    case = db.one(conn, "SELECT case_id, institution_id, bureau_code, due_date FROM cases WHERE status!='Disposed' LIMIT 1")
    assert case is not None
    cur = conn.execute(
        "INSERT INTO alerts(type, severity, case_id, institution_id, message, created_at, link) "
        "VALUES('ESCALATION', 'HIGH', ?, ?, 'Prescribed timeline exceeded', '2026-10-24T10:00:00', ?)",
        (case["case_id"], case["institution_id"], f"/cases/{case['case_id']}"),
    )
    alert_id = cur.lastrowid
    conn.commit()
    alert = db.one(conn, "SELECT * FROM alerts WHERE id=?", (alert_id,))

    # Render email notification
    msg = notify.render_notification(conn, alert, channel="email")
    assert case["case_id"] in msg["subject"]
    assert case["case_id"] in msg["body"]
    assert case["bureau_code"] in msg["recipient_bureau"]
    assert "SIMULATED" in msg["body"]

    # Render SMS notification
    sms_msg = notify.render_notification(conn, alert, channel="sms")
    assert case["case_id"] in sms_msg["body"]
    assert "SIMULATED" in sms_msg["body"]

    # Alert without institution or case
    cur_orphan = conn.execute(
        "INSERT INTO alerts(type, severity, case_id, institution_id, message, created_at) "
        "VALUES('GENERAL', 'LOW', NULL, NULL, 'System maintenance window', '2026-10-24T10:00:00')"
    )
    orphan_id = cur_orphan.lastrowid
    conn.commit()
    orphan_alert = db.one(conn, "SELECT * FROM alerts WHERE id=?", (orphan_id,))
    orphan_msg = notify.render_notification(conn, orphan_alert, channel="email")
    assert "Unspecified Institution" in orphan_msg["body"]
    assert "System maintenance window" in orphan_msg["subject"]


def test_notify_endpoint_permissions_and_validation(client, as_role, conn):
    # Find an RB case and create an alert for it
    case = db.one(conn, "SELECT case_id, institution_id, bureau_code FROM cases WHERE bureau_code='RB' LIMIT 1")
    assert case is not None
    cur = conn.execute(
        "INSERT INTO alerts(type, severity, case_id, institution_id, message, created_at) "
        "VALUES('ESCALATION', 'HIGH', ?, ?, 'Escalated to Director', '2026-10-24T10:00:00')",
        (case["case_id"], case["institution_id"]),
    )
    aid = cur.lastrowid
    conn.commit()

    # 1. Senior role can dispatch reminder
    res_senior = client.post(f"/api/alerts/{aid}/notify", json={"channel": "email"}, headers=as_role("SENIOR"))
    assert res_senior.status_code == 200
    data = res_senior.json()
    assert data["status"] == "SIMULATED"
    assert data["channel"] == "email"
    assert data["alert_id"] == aid

    # 2. RB bureau officer can dispatch for their own RB case
    res_rb = client.post(f"/api/alerts/{aid}/notify", json={"channel": "sms"}, headers=as_role("RB"))
    assert res_rb.status_code == 200
    assert res_rb.json()["channel"] == "sms"

    # 3. Non-involved Bureau (PGRC) cannot dispatch for an RB case (403)
    res_pgrc = client.post(f"/api/alerts/{aid}/notify", json={"channel": "email"}, headers=as_role("PGRC"))
    assert res_pgrc.status_code == 403

    # 4. Regional role is strictly forbidden from dispatching (403)
    res_reg = client.post(f"/api/alerts/{aid}/notify", json={"channel": "email"}, headers=as_role("REGIONAL", "Western"))
    assert res_reg.status_code == 403

    # 5. Invalid channel returns 400
    res_bad_channel = client.post(f"/api/alerts/{aid}/notify", json={"channel": "telegram"}, headers=as_role("SENIOR"))
    assert res_bad_channel.status_code == 400

    # 6. Unknown alert returns 404
    res_404 = client.post("/api/alerts/999999/notify", json={"channel": "email"}, headers=as_role("SENIOR"))
    assert res_404.status_code == 404


def test_preview_endpoint(client, as_role, conn):
    cur = conn.execute(
        "INSERT INTO alerts(type, severity, case_id, institution_id, message, created_at) "
        "VALUES('SLA_NEAR', 'MEDIUM', NULL, NULL, 'Notice regarding timelines', '2026-10-24T10:00:00')"
    )
    aid = cur.lastrowid
    conn.commit()

    res = client.get(f"/api/alerts/{aid}/notify/preview?channel=email", headers=as_role("SENIOR"))
    assert res.status_code == 200
    preview = res.json()
    assert preview["is_simulated"] is True
    assert preview["channel"] == "email"
    assert "subject" in preview
    assert "body" in preview

    # Regional role cannot preview (403)
    res_reg = client.get(f"/api/alerts/{aid}/notify/preview", headers=as_role("REGIONAL", "Northern"))
    assert res_reg.status_code == 403


def test_get_outbox_endpoint(client, as_role, conn):
    # Ensure there are some outbox records
    conn.execute(
        "INSERT INTO outbox (alert_id, channel, recipient_role, recipient_bureau, subject, body, status, created_by, created_at) "
        "VALUES (1, 'email', 'Bureau Officer', 'RB', 'Test Subject', 'Test Body', 'SIMULATED', 'Tester', '2026-10-24T10:00:00')"
    )
    conn.execute(
        "INSERT INTO outbox (alert_id, channel, recipient_role, recipient_bureau, subject, body, status, created_by, created_at) "
        "VALUES (1, 'sms', 'Bureau Officer', 'RB', 'Test SMS', 'Test SMS Body', 'SIMULATED', 'Tester', '2026-10-24T10:01:00')"
    )
    conn.commit()

    # List all
    res = client.get("/api/outbox", headers=as_role("SENIOR"))
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) >= 2

    # Filter by channel
    res_sms = client.get("/api/outbox?channel=sms", headers=as_role("SENIOR"))
    assert res_sms.status_code == 200
    for it in res_sms.json()["items"]:
        assert it["channel"] == "sms"


def test_sla_auto_notify_queues_simulated_notification(conn):
    initial_count = conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]

    case = db.one(conn, "SELECT case_id, received_on, sla_days FROM cases WHERE status!='Disposed' LIMIT 1")
    assert case is not None

    sla._alert(conn, "ESCALATION", "HIGH", f"{case['case_id']} auto-escalated to Deputy Director",
               case_id=case["case_id"], inst=None, auto_notify=True)
    conn.commit()

    new_count = conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
    assert new_count == initial_count + 1

    last_outbox = db.one(conn, "SELECT * FROM outbox ORDER BY id DESC LIMIT 1")
    assert last_outbox["status"] == "SIMULATED"
    assert case["case_id"] in last_outbox["subject"]
    assert "ESCALATION" in last_outbox["subject"]


def test_no_outbound_network_calls_during_dispatch(monkeypatch, client, as_role, conn):
    # Monkeypatch socket to raise if any network connect is attempted
    def blocked_connect(*args, **kwargs):
        raise RuntimeError("Blocked! Network call attempted in offline test.")

    monkeypatch.setattr(socket.socket, "connect", blocked_connect)

    cur = conn.execute(
        "INSERT INTO alerts(type, severity, case_id, institution_id, message, created_at) "
        "VALUES('ESCALATION', 'HIGH', NULL, NULL, 'Offline test escalation', '2026-10-24T10:00:00')"
    )
    aid = cur.lastrowid
    conn.commit()

    # Must succeed without invoking socket connect
    res = client.post(f"/api/alerts/{aid}/notify", json={"channel": "email"}, headers=as_role("SENIOR"))
    assert res.status_code == 200
    assert res.json()["status"] == "SIMULATED"
