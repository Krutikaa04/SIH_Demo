"""Authentication: password sign-in, server-side sessions, lockout and user administration.

Design
- Passwords are stored only as salted PBKDF2-SHA256 hashes (standard library, no extra dependency, works offline).
- A sign-in creates a random 256-bit token. The browser keeps it in an HttpOnly, SameSite=Lax cookie; the database keeps
  only the SHA-256 of the token, so a leaked database cannot be replayed as sessions.
- Sessions expire after an idle period and after an absolute lifetime; signing out, disabling the user or changing the
  password ends them on the server.
- Five wrong passwords lock the account for fifteen minutes; every sign-in event is recorded in ``auth_events``.
- Timestamps here use real wall-clock time (never the demo clock), so the time machine cannot expire sessions.

Demo mode (``AICTE_DEMO_MODE``, on by default for the prototype) additionally seeds one account per role with a published
password and enables the presenter endpoints. Switch it off for any real deployment.
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request

from . import db
from .constants import BUREAUS, REGION_STATES

SESSION_COOKIE = "icmd_session"
ROLES = ("RB", "PGRC", "AB", "LC", "VIG", "REGIONAL", "SENIOR")

# Public pages and calls that must work before anyone is signed in.
PUBLIC_API = {"/api/auth/login", "/api/auth/config", "/api/auth/me", "/api/auth/logout"}
# Allowed while a user still has to choose a new password.
PASSWORD_CHANGE_OK = {"/api/auth/change-password", "/api/auth/logout", "/api/auth/me", "/api/auth/config"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _flag(name, default):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def demo_mode():
    return _flag("AICTE_DEMO_MODE", "1")


def demo_password():
    return os.environ.get("AICTE_DEMO_PASSWORD", "Demo@2026")


def _iterations():
    return int(os.environ.get("AICTE_PBKDF2_ITERS", "200000"))


def _idle():
    return timedelta(hours=float(os.environ.get("AICTE_SESSION_IDLE_HOURS", "8")))


def _absolute():
    return timedelta(hours=float(os.environ.get("AICTE_SESSION_MAX_HOURS", "12")))


LOCK_AFTER = 5
LOCK_FOR = timedelta(minutes=15)
MAX_SESSIONS_PER_USER = int(os.environ.get("AICTE_MAX_SESSIONS", "5"))


class AuthError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.isoformat()


def parse(ts):
    return datetime.fromisoformat(ts) if ts else None


# ---- passwords -----------------------------------------------------------------------------

def hash_password(password, iterations=None):
    iterations = iterations or _iterations()
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256$%d$%s$%s" % (iterations, base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def verify_password(password, stored):
    try:
        scheme, iters, salt, digest = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.b64decode(salt), int(iters))
        return hmac.compare_digest(calc, base64.b64decode(digest))
    except Exception:
        return False


_DUMMY_HASH = None


def _burn_time(password):
    """Spend the same time on an unknown username as on a real one, so response timing does not reveal accounts."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("not-a-real-password")
    verify_password(password, _DUMMY_HASH)


COMMON = {"password", "password1", "12345678", "123456789", "qwerty123", "admin123", "letmein1", "welcome1", "iloveyou1"}


