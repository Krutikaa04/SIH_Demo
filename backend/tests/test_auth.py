"""Real sign-in: sessions, lockout, protected routes, password rules and account administration."""
from datetime import timedelta

import pytest

from app import auth, db, main

DEMO_PASSWORD = "Demo@2026"


def sign_in(client, username="rb", password=DEMO_PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def make_user(client, username="new.officer", role="RB", region="", password=None, name="New Officer"):
    return client.post("/api/users", json={"username": username, "display_name": name, "role": role, "region": region,
                                           "password": password})


def user_id(conn, username):
    return conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()[0]


# ---- sign in and out -----------------------------------------------------------------------

def test_config_lists_the_demo_accounts_before_anyone_signs_in(anon_client):
    data = anon_client.get("/api/auth/config").json()
    assert data["demo_mode"] is True and data["demo_password"] == DEMO_PASSWORD
    usernames = {a["username"] for a in data["demo_accounts"]}
    assert {"rb", "pgrc", "ab", "lc", "vig", "senior", "regional-western", "regional-north-western"} <= usernames


def test_sign_in_sets_a_hardened_cookie_and_me_returns_the_user(anon_client, conn):
    response = sign_in(anon_client)
    assert response.status_code == 200 and response.json()["user"]["role"] == "RB"
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "icmd_session=" in cookie
    me = anon_client.get("/api/auth/me").json()["user"]
    assert me["username"] == "rb" and me["display_name"] == "S. Kulkarni" and me["role_label"] == "Regulation Bureau"
    assert "password_hash" not in me
    # the database keeps only a hash of the token
    token = anon_client.cookies.get("icmd_session")
    stored = [r[0] for r in conn.execute("SELECT token_hash FROM sessions")]
    assert token not in stored and len(stored) >= 1


def test_wrong_password_and_unknown_user_look_the_same(anon_client):
    a = sign_in(anon_client, "rb", "wrong-password1")
    b = sign_in(anon_client, "nobody", "wrong-password1")
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"]["message"] == b.json()["detail"]["message"] == "Incorrect username or password."
    assert anon_client.get("/api/auth/me").status_code == 401


def test_username_is_case_insensitive(anon_client):
    assert sign_in(anon_client, "RB").status_code == 200


def test_sign_out_ends_the_session_on_the_server(anon_client):
    sign_in(anon_client)
    token = anon_client.cookies.get("icmd_session")
    assert anon_client.get("/api/cases?page_size=1").status_code == 200
    assert anon_client.post("/api/auth/logout").status_code == 200
    assert anon_client.get("/api/cases?page_size=1").status_code == 401
    anon_client.cookies.clear()
    assert anon_client.get("/api/cases?page_size=1", headers={"Cookie": f"icmd_session={token}"}).status_code == 401


def test_five_wrong_passwords_lock_the_account_for_a_while(anon_client, conn):
    for _ in range(auth.LOCK_AFTER):
        assert sign_in(anon_client, "pgrc", "bad-password1").status_code == 401
    locked = sign_in(anon_client, "pgrc", DEMO_PASSWORD)  # even the right password is refused while locked
    assert locked.status_code == 423 and "minute" in locked.json()["detail"]["message"]
    other = sign_in(anon_client, "rb")
    assert other.status_code == 200  # other accounts are unaffected
    conn.execute("UPDATE users SET locked_until=? WHERE username='pgrc'",
                 (auth.iso(auth.now_utc() - timedelta(minutes=1)),))
    conn.commit()
    assert sign_in(anon_client, "pgrc").status_code == 200


def test_a_successful_sign_in_resets_the_failure_counter(anon_client, conn):
    for _ in range(auth.LOCK_AFTER - 1):
        sign_in(anon_client, "ab", "bad-password1")
    assert sign_in(anon_client, "ab").status_code == 200
    assert conn.execute("SELECT failed_attempts FROM users WHERE username='ab'").fetchone()[0] == 0
    for _ in range(auth.LOCK_AFTER - 1):
        sign_in(anon_client, "ab", "bad-password1")
    assert sign_in(anon_client, "ab").status_code == 200  # still not locked


def test_sign_in_activity_is_recorded(client, anon_client):
    sign_in(anon_client, "rb", "bad-password1")
    sign_in(anon_client)
    anon_client.post("/api/auth/logout")
    events = [(e["username"], e["event"]) for e in client.get("/api/auth/events").json()["items"]]
    assert ("rb", "login_failed") in events and ("rb", "login") in events and ("rb", "logout") in events


# ---- every API route is protected ------------------------------------------------------------

def api_routes(method):
    out = []
    for r in main.app.routes:
        path = getattr(r, "path", "")
        if path.startswith("/api/") and method in getattr(r, "methods", set()) and path not in auth.PUBLIC_API:
            out.append(path)
    return sorted(set(out))


def test_every_get_route_refuses_anonymous_callers(anon_client):
    open_routes = []
    for path in api_routes("GET"):
        concrete = path.replace("{case_id:path}", "X").replace("{kind}", "bureau")
        concrete = concrete.replace("{pair_id}", "PR-0001").replace("{room_id}", "ROOM-0001").replace("{aicte_id}", "1-1")
        concrete = concrete.replace("{alert_id}", "1").replace("{id}", "1").replace("{queue_id}", "UNM-0001")
        concrete = concrete.replace("{user_id}", "1")
        r = anon_client.get(concrete)
        if r.status_code != 401:
            open_routes.append((path, r.status_code))
    assert open_routes == [], f"routes reachable without signing in: {open_routes}"


@pytest.mark.parametrize("method,path", [("post", "/api/complaints"), ("post", "/api/admin/reset"), ("post", "/api/simulate/complaint"),
                                         ("post", "/api/admin/clock"), ("post", "/api/admin/tamper"), ("post", "/api/links"),
                                         ("post", "/api/rooms"), ("post", "/api/alerts/read-all"), ("post", "/api/users")])
def test_write_routes_refuse_anonymous_callers(anon_client, method, path):
    assert getattr(anon_client, method)(path, json={}).status_code == 401


def test_the_event_stream_needs_a_session(anon_client):
    assert anon_client.get("/api/events").status_code == 401


def test_the_role_header_is_ignored(anon_client, as_role):
    assert anon_client.get("/api/users", headers={"X-Role": "SENIOR", "X-Region": ""}).status_code == 401
    spoof = {**as_role("RB"), "X-Role": "SENIOR"}
    assert anon_client.get("/api/users", headers=spoof).status_code == 403  # still a Bureau user, not Senior
    me = anon_client.get("/api/auth/me", headers=spoof).json()["user"]
    assert me["role"] == "RB"


def test_permissions_follow_the_account_not_the_request(anon_client):
    sign_in(anon_client, "pgrc")
    case = anon_client.get("/api/cases?bureau=RB&page_size=1").json()["items"][0]
    cid = case["case_id"].replace("/", "%2F")
    r = anon_client.post(f"/api/cases/{cid}/actions", json={"type": "remark", "remarks": "x"})
    assert r.status_code == 403  # PGRC cannot act on an RB case


def test_the_page_itself_loads_without_signing_in(anon_client):
    assert anon_client.get("/").status_code == 200  # the sign-in screen is part of the same app


# ---- cross-site writes -----------------------------------------------------------------------

def test_cross_site_writes_are_blocked(client):
    evil = client.post("/api/alerts/read-all", headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    same = client.post("/api/alerts/read-all", headers={"Origin": "http://testserver"})
    assert same.status_code == 200


# ---- session lifetime ------------------------------------------------------------------------

def test_idle_sessions_expire(anon_client, conn):
    sign_in(anon_client)
    conn.execute("UPDATE sessions SET expires_at=?", (auth.iso(auth.now_utc() - timedelta(seconds=1)),))
    conn.commit()
    assert anon_client.get("/api/cases?page_size=1").status_code == 401


def test_sessions_have_an_absolute_lifetime(anon_client, conn):
    sign_in(anon_client)
    old = auth.iso(auth.now_utc() - timedelta(hours=13))
    conn.execute("UPDATE sessions SET created_at=?", (old,))
    conn.commit()
    assert anon_client.get("/api/cases?page_size=1").status_code == 401


def test_activity_slides_the_idle_window(anon_client, conn):
    sign_in(anon_client)
    soon = auth.iso(auth.now_utc() + timedelta(minutes=5))
    long_ago = auth.iso(auth.now_utc() - timedelta(minutes=10))
    conn.execute("UPDATE sessions SET expires_at=?, last_seen_at=?", (soon, long_ago))
    conn.commit()
    assert anon_client.get("/api/cases?page_size=1").status_code == 200
    expires = conn.execute("SELECT expires_at FROM sessions").fetchone()[0]
    assert auth.parse(expires) > auth.now_utc() + timedelta(hours=7)


def test_demo_reset_does_not_sign_anyone_out(client):
    assert client.post("/api/admin/reset").status_code == 200
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/api/auth/config").json()["demo_accounts"]


# ---- passwords -------------------------------------------------------------------------------

def test_passwords_are_stored_as_salted_hashes(conn):
    stored = [r[0] for r in conn.execute("SELECT password_hash FROM users")]
    assert all(h.startswith("pbkdf2_sha256$") and DEMO_PASSWORD not in h for h in stored)
    assert len(set(stored)) == len(stored)  # unique salts: identical passwords never hash alike
    assert auth.verify_password(DEMO_PASSWORD, stored[0]) and not auth.verify_password("nope", stored[0])


@pytest.mark.parametrize("weak", ["short1", "allletters", "12345678", "password1", "rb"])
def test_weak_passwords_are_refused(weak):
    with pytest.raises(ValueError):
        auth.validate_new_password(weak, "rb")


def test_change_password(anon_client):
    sign_in(anon_client)
    ok = {"current_password": DEMO_PASSWORD, "new_password": "Fresh-Pass-42"}
    assert anon_client.post("/api/auth/change-password", json={**ok, "current_password": "wrong1234"}).status_code == 400
    assert anon_client.post("/api/auth/change-password", json={**ok, "new_password": "weak"}).status_code == 400
    assert anon_client.post("/api/auth/change-password", json=ok).status_code == 200
    anon_client.post("/api/auth/logout")
    assert sign_in(anon_client, "rb", DEMO_PASSWORD).status_code == 401
    assert sign_in(anon_client, "rb", "Fresh-Pass-42").status_code == 200


def test_changing_the_password_signs_out_other_devices(anon_client, as_role):
    sign_in(anon_client)
    other = as_role("RB")  # a second session of the same user
    assert anon_client.get("/api/cases?page_size=1", headers=other).status_code == 200
    anon_client.post("/api/auth/change-password", json={"current_password": DEMO_PASSWORD, "new_password": "Fresh-Pass-42"})
    assert anon_client.get("/api/cases?page_size=1", headers=other).status_code == 401
    assert anon_client.get("/api/cases?page_size=1").status_code == 200  # this device stays signed in


# ---- administration --------------------------------------------------------------------------

def test_only_senior_management_can_manage_accounts(anon_client, as_role):
    for role in ("RB", "PGRC", "REGIONAL"):
        h = as_role(role, "Western")
        assert anon_client.get("/api/users", headers=h).status_code == 403, role
        assert anon_client.post("/api/users", json={"username": "x.y.z", "display_name": "X", "role": "RB"}, headers=h).status_code == 403, role
        assert anon_client.get("/api/auth/events", headers=h).status_code == 403, role


def test_new_users_get_a_temporary_password_and_must_choose_their_own(client, anon_client):
    created = make_user(client)
    assert created.status_code == 200
    temp = created.json()["temporary_password"]
    assert temp and created.json()["user"]["must_change_password"] is True
    assert sign_in(anon_client, "new.officer", temp).status_code == 200
    blocked = anon_client.get("/api/cases?page_size=1")
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert anon_client.get("/api/auth/me").status_code == 200
    assert anon_client.post("/api/auth/change-password", json={"current_password": temp, "new_password": "Own-Pass-2026"}).status_code == 200
    assert anon_client.get("/api/cases?page_size=1").status_code == 200


def test_account_validation(client):
    assert make_user(client, username="a").status_code == 400  # too short
    assert make_user(client, username="has space").status_code == 400
    assert make_user(client, role="ADMIN").status_code == 400
    assert make_user(client, username="reg.no.region", role="REGIONAL").status_code == 400
    assert make_user(client, username="reg.bad.region", role="REGIONAL", region="Atlantis").status_code == 400
    assert make_user(client, username="reg.ok", role="REGIONAL", region="Eastern").status_code == 200
    assert make_user(client, username="weak.one", password="short").status_code == 400
    assert make_user(client, username="RB").status_code == 409  # username already used (any case)


def test_a_regional_user_only_sees_their_own_region(client, anon_client):
    temp = make_user(client, username="east.officer", role="REGIONAL", region="Eastern").json()["temporary_password"]
    sign_in(anon_client, "east.officer", temp)
    anon_client.post("/api/auth/change-password", json={"current_password": temp, "new_password": "Own-Pass-2026"})
    regions = {c["institution"]["region"] for c in anon_client.get("/api/cases?page_size=200").json()["items"]}
    assert regions == {"Eastern"}


def test_disabling_a_user_ends_their_sessions_and_blocks_sign_in(client, anon_client, conn):
    sign_in(anon_client, "lc")
    uid = user_id(conn, "lc")
    assert client.patch(f"/api/users/{uid}", json={"active": False}).status_code == 200
    assert anon_client.get("/api/cases?page_size=1").status_code == 401
    r = sign_in(anon_client, "lc")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "DISABLED"
    assert client.patch(f"/api/users/{uid}", json={"active": True}).status_code == 200
    assert sign_in(anon_client, "lc").status_code == 200


def test_changing_a_role_ends_the_users_sessions(client, anon_client, conn):
    sign_in(anon_client, "vig")
    assert client.patch(f"/api/users/{user_id(conn, 'vig')}", json={"role": "AB"}).status_code == 200
    assert anon_client.get("/api/cases?page_size=1").status_code == 401
    assert sign_in(anon_client, "vig").json()["user"]["role"] == "AB"


def test_reset_password_forces_a_new_choice_and_ends_sessions(client, anon_client, conn):
    sign_in(anon_client, "ab")
    uid = user_id(conn, "ab")
    temp = client.post(f"/api/users/{uid}/reset-password").json()["temporary_password"]
    assert anon_client.get("/api/cases?page_size=1").status_code == 401
    assert sign_in(anon_client, "ab", DEMO_PASSWORD).status_code == 401
    assert sign_in(anon_client, "ab", temp).status_code == 200
    assert anon_client.get("/api/cases?page_size=1").status_code == 403  # must change first


def test_resetting_a_password_unlocks_the_account(client, anon_client, conn):
    for _ in range(auth.LOCK_AFTER):
        sign_in(anon_client, "pgrc", "bad-password1")
    temp = client.post(f"/api/users/{user_id(conn, 'pgrc')}/reset-password").json()["temporary_password"]
    assert sign_in(anon_client, "pgrc", temp).status_code == 200


def test_you_cannot_lock_yourself_out_or_remove_the_last_senior(client, conn):
    me = user_id(conn, "senior")
    assert client.patch(f"/api/users/{me}", json={"active": False}).status_code == 409
    assert client.patch(f"/api/users/{me}", json={"role": "RB"}).status_code == 409
    other = make_user(client, username="second.senior", role="SENIOR").json()["user"]["id"]
    assert client.patch(f"/api/users/{other}", json={"active": False}).status_code == 200  # a second one may go
    assert client.patch(f"/api/users/{me}", json={"display_name": "Competent Authority"}).status_code == 200


def test_user_list_never_exposes_secrets(client):
    body = client.get("/api/users").text
    assert "password_hash" not in body and "pbkdf2" not in body and "token" not in body


def test_actions_are_attributed_to_the_signed_in_person(anon_client):
    sign_in(anon_client, "rb")
    case = anon_client.get("/api/cases?bureau=RB&page_size=1").json()["items"][0]
    cid = case["case_id"].replace("/", "%2F")
    assert anon_client.post(f"/api/cases/{cid}/actions", json={"type": "remark", "remarks": "Checked the file."}).status_code == 200
    last = anon_client.get(f"/api/cases/{cid}/history").json()["items"][-1]
    assert last["actor"]["name"] == "S. Kulkarni" and last["actor"]["bureau"] == "RB"


# ---- demo mode switch ------------------------------------------------------------------------

def test_presenter_endpoints_and_demo_accounts_disappear_when_demo_mode_is_off(client, anon_client, monkeypatch):
    monkeypatch.setenv("AICTE_DEMO_MODE", "0")
    assert client.post("/api/admin/reset").status_code == 404
    assert client.post("/api/simulate/complaint").status_code == 404
    assert client.post("/api/admin/clock", json={"add_days": 1}).status_code == 404
    config = anon_client.get("/api/auth/config").json()
    assert config["demo_mode"] is False and "demo_accounts" not in config and "demo_password" not in config


def test_first_start_without_demo_mode_creates_a_one_time_admin(conn, monkeypatch, capsys):
    monkeypatch.setenv("AICTE_DEMO_MODE", "0")
    monkeypatch.setenv("AICTE_BOOTSTRAP_PASSWORD", "First-Run-2026")
    conn.execute("DELETE FROM sessions")
    conn.execute("DELETE FROM users")
    conn.commit()
    auth.bootstrap(conn)
    rows = db.rows(conn, "SELECT username,role,must_change_password,is_demo FROM users")
    assert rows == [{"username": "admin", "role": "SENIOR", "must_change_password": 1, "is_demo": 0}]
    assert auth.verify_password("First-Run-2026", conn.execute("SELECT password_hash FROM users").fetchone()[0])
    assert "First-Run-2026" in capsys.readouterr().out
