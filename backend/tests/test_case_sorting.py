"""Unit tests for case listing sort options and action fields (Issue #16)."""
import pytest


def test_case_list_returns_action_fields(client, as_role):
    res = client.get("/api/cases?page_size=10", headers=as_role("SENIOR"))
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert len(data["items"]) > 0
    first = data["items"][0]
    assert "last_action" in first
    assert "last_action_at" in first
    assert "next_action" in first
    assert "expected_disposal" in first


@pytest.mark.parametrize("sort_key,field,descending", [
    ("received_desc", "received_on", True),
    ("received_asc", "received_on", False),
    ("due_asc", "expected_disposal", False),
    ("due_desc", "expected_disposal", True),
])
def test_case_sorting_dates(client, as_role, sort_key, field, descending):
    res = client.get(f"/api/cases?sort={sort_key}&page_size=25", headers=as_role("SENIOR"))
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) > 1
    values = [item[field] for item in items if item[field] is not None]
    if descending:
        assert all(values[i] >= values[i + 1] for i in range(len(values) - 1))
    else:
        assert all(values[i] <= values[i + 1] for i in range(len(values) - 1))


def test_case_sorting_severity(client, as_role):
    res_desc = client.get("/api/cases?sort=severity_desc&page_size=25", headers=as_role("SENIOR"))
    assert res_desc.status_code == 200
    items_desc = res_desc.json()["items"]
    sev_desc = [item["severity"] for item in items_desc]
    assert all(sev_desc[i] >= sev_desc[i + 1] for i in range(len(sev_desc) - 1))

    res_asc = client.get("/api/cases?sort=severity_asc&page_size=25", headers=as_role("SENIOR"))
    assert res_asc.status_code == 200
    items_asc = res_asc.json()["items"]
    sev_asc = [item["severity"] for item in items_asc]
    assert all(sev_asc[i] <= sev_asc[i + 1] for i in range(len(sev_asc) - 1))
