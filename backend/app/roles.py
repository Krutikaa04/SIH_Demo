"""Roles and permissions. Who the caller is comes from the signed-in session (see auth.py), never from request headers.

The permission matrix below is unchanged: it decides what each role may do once a user is authenticated.
"""
from fastapi import HTTPException, Request

from .constants import BUREAUS

PERSONAS = {
    "RB": ("OFF-RB-01", "S. Kulkarni", "RB"),
    "PGRC": ("OFF-PGRC-01", "A. Mehta", "PGRC"),
    "AB": ("OFF-AB-01", "N. Reddy", "AB"),
    "LC": ("OFF-LC-01", "S. Menon", "LC"),
    "VIG": ("OFF-VIG-01", "G. Singh", "VIG"),
    "SENIOR": ("OFF-SM-01", "Competent Authority", "SENIOR"),
}
ROLE_LABELS = {
    "RB": "Regulation Bureau", "PGRC": "Public Grievance Cell", "AB": "Approval Bureau", "LC": "Legal Cell",
    "VIG": "Vigilance Cell", "REGIONAL": "Regional Office", "SENIOR": "Senior Management",
}


class Ctx(dict):
    @property
    def role(self):
        return self["role"]

    @property
    def region(self):
        return self["region"]

    @property
    def persona(self):
        return self["persona"]

    @property
    def is_bureau(self):
        return self["role"] in BUREAUS


def ctx_for(user) -> Ctx:
    """Build the request context from an authenticated user row."""
    role = user["role"]
    region = (user["region"] or "") if role == "REGIONAL" else ""
    bureau = role  # Bureau roles act as their Bureau; Senior and Regional keep their role name
    persona = (user.get("officer_id") or f"USR-{user['id']:04d}", user["display_name"], bureau)
    return Ctx(role=role, region=region, persona=persona, user_id=user["id"], username=user["username"])


def get_ctx(request: Request) -> Ctx:
    user = getattr(request.state, "user", None)
    if not user:  # the global auth dependency normally rejects first; this is the second lock
        raise HTTPException(401, detail={"code": "AUTH_REQUIRED", "message": "Please sign in."})
    return ctx_for(user)


def allowed_actions(ctx, case_bureau, case_region, status):
    """Which workflow actions this role may take on a case."""
    if status == "Disposed":
        return []
    if ctx.role == "REGIONAL":
        return ["remark"] if case_region == ctx.region else []
    if ctx.role == "SENIOR":
        return ["remark", "escalate"]
    if ctx.role == case_bureau:
        return ["remark", "assign", "transfer", "escalate", "dispose"]
    return []


def forbid(msg="Your role is not permitted to do this"):
    raise HTTPException(403, msg)
