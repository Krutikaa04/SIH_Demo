"""Public method/path inventory captured before splitting main.py."""
from app.main import app

EXPECTED_ROUTES = [('GET', '/api/alerts'),
 ('GET', '/api/audit/verify'),
 ('GET', '/api/briefings/executive'),
 ('GET', '/api/cases'),
 ('GET', '/api/cases/{case_id}'),
 ('GET', '/api/cases/{case_id}/documents'),
 ('GET', '/api/cases/{case_id}/history'),
 ('GET', '/api/clock'),
 ('GET', '/api/dashboard/summary'),
 ('GET', '/api/documents/{doc_id}/download'),
 ('GET', '/api/events'),
 ('GET', '/api/export/cases'),
 ('GET', '/api/galaxy/graph'),
 ('GET', '/api/institutions'),
 ('GET', '/api/institutions/{aicte_id}'),
 ('GET', '/api/meta'),
 ('GET', '/api/meta/officers'),
 ('GET', '/api/overlaps'),
 ('GET', '/api/overlaps/{pair_id}'),
 ('GET', '/api/reports/{kind}'),
 ('GET', '/api/rooms/{room_id}'),
 ('GET', '/api/search/nl'),
 ('GET', '/{full_path}'),
 ('POST', '/api/admin/clock'),
 ('POST', '/api/admin/reset'),
 ('POST', '/api/admin/restore-tamper'),
 ('POST', '/api/admin/tamper'),
 ('POST', '/api/alerts/read-all'),
 ('POST', '/api/alerts/{alert_id}/read'),
 ('POST', '/api/cases/{case_id}/actions'),
 ('POST', '/api/cases/{case_id}/documents'),
 ('POST', '/api/complaints'),
 ('POST', '/api/complaints/import'),
 ('POST', '/api/complaints/preview'),
 ('POST', '/api/overlaps/{pair_id}/review'),
 ('POST', '/api/rooms'),
 ('POST', '/api/rooms/{room_id}/comments'),
 ('POST', '/api/rooms/{room_id}/decision'),
 ('POST', '/api/rooms/{room_id}/lead'),
 ('POST', '/api/simulate/complaint')]


def test_public_routes_are_preserved():
    actual = sorted((method.upper(), path) for path, methods in app.openapi()["paths"].items()
                    for method in methods if method in {"get", "post", "put", "delete", "patch", "head", "options"})
    assert actual == EXPECTED_ROUTES
