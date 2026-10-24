"""Intel views API routes."""
from fastapi import APIRouter, Depends, Query
from .. import briefings, db, galaxy

router = APIRouter()


@router.get("/api/galaxy/graph")
def galaxy_graph(bureau: str = Query(default=None), conn=Depends(db.get_conn)):
    return galaxy.generate_galaxy_graph(conn, bureau_filter=bureau)



@router.get("/api/briefings/executive")
def executive_briefing(conn=Depends(db.get_conn)):
    return briefings.generate_executive_briefing(conn)