def validate_new_password(password, username=""):
    if not isinstance(password, str) or len(password) < 8:
        raise ValueError("Use at least 8 characters.")
    if len(password) > 128:
        raise ValueError("Use at most 128 characters.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ValueError("Use both letters and numbers.")
    if password.lower() in COMMON or (username and password.lower() == username.lower()):
        raise ValueError("That password is too easy to guess. Choose another.")


def generate_password():
    """Readable temporary password: three groups, always passes the policy."""
    while True:
        groups = [secrets.token_urlsafe(6).replace("_", "x").replace("-", "y")[:5] for _ in range(3)]
        candidate = "-".join(groups) + str(secrets.randbelow(10))
        try:
            validate_new_password(candidate)
            return candidate
        except ValueError:
            continue


# ---- users ---------------------------------------------------------------------------------

def region_username(region):
    return "regional-" + region.lower().replace(" ", "-")


def demo_accounts():
    """(username, display name, role, region, officer id) for the published demo accounts."""
    from .roles import PERSONAS  # late import: roles imports this module's helpers lazily
    out = []
    for role in ("RB", "PGRC", "AB", "LC", "VIG"):
        oid, name, _ = PERSONAS[role]
        out.append((role.lower(), name, role, "", oid))
    oid, name, _ = PERSONAS["SENIOR"]
    out.append(("senior", name, "SENIOR", "", oid))
    for region in REGION_STATES:
        out.append((region_username(region), f"Regional Officer, {region}", "REGIONAL", region, "OFF-RO-01"))
    return out


def user_view(u):
    return {"id": u["id"], "username": u["username"], "display_name": u["display_name"], "role": u["role"],
            "region": u["region"] or "", "active": bool(u["active"]), "must_change_password": bool(u["must_change_password"]),
            "is_demo": bool(u["is_demo"]), "last_login_at": u["last_login_at"], "created_at": u["created_at"],
            "locked": bool(u["locked_until"] and parse(u["locked_until"]) > now_utc())}


def ensure_demo_users(conn):
    """Create the published demo accounts that are missing. Does nothing when demo mode is off."""
    if not demo_mode():
        return 0
    made = 0
    for username, name, role, region, oid in demo_accounts():
        if db.one(conn, "SELECT 1 AS x FROM users WHERE username=? COLLATE NOCASE", (username,)):
            continue
        conn.execute("INSERT INTO users(username,display_name,role,region,officer_id,password_hash,is_demo,created_at,created_by,"
                     "password_changed_at) VALUES(?,?,?,?,?,?,1,?,?,?)",
                     (username, name, role, region or None, oid, hash_password(demo_password()), iso(now_utc()), "system",
                      iso(now_utc())))
        made += 1
    conn.commit()
    return made


def bootstrap(conn):
    """First start: make sure someone can sign in. Demo mode seeds the demo accounts; otherwise a Senior ``admin`` is
    created with a one-time password printed to the console."""
    if db.one(conn, "SELECT 1 AS x FROM users LIMIT 1"):
        ensure_demo_users(conn)
        return
    if demo_mode():
        ensure_demo_users(conn)
        return
    password = os.environ.get("AICTE_BOOTSTRAP_PASSWORD") or generate_password()
    conn.execute("INSERT INTO users(username,display_name,role,password_hash,must_change_password,created_at,created_by,"
                 "password_changed_at) VALUES('admin','Administrator','SENIOR',?,1,?,'system',?)",
                 (hash_password(password), iso(now_utc()), iso(now_utc())))
    conn.commit()
    print(f"\n  First start: sign in as 'admin' with the one-time password  {password}\n  You will be asked to change it.\n")


def validate_account(role, region):
    if role not in ROLES:
        raise ValueError("Choose a valid role.")
    if role == "REGIONAL" and region not in REGION_STATES:
        raise ValueError("A Regional Officer needs a region.")


def create_user(conn, actor, username, display_name, role, region="", password=None):
    username = (username or "").strip()
    display_name = (display_name or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{2,40}", username):
        raise ValueError("Username: 2 to 40 letters, numbers, dots, dashes or underscores.")
    if not display_name:
        raise ValueError("Enter the person's name.")
    validate_account(role, region)
    if db.one(conn, "SELECT 1 AS x FROM users WHERE username=? COLLATE NOCASE", (username,)):
        raise AuthError(409, "USERNAME_TAKEN", "That username is already in use.")
    temp = password is None
    password = password or generate_password()
    validate_new_password(password, username)
    cur = conn.execute("INSERT INTO users(username,display_name,role,region,password_hash,must_change_password,created_at,created_by,"
                       "password_changed_at) VALUES(?,?,?,?,?,?,?,?,?)",
                       (username, display_name, role, region or None, hash_password(password), 1, iso(now_utc()), actor["username"],
                        iso(now_utc())))
    log_event(conn, username, "user_created", f"by {actor['username']} as {role}")
    conn.commit()
    return db.one(conn, "SELECT * FROM users WHERE id=?", (cur.lastrowid,)), (password if temp else None)


def _last_active_senior(conn, user_id):
    n = conn.execute("SELECT COUNT(*) FROM users WHERE role='SENIOR' AND active=1 AND id!=?", (user_id,)).fetchone()[0]
    return n == 0


def update_user(conn, actor, user_id, changes):
    u = db.one(conn, "SELECT * FROM users WHERE id=?", (user_id,))
    if not u:
        raise AuthError(404, "NOT_FOUND", "User not found.")
    role = changes.get("role", u["role"])
    region = changes.get("region", u["region"] or "") if role == "REGIONAL" else ""
    name = (changes.get("display_name", u["display_name"]) or "").strip()
    active = int(bool(changes.get("active", u["active"])))
    validate_account(role, region)
    if not name:
        raise ValueError("Enter the person's name.")
    if u["id"] == actor["id"] and (not active or role != u["role"]):
        raise AuthError(409, "SELF_CHANGE", "You cannot disable yourself or change your own role.")
    if u["role"] == "SENIOR" and (not active or role != "SENIOR") and _last_active_senior(conn, u["id"]):
        raise AuthError(409, "LAST_SENIOR", "At least one active Senior Management account must remain.")
    conn.execute("UPDATE users SET display_name=?,role=?,region=?,active=? WHERE id=?", (name, role, region or None, active, user_id))
    if not active or role != u["role"] or (region or None) != u["region"]:
        destroy_user_sessions(conn, user_id)
    log_event(conn, u["username"], "user_updated", f"by {actor['username']}")
    conn.commit()
    return db.one(conn, "SELECT * FROM users WHERE id=?", (user_id,))


def reset_password(conn, actor, user_id):
    u = db.one(conn, "SELECT * FROM users WHERE id=?", (user_id,))
    if not u:
        raise AuthError(404, "NOT_FOUND", "User not found.")
    temp = generate_password()
    conn.execute("UPDATE users SET password_hash=?,must_change_password=1,failed_attempts=0,locked_until=NULL,password_changed_at=? WHERE id=?",
                 (hash_password(temp), iso(now_utc()), user_id))
    destroy_user_sessions(conn, user_id)
    log_event(conn, u["username"], "password_reset", f"by {actor['username']}")
    conn.commit()
    return temp


def change_password(conn, u, current, new, session_hash=None):
    if not verify_password(current or "", u["password_hash"]):
        log_event(conn, u["username"], "password_change_failed", "wrong current password")
        conn.commit()
        raise AuthError(400, "WRONG_PASSWORD", "The current password is not right.")
    if new == current:
        raise ValueError("Choose a password different from the current one.")
    validate_new_password(new, u["username"])
    conn.execute("UPDATE users SET password_hash=?,must_change_password=0,password_changed_at=? WHERE id=?",
                 (hash_password(new), iso(now_utc()), u["id"]))
    destroy_user_sessions(conn, u["id"], keep=session_hash)  # every other device is signed out
    log_event(conn, u["username"], "password_changed", "")
    conn.commit()


# ---- sessions ------------------------------------------------------------------------------

def _hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn, user_id, ip="", agent=""):
    token = secrets.token_urlsafe(32)
    now = now_utc()
    conn.execute("DELETE FROM sessions WHERE expires_at<?", (iso(now),))
    old = conn.execute("SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC", (user_id,)).fetchall()
    for r in old[MAX_SESSIONS_PER_USER - 1:]:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (r[0],))
    conn.execute("INSERT INTO sessions(token_hash,user_id,created_at,last_seen_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?,?)",
                 (_hash_token(token), user_id, iso(now), iso(now), iso(now + _idle()), ip, (agent or "")[:200]))
    conn.commit()
    return token


