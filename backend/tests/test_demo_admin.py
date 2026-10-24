"""Demo mutations must be explicitly enabled and explicitly Senior-authorized."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest

from app import db

ENDPOINTS = [
    "/api/admin/reset", "/api/admin/clock", "/api/admin/tamper",
    "/api/admin/restore-tamper", "/api/simulate/complaint",
]


@pytest.mark.parametrize("mode", [None, "0", "false"])
@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_demo_controls_are_hidden_by_default(client, conn, as_role, monkeypatch, mode, endpoint):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    if mode is not None:
        monkeypatch.setenv("DEMO_MODE", mode)
    before = db.verify_chain(conn)
    response = client.post(endpoint, headers=as_role("SENIOR"), json={})
    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}
    assert db.verify_chain(conn) == before


@pytest.mark.parametrize("role", ["RB", "PGRC", "AB", "LC", "VIG", "REGIONAL", "INVALID", None])
@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_only_explicit_senior_role_can_mutate(client, conn, as_role, monkeypatch, role, endpoint):
    monkeypatch.setenv("DEMO_MODE", "1")
    before = db.verify_chain(conn)
    headers = as_role(role, "Western") if role else {}
    response = client.post(endpoint, headers=headers, json={})
    assert response.status_code == 403
    assert "detail" in response.json()
    assert db.verify_chain(conn) == before


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_enabled_controls_work_for_senior(client, as_role, monkeypatch, endpoint):
    monkeypatch.setenv("DEMO_MODE", "1")
    response = client.post(endpoint, headers=as_role("SENIOR"), json={"add_days": 7})
    assert response.status_code == 200


@pytest.mark.parametrize("enabled", [False, True])
def test_meta_reports_demo_mode_and_audit_verify_remains_available(client, monkeypatch, enabled):
    monkeypatch.setenv("DEMO_MODE", "1" if enabled else "0")
    assert client.get("/api/meta").json()["demo_mode"] is enabled
    assert client.get("/api/audit/verify").status_code == 200


@pytest.mark.parametrize("configured,expected", [(None, "1"), ("0", "0"), ("1", "1")])
def test_launcher_defaults_to_demo_but_respects_explicit_configuration(monkeypatch, configured, expected):
    spec = importlib.util.spec_from_file_location("demo_launcher", Path(__file__).resolve().parents[2] / "run.py")
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    monkeypatch.delenv("DEMO_MODE", raising=False)
    if configured is not None:
        monkeypatch.setenv("DEMO_MODE", configured)
    monkeypatch.setattr("sys.argv", ["run.py", "--no-browser"])
    server = Mock()
    monkeypatch.setattr("uvicorn.run", server)
    launcher.main()
    import os
    assert os.environ["DEMO_MODE"] == expected
    server.assert_called_once()
