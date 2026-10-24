"""Seed once, then isolate every test in its own database copy."""
import shutil

import pytest
from fastapi.testclient import TestClient

from app import db, main, seed


@pytest.fixture(scope="session")
def seeded_database(tmp_path_factory):
    path = tmp_path_factory.mktemp("template") / "seed.db"
    previous = db.DB_PATH
    db.configure(path)
    try:
        connection = db.connect()
        try:
            seed.seed(connection)
        finally:
            connection.close()
    finally:
        db.configure(previous)
    return path


@pytest.fixture(autouse=True)
def db_path(tmp_path, seeded_database, monkeypatch):
    path = tmp_path / "test.db"
    shutil.copy2(seeded_database, path)
    monkeypatch.setattr(db, "DB_PATH", str(path))
    return path


@pytest.fixture
def conn(db_path):
    connection = db.connect()
    try:
        yield connection
    finally:
        connection.close()


@pytest.fixture
def client(db_path):
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture
def as_role():
    def headers(role, region=None):
        return {"X-Role": role, "X-Region": region or ""}
    return headers