def session_user(conn, token):
    """The user a session token belongs to, or None when it is unknown, expired or the account is disabled."""
    if not token:
        return None
    h = _hash_token(token)
    row = db.one(conn, "SELECT s.created_at AS s_created, s.last_seen_at, s.expires_at, u.* FROM sessions s "
                       "JOIN users u ON u.id=s.user_id WHERE s.token_hash=?", (h,))
    if not row:
        return None
    now = now_utc()
    if parse(row["expires_at"]) < now or parse(row["s_created"]) + _absolute() < now or not row["active"]:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (h,))
        conn.commit()
        return None
    if (now - parse(row["last_seen_at"])).total_seconds() > 60:  # slide the idle window, without a write per request
        conn.execute("UPDATE sessions SET last_seen_at=?,expires_at=? WHERE token_hash=?", (iso(now), iso(now + _idle()), h))
        conn.commit()
    row["session_hash"] = h
    return row


def destroy_session(conn, token):
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (_hash_token(token),))
        conn.commit()


def destroy_user_sessions(conn, user_id, keep=None):
    if keep:
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token_hash!=?", (user_id, keep))
    else:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


# ---- sign in -------------------------------------------------------------------------------

_ip_hits = defaultdict(deque)
_ip_lock = threading.Lock()
IP_LIMIT, IP_WINDOW = 30, 300  # attempts per 5 minutes from one address


