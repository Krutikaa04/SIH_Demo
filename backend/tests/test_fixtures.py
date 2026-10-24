"""Each mutation must begin with the same pristine seed, regardless of test order."""
import pytest

from app import db


@pytest.mark.parametrize("probe", ["first", "second", "third"])
def test_database_isolation(conn, db_path, probe):
    assert conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 300
    assert db.get_setting(conn, "fixture_probe") is None
    assert db.database_path() == db_path
    db.set_setting(conn, "fixture_probe", probe)
    conn.execute("DELETE FROM cases WHERE case_id=(SELECT case_id FROM cases LIMIT 1)")
    conn.commit()


def test_database_path_resolves_environment_at_call_time(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "DB_PATH", None)
    for name in ("first.db", "second.db"):
        target = tmp_path / name
        monkeypatch.setenv("AICTE_DB", str(target))
        assert db.database_path() == target
        connection = db.connect()
        connection.close()
        assert target.exists()
