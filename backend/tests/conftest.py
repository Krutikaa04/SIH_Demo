"""Seed once, then isolate every test in its own database copy.

Every API call needs a signed-in session. ``client`` starts signed in as Senior Management; ``as_role(role, region)``
returns the request headers (a real session cookie) for the published demo account of that role; ``anon_client`` has no
session at all.
"""
import os
import shutil

os.environ.setdefault("AICTE_PBKDF2_ITERS", "1000")  # fast password hashing for tests; production uses 200,000
os.environ.setdefault("AICTE_MAX_SESSIONS", "1000")
os.environ.setdefault("AICTE_DEMO_MODE", "1")

import pytest
from fastapi.testclient import TestClient

from app import auth, db, main, seed


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


def _session_cookie(role, region=None):
    username = auth.region_username(region or "Western") if role == "REGIONAL" else role.lower()
    connection = db.connect()
    try:
        user = db.one(connection, "SELECT id FROM users WHERE username=?", (username,))
        return auth.create_session(connection, user["id"])
    finally:
        connection.close()


@pytest.fixture
def client(db_path):
    """Signed in as Senior Management unless a request passes its own ``headers=as_role(...)``."""
    with TestClient(main.app) as test_client:
        test_client.cookies.set(auth.SESSION_COOKIE, _session_cookie("SENIOR"))
        yield test_client


@pytest.fixture
def anon_client(db_path):
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _fresh_throttle():
    auth.reset_throttle()


@pytest.fixture
def corrupt_regional():
    """Headers for a Regional account whose stored region is invalid. The account API refuses to create one;
    this simulates a damaged row to prove region-scoped endpoints fail closed."""
    def headers(region):
        connection = db.connect()
        try:
            cur = connection.execute("INSERT INTO users(username,display_name,role,region,password_hash) VALUES(?,?,?,?,?)",
                                     (f"corrupt-{abs(hash(region or ''))}", "Corrupt", "REGIONAL", region, "x"))
            connection.commit()
            return {"Cookie": f"{auth.SESSION_COOKIE}={auth.create_session(connection, cur.lastrowid)}"}
        finally:
            connection.close()
    return headers


@pytest.fixture
def as_role():
    cache = {}

    def headers(role, region=None):
        key = (role, region or "")
        if key not in cache:
            cache[key] = {"Cookie": f"{auth.SESSION_COOKIE}={_session_cookie(role, region)}"}
        return cache[key]
    return headers