def _throttle(ip):
    now = time.time()
    with _ip_lock:
        q = _ip_hits[ip]
        while q and now - q[0] > IP_WINDOW:
            q.popleft()
        if len(q) >= IP_LIMIT:
            raise AuthError(429, "TOO_MANY_REQUESTS", "Too many sign-in attempts. Wait a few minutes and try again.")
        q.append(now)


def reset_throttle():
    with _ip_lock:
        _ip_hits.clear()


def log_event(conn, username, event, detail="", ip=""):
    conn.execute("INSERT INTO auth_events(ts,username,event,detail,ip) VALUES(?,?,?,?,?)", (iso(now_utc()), username, event, detail, ip))


def login(conn, username, password, ip="", agent=""):
    _throttle(ip or "?")
    username = (username or "").strip()
    u = db.one(conn, "SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)) if username else None
    if not u:
        _burn_time(password or "")
        log_event(conn, username[:60], "login_failed", "unknown user", ip)
        conn.commit()
        raise AuthError(401, "BAD_CREDENTIALS", "Incorrect username or password.")
    now = now_utc()
    if u["locked_until"] and parse(u["locked_until"]) > now:
        mins = max(1, int((parse(u["locked_until"]) - now).total_seconds() // 60) + 1)
        log_event(conn, u["username"], "login_blocked", "account locked", ip)
        conn.commit()
        raise AuthError(423, "LOCKED", f"Too many wrong passwords. Try again in {mins} minute{'s' if mins != 1 else ''}.")
    if not verify_password(password or "", u["password_hash"]):
        attempts = u["failed_attempts"] + 1
        lock = iso(now + LOCK_FOR) if attempts >= LOCK_AFTER else None
        conn.execute("UPDATE users SET failed_attempts=?,locked_until=? WHERE id=?", (0 if lock else attempts, lock, u["id"]))
        log_event(conn, u["username"], "login_failed", "wrong password" + (" (account locked)" if lock else ""), ip)
        conn.commit()
        raise AuthError(401, "BAD_CREDENTIALS", "Incorrect username or password.")
    if not u["active"]:
        log_event(conn, u["username"], "login_blocked", "account disabled", ip)
        conn.commit()
        raise AuthError(403, "DISABLED", "This account has been disabled. Ask an administrator.")
    conn.execute("UPDATE users SET failed_attempts=0,locked_until=NULL,last_login_at=? WHERE id=?", (iso(now), u["id"]))
    log_event(conn, u["username"], "login", "", ip)
    token = create_session(conn, u["id"], ip, agent)
    return token, db.one(conn, "SELECT * FROM users WHERE id=?", (u["id"],))


# ---- request integration -------------------------------------------------------------------

def client_ip(request):
    return request.client.host if request.client else ""


def cookie_secure(request):
    return _flag("AICTE_COOKIE_SECURE", "0") or request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def _same_origin(request):
    origin = request.headers.get("origin")
    if not origin:
        return True  # non-browser clients (scripts, tests) send no Origin; browsers always do on cross-site writes
    host = request.headers.get("host", "")
    return origin.split("://", 1)[-1] == host


def require_auth(request: Request):
    """Global dependency: every /api route needs a valid session, except the sign-in calls."""
    path = request.url.path
    if not path.startswith("/api/") or path in PUBLIC_API:
        return
    if request.method not in SAFE_METHODS and not _same_origin(request):
        raise HTTPException(403, "Cross-site request blocked")
    conn = db.connect()
    try:
        u = session_user(conn, request.cookies.get(SESSION_COOKIE))
    finally:
        conn.close()
    if not u:
        raise HTTPException(401, detail={"code": "AUTH_REQUIRED", "message": "Please sign in."})
    if u["must_change_password"] and path not in PASSWORD_CHANGE_OK:
        raise HTTPException(403, detail={"code": "PASSWORD_CHANGE_REQUIRED", "message": "Choose a new password to continue."})
    request.state.user = u
