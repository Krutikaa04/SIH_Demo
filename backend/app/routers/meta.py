"""Meta API routes."""
from fastapi import APIRouter, Depends
from .. import db, roles, services
from ..constants import BUREAUS, CATEGORIES, REGION_STATES, SLA_DAYS, STATUSES

router = APIRouter()


@router.get("/api/meta")
def meta():
    return {"bureaus": [{"code": k, "name": v, "sla_days": SLA_DAYS[k]} for k, v in BUREAUS.items()],
            "regions": [{"name": k, "states": v} for k, v in REGION_STATES.items()],
            "categories": [{"name": n, "group": g} for n, g in CATEGORIES], "statuses": STATUSES,
            "roles": [{"code": k, "label": v} for k, v in roles.ROLE_LABELS.items()],
            "sources": services.SOURCES}



@router.get("/api/meta/officers")
def meta_officers(conn=Depends(db.get_conn)):
    return {"items": db.rows(conn, "SELECT id,name,bureau_code,designation,level FROM officers ORDER BY bureau_code, level")}



@router.get("/api/clock")
def get_clock(conn=Depends(db.get_conn)):
    return {"offset_days": int(db.get_setting(conn, "clock_offset_days", "0")), "now": db.iso(db.now(conn))}

