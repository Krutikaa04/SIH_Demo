"""Sign-in, sign-out, password change and user administration endpoints."""
from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response

from . import auth, db
from .roles import ROLE_LABELS, get_ctx

router = APIRouter()


def _fail(e: auth.AuthError):
    raise HTTPException(e.status, detail={"code": e.code, "message": e.message})


def _me(u):
    view = auth.user_view(u)
    view["role_label"] = ROLE_LABELS.get(u["role"], u["role"])
    return view


@router.get("/api/auth/config")
def config():
    """What the sign-in page needs before anyone is signed in. Demo accounts are listed only in demo mode."""
    out = {"demo_mode": auth.demo_mode(), "password_min": 8, "session_idle_hours": auth._idle().total_seconds() / 3600}
    if auth.demo_mode():
        out["demo_password"] = auth.demo_password()
        out["demo_accounts"] = [{"username": u, "label": ROLE_LABELS[role] + (f" · {region}" if region else ""),
                                 "role": role, "region": region, "name": name}
                                for u, name, role, region, _ in auth.demo_accounts()]
    return out


@router.post("/api/auth/login")
def login(request: Request, response: Response, body: dict = Body(...), conn=Depends(db.get_conn)):
    try:
        token, user = auth.login(conn, body.get("username"), body.get("password"), auth.client_ip(request),
                                 request.headers.get("user-agent", ""))
    except auth.AuthError as e:
        _fail(e)
    response.set_cookie(auth.SESSION_COOKIE, token, httponly=True, samesite="lax", secure=auth.cookie_secure(request), path="/")
    return {"user": _me(user)}


@router.get("/api/auth/me")
def me(request: Request, conn=Depends(db.get_conn)):
    u = auth.session_user(conn, request.cookies.get(auth.SESSION_COOKIE))
    if not u:
        raise HTTPException(401, detail={"code": "AUTH_REQUIRED", "message": "Please sign in."})
    return {"user": _me(u)}


@router.post("/api/auth/logout")
def logout(request: Request, response: Response, conn=Depends(db.get_conn)):
    token = request.cookies.get(auth.SESSION_COOKIE)
    u = auth.session_user(conn, token)
    if u:
        auth.log_event(conn, u["username"], "logout", "", auth.client_ip(request))
    auth.destroy_session(conn, token)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.post("/api/auth/change-password")
def change_password(request: Request, body: dict = Body(...), conn=Depends(db.get_conn)):
    u = request.state.user
    try:
        auth.change_password(conn, u, body.get("current_password"), body.get("new_password"), u["session_hash"])
    except auth.AuthError as e:
        _fail(e)
    except ValueError as e:
        raise HTTPException(400, detail={"code": "WEAK_PASSWORD", "message": str(e)})
    return {"ok": True}


# ---- administration (Senior Management) ------------------------------------------------------

def _senior(ctx):
    if ctx.role != "SENIOR":
        raise HTTPException(403, "Only Senior Management can manage accounts")


@router.get("/api/users")
def list_users(conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    _senior(ctx)
    rows = db.rows(conn, "SELECT * FROM users ORDER BY active DESC, role, username")
    return {"items": [auth.user_view(u) for u in rows]}


@router.post("/api/users")
def create_user(request: Request, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    _senior(ctx)
    try:
        u, temp = auth.create_user(conn, request.state.user, body.get("username"), body.get("display_name"), body.get("role"),
                                   body.get("region") or "", body.get("password") or None)
    except auth.AuthError as e:
        _fail(e)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"user": auth.user_view(u), "temporary_password": temp}


@router.patch("/api/users/{user_id}")
def update_user(user_id: int, request: Request, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    _senior(ctx)
    try:
        u = auth.update_user(conn, request.state.user, user_id, body)
    except auth.AuthError as e:
        _fail(e)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"user": auth.user_view(u)}


@router.post("/api/users/{user_id}/reset-password")
def reset_password(user_id: int, request: Request, conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    _senior(ctx)
    try:
        return {"temporary_password": auth.reset_password(conn, request.state.user, user_id)}
    except auth.AuthError as e:
        _fail(e)


@router.get("/api/auth/events")
def events(limit: int = 50, conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    _senior(ctx)
    return {"items": db.rows(conn, "SELECT ts,username,event,detail,ip FROM auth_events ORDER BY id DESC LIMIT ?", (max(1, min(limit, 200)),))}
