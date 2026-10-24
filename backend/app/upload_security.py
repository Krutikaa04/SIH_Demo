"""Document extension and signature checks (no optional packages)."""
import io
import os
import struct
import zipfile
from pathlib import Path

from .security import setting_int

MAX_BYTES = setting_int("AICTE_MAX_UPLOAD_BYTES", 2 * 1024 * 1024)
DEFAULT_EXTENSIONS = "pdf,png,jpg,txt,docx,xlsx"
ALLOWED = {"." + x.strip().lower().lstrip(".") for x in os.getenv("AICTE_UPLOAD_EXTENSIONS", DEFAULT_EXTENSIONS).split(",") if x.strip()}
MIME = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
        ".txt": "text/plain", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


def allowed_document(filename, raw):
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED or ext not in MIME:
        return False
    if ext == ".pdf":
        return raw.startswith(b"%PDF-")
    if ext == ".png":
        return raw.startswith(b"\x89PNG\r\n\x1a\n") and len(raw) >= 24 and raw[12:16] == b"IHDR"
    if ext == ".jpg":
        return raw.startswith(b"\xff\xd8\xff") and raw.endswith(b"\xff\xd9")
    if ext == ".txt":
        if b"\x00" in raw:
            return False
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeError:
            return False
        return not content.lstrip().lower().startswith(("<!doctype html", "<html", "<script", "<?xml"))
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = set(archive.namelist())
            if len(names) > 300 or any(n.startswith("/") or ".." in Path(n).parts for n in names):
                return False
            if sum(i.file_size for i in archive.infolist()) > 25 * 1024 * 1024:
                return False
            if any("vbaproject" in n.lower() or "activex" in n.lower() or n.lower().endswith((".exe", ".js", ".html")) for n in names):
                return False
            folder = "word/document.xml" if ext == ".docx" else "xl/workbook.xml"
            return "[Content_Types].xml" in names and folder in names
    except (zipfile.BadZipFile, OSError, ValueError, RuntimeError):
        return False
