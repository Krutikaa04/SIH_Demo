"""Prototype role model. No login: the UI sends X-Role / X-Region headers and the API enforces the matrix.

Production would use AICTE SSO (e-Office) with RBAC/ABAC and MFA.
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


def get_ctx(request: Request) -> Ctx:
    role = (request.headers.get("x-role") or "SENIOR").upper()
    if role not in ROLE_LABELS:
        role = "SENIOR"
    region = request.headers.get("x-region") or ""
    if role == "REGIONAL":
        persona = ("OFF-RO-01", f"Regional Officer, {region or 'Region'}", "REGIONAL")
    else:
        persona = PERSONAS[role]
    return Ctx(role=role, region=region if role == "REGIONAL" else "", persona=persona)


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
