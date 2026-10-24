"""Issue #23 — input/response limits and request throttling."""
import base64

from app import extras, security


def _case(conn):
    return conn.execute("SELECT case_id FROM cases WHERE bureau_code='RB' AND status!='Disposed' LIMIT 1").fetchone()[0]


def _upload(client, case_id, filename, content):
    return client.post(f"/api/cases/{case_id}/documents", json={
        "filename": filename, "content_base64": base64.b64encode(content).decode(), "remarks": "Test"
    }, headers={"X-Role": "RB"})


def test_disallowed_documents(client, conn, tmp_path, monkeypatch):
    monkeypatch.setattr(extras, "UPLOADS", tmp_path)
    for name, data in (("evil.exe", b"MZ"), ("page.html", b"<script>alert(1)</script>"),
                       ("vector.svg", b"<svg><script>alert(1)</script></svg>"),
                       ("spoof.pdf", b"not-a-pdf"), ("spoof.png", b"fake-image")):
        assert _upload(client, _case(conn), name, data).status_code == 415


def test_valid_documents_and_download(client, conn, tmp_path, monkeypatch):
    monkeypatch.setattr(extras, "UPLOADS", tmp_path)
    for filename, raw in (("memo.txt", b"Simple document"),
                          ("note.pdf", b"%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF"),
                          ("image.png", b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + b"0" * 30)):
        r = _upload(client, _case(conn), filename, raw)
        assert r.status_code == 200, r.text
        response = client.get(f"/api/documents/{r.json()['id']}/download")
        assert response.status_code == 200
        assert "attachment" in response.headers["content-disposition"].lower()
        assert response.headers["x-content-type-options"] == "nosniff"


def test_upload_over_two_megabytes(client, conn):
    r = _upload(client, _case(conn), "large.txt", b"x" * (2 * 1024 * 1024 + 1))
    assert r.status_code == 413


def test_json_size_cap(client):
    response = client.post("/api/complaints/preview", content=b" " * (4 * 1024 * 1024 + 1),
                           headers={"content-type": "application/json"})
    assert response.status_code == 413


def test_description_and_name_limits(client, conn):
    category = conn.execute("SELECT category FROM cases LIMIT 1").fetchone()[0]
    common = {"bureau": "RB", "category": category, "source": "Letter",
              "institution_name": "A college", "description": "A" * 5001}
    r = client.post("/api/complaints", json=common)
    assert r.status_code == 400 and "5000" in r.text
    common.update({"institution_name": "x" * 201, "description": "ordinary description"})
    r = client.post("/api/complaints", json=common)
    assert r.status_code == 400 and "200" in r.text


def test_csv_row_limit(client):
    r = client.post("/api/complaints/import", json={"csv_text": "institution_name,description\n" + "x" * 10001})
    assert r.status_code == 400 and "10000" in r.text


def test_security_headers(client):
    r = client.get("/api/meta")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" in r.headers
    assert "referrer-policy" in r.headers


def test_rate_limit_with_fake_clock(client, monkeypatch):
    instant = [100.0]
    monkeypatch.setattr(security.limiter, "clock", lambda: instant[0])
    monkeypatch.setattr(security.limiter, "limit", 2)
    monkeypatch.setenv("AICTE_RATE_LIMIT_ENABLED", "1")
    security.limiter.clear()
    try:
        assert client.post("/api/alerts/read-all").status_code != 429
        assert client.post("/api/alerts/read-all").status_code != 429
        r = client.post("/api/alerts/read-all")
        assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
        instant[0] += 61
        assert client.post("/api/alerts/read-all").status_code != 429
    finally:
        security.limiter.clear()
