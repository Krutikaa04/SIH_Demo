"""P2 endpoints: natural-language search, reports (JSON/CSV), case CSV export, supporting documents."""
import base64
import hashlib
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import FileResponse, Response

from . import db, events, nlsearch, reports, roles, services, security, upload_security
from .roles import get_ctx

router = APIRouter()
UPLOADS = db.ROOT / "data" / "uploads"
MAX_BYTES = upload_security.MAX_BYTES


@router.post("/api/complaints/preview")
def complaint_preview(body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    return services.preview_complaint(conn, body, ctx)


@router.post("/api/complaints")
def register_complaint(body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    try:
        d = services.clean_complaint(conn, body, ctx)
        return services.register_complaint(conn, d, ctx)
    except services.Unresolved as e:
        raise HTTPException(422, detail={"code": "UNRESOLVED_INSTITUTION", "message": str(e),
                                         "suggestions": e.suggestions})
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/api/complaints/import")
def import_complaints(body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    try:
        return services.import_complaints(conn, body.get("csv_text") or "", ctx, bool(body.get("dry_run", True)))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api/search/nl")
def nl_search(q: str = "", conn=Depends(db.get_conn)):
    return nlsearch.parse(conn, q)


@router.get("/api/reports/{kind}")
def report(kind: str, format: str = "json", period: str = "month", conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    try:
        rep = reports.build(kind, conn, ctx, period)
    except KeyError:
        raise HTTPException(404, "unknown report")
    if format == "csv":
        return Response(reports.to_csv(rep), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="aicte_{kind}_report.csv"'})
    return rep


@router.get("/api/export/cases")
def export_cases(q: str = "", bureau: str = "", region: str = "", category: str = "", status: str = "",
                 institution_id: str = "", date_from: str = "", date_to: str = "", overdue: int = 0,
                 overlap: int = 0, nearing: int = 0, age_gt: int = 0, age_lt: int = 0,
                 conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    today = db.now(conn).date()
    if ctx.role == "REGIONAL":
        region = ctx.region
    where, params = services.case_where(today, q, bureau, region, category, status, institution_id, date_from,
                                        date_to, overdue, overlap, nearing, age_gt, age_lt)
    w = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.rows(conn, services.CASE_SELECT + f" {w} ORDER BY c.received_on DESC, c.case_id", params)
    cl, bl = services.cluster_map(conn), services.bureau_lookup(conn)
    items = [services.serialize_case(r, today, cl, bl) for r in rows]
    return Response(reports.cases_csv(items), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="aicte_cases.csv"'})


# ---------------------------------------------------------------- documents ---------

def _doc_view(d):
    p = Path(d["path"])
    ok = p.exists() and hashlib.sha256(p.read_bytes()).hexdigest() == d["sha256"]
    return {"id": d["id"], "case_id": d["case_id"], "seq": d["seq"], "filename": d["filename"], "size": d["size"],
            "sha256": d["sha256"], "uploaded_by": d["uploaded_by"], "uploaded_at": d["uploaded_at"], "verified": ok}


@router.get("/api/cases/{case_id:path}/documents")
def list_documents(case_id: str, conn=Depends(db.get_conn)):
    docs = db.rows(conn, "SELECT * FROM documents WHERE case_id=? ORDER BY id", (case_id,))
    return {"items": [_doc_view(d) for d in docs]}


@router.post("/api/cases/{case_id:path}/documents")
def upload_document(case_id: str, body: dict = Body(...), conn=Depends(db.get_conn), ctx=Depends(get_ctx)):
    c = db.one(conn, services.CASE_SELECT + " WHERE c.case_id=?", (case_id,))
    if not c:
        raise HTTPException(404, "case not found")
    if "remark" not in roles.allowed_actions(ctx, c["bureau_code"], c["inst_region"], c["status"]):
        roles.forbid("Your role cannot add documents to this case")
    supplied_name = body.get("filename") or "document"
    if not isinstance(supplied_name, str):
        raise HTTPException(400, "filename must be text")
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", supplied_name.strip())[:80] or "document"
    encoded = body.get("content_base64") or ""
    if not isinstance(encoded, str):
        raise HTTPException(400, "file content must be base64 text")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        raise HTTPException(400, "invalid file content")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, f"File exceeds {MAX_BYTES} bytes")
    if not raw:
        raise HTTPException(400, "file must not be empty")
    if not upload_security.allowed_document(name, raw):
        raise HTTPException(415, "Unsupported document type or invalid file signature")
    sha = hashlib.sha256(raw).hexdigest()
    folder = UPLOADS / case_id.replace("/", "_")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex}{Path(name).suffix.lower()}"
    path.write_bytes(raw)
    stamp = db.iso(db.now(conn))
    P = ctx.persona
    try:
        note = security.validate_remarks(body.get("remarks") or "")
    except ValueError as e:
        path.unlink(missing_ok=True)
        raise HTTPException(400, str(e))
    seq, _ = db.append_action(conn, case_id, stamp, P[0], P[1], P[2], "DOC_ADDED", None, None,
                              f"Document added: {name} (SHA-256 {sha[:16]}…)" + (f" — {note}" if note else ""))
    conn.execute("INSERT INTO documents(case_id,seq,filename,path,sha256,size,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?)",
                 (case_id, seq, name, str(path), sha, len(raw), P[1], stamp))
    conn.execute("UPDATE cases SET last_action=?, last_action_at=? WHERE case_id=?",
                 (f"Document added: {name}", stamp, case_id))
    conn.commit()
    events.publish("case.updated", {"case_id": case_id})
    d = db.one(conn, "SELECT * FROM documents WHERE case_id=? ORDER BY id DESC LIMIT 1", (case_id,))
    return _doc_view(d)


@router.get("/api/documents/{doc_id}/download")
def download_document(doc_id: int, conn=Depends(db.get_conn)):
    d = db.one(conn, "SELECT * FROM documents WHERE id=?", (doc_id,))
    if not d or not Path(d["path"]).exists():
        raise HTTPException(404, "document not found")
    return FileResponse(d["path"], filename=d["filename"], content_disposition_type="attachment",
                        headers={"X-Content-Type-Options": "nosniff", "Content-Type": "application/octet-stream"})
