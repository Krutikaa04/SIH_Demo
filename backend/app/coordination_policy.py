"""Shared validation and serialization for coordination-sensitive mutations."""
from contextlib import contextmanager
from functools import wraps
from inspect import signature

from fastapi import HTTPException

from .constants import BUREAUS

OUTCOMES = {"MERGE": "MERGED", "RESOLVE": "RESOLVED", "KEEP_SEPARATE": "RESOLVED"}


@contextmanager
def write_transaction(conn):
    """Take the SQLite writer lock before reading the policy state, releasing on every path."""
    try:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        yield
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def serialized(handler):
    parameters = signature(handler)

    @wraps(handler)
    def mutate(*args, **kwargs):
        conn = parameters.bind(*args, **kwargs).arguments["conn"]
        with write_transaction(conn):
            return handler(*args, **kwargs)

    return mutate


def validate_lead(lead, cases):
    if not isinstance(lead, str) or lead not in BUREAUS:
        raise HTTPException(400, "Choose a recognized lead Bureau")
    if lead not in {case["bureau"] for case in cases}:
        raise HTTPException(400, "The lead must be a Bureau currently participating in this room")
    return lead


def decision_request(room, body):
    outcome = body.get("outcome")
    if not isinstance(outcome, str) or outcome not in OUTCOMES:
        raise HTTPException(400, "outcome must be MERGE, RESOLVE or KEEP_SEPARATE")
    lead = validate_lead(body.get("lead_bureau") or room["lead_bureau"], room["cases"])
    note = body.get("note") or ""
    if not isinstance(note, str):
        raise HTTPException(400, "Decision note must be text")
    note = note.strip()
    if room["decision"] or room["status"] != "OPEN":
        recorded = room["decision"]
        if not (isinstance(recorded, dict) and recorded.get("outcome") == outcome
                and recorded.get("lead_bureau") == lead and recorded.get("note", "") == note
                and room["status"] == OUTCOMES[outcome]):
            raise HTTPException(409, "This room already has a decision; it cannot be replaced")
        return outcome, lead, note, True
    return outcome, lead, note, False
