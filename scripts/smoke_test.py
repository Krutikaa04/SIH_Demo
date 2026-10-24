"""Pre-demo smoke test. Start the app first (python run.py), then:   python scripts/smoke_test.py

Runs the whole 3-minute demo flow twice (resetting in between), sweeps every read endpoint for every role,
and prints latencies. It RESETS the demo data at the start and at the end, so the app is left pristine.
"""
import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/api"
OK, BAD = "✔", "✘"
failures = []


def call(path, method="GET", body=None, role="SENIOR", region="Western", raw=False):
    h = {"Content-Type": "application/json", "X-Role": role, "X-Region": region}
    req = urllib.request.Request(BASE + path, method=method, headers=h,
                                 data=json.dumps(body).encode() if body is not None else None)
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, (data.decode("utf-8-sig") if raw else json.loads(data or b"null")), time.time() - t
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200], time.time() - t


def check(name, cond, extra=""):
    print(f"  {OK if cond else BAD} {name} {extra}")
    if not cond:
        failures.append(name)


def flow(round_no):
    print(f"\n=== Demo flow, round {round_no} ===")
    s, _, _ = call("/admin/reset", "POST")
    check("reset", s == 200)
    _, d, _ = call("/dashboard/summary")
    check("300 cases seeded", d["totals"]["received"] == 300, f"({d['totals']['received']})")
    check("11 open overlap clusters", d["overlap"]["open_clusters"] == 11, f"({d['overlap']['open_clusters']})")
    check("briefing present for Senior", len(d["briefing"]) >= 4)

    _, nl, _ = call("/search/nl?q=" + urllib.parse.quote("pending RB cases in Western region older than 30 days"))
    _, res, _ = call("/cases?page_size=1&" + urllib.parse.urlencode(nl["params"]))
    check("NL search understood 4 filters and finds cases", len(nl["chips"]) == 4 and res["total"] >= 3, f"({res['total']} cases)")

    _, ov, _ = call("/overlaps")
    hero = next(c for c in ov["items"] if "Sahyadri" in c["institution"]["name"])
    check("hero overlap HIGH across RB/PGRC/AB", hero["band"] == "HIGH" and set(hero["bureaus"]) == {"RB", "PGRC", "AB"})
    _, inst, _ = call(f"/institutions/{hero['institution']['aicte_id']}")
    check("hero institution is high risk", inst["risk"]["band"] == "HIGH", f"(risk {inst['risk']['score']})")

    # --- register a complaint through the pipeline (misspelt name, no ID) and hit the coordination guard
    new = {"institution_name": "Kaveri Inst of Technology Bangalore", "bureau": "PGRC", "category": "Infrastructure Deficiency",
           "description": "Students say laboratory machines are broken and the library has been closed for a long time.",
           "severity": 4, "source": "Email"}
    _, pv, _ = call("/complaints/preview", "POST", new, role="PGRC")
    check("form preview resolves the misspelt name and warns of an overlap",
          pv["resolution"] and pv["resolution"]["method"] == "NAME" and any(o["band"] == "HIGH" for o in pv["potential_overlaps"]))
    s, reg, _ = call("/complaints", "POST", new, role="PGRC")
    check("complaint registered with overlap alert", s == 200 and reg["overlaps"] and reg["overlaps"][0]["band"] == "HIGH",
          f"({reg['case']['case_id']})" if s == 200 else str(reg))
    s, dup, _ = call("/complaints", "POST", new, role="PGRC")
    check("exact duplicate is rejected", s == 400)
    new_id = urllib.parse.quote(reg["case"]["case_id"], safe="")
    s, _, _ = call(f"/cases/{new_id}/actions", "POST", {"type": "escalate", "remarks": "x"}, role="PGRC")
    check("guard: acting on an overlapping case needs acknowledgement (409)", s == 409)
    s, _, _ = call(f"/cases/{new_id}/actions", "POST", {"type": "escalate", "remarks": "Escalating after checking with RB", "acknowledge_overlap": True}, role="PGRC")
    check("guard: acknowledged action goes through and is logged", s == 200)
    csv_text = "institution_name,bureau,category,description\nSahyadri Govt Coll Poona,RB,Faculty Deficiency,Regular teachers are missing in two departments.\nNowhere Institute Atlantis,RB,Faculty Deficiency,Shortage of teachers reported by students.\n"
    _, imp, _ = call("/complaints/import", "POST", {"csv_text": csv_text, "dry_run": True}, role="RB")
    check("CSV import dry-run: 1 ready, 1 needs review", imp["counts"]["ok"] == 1 and imp["counts"]["needs_review"] == 1)

    _, room, _ = call("/rooms", "POST", {"cluster_id": hero["cluster_id"]})
    call(f"/rooms/{room['id']}/comments", "POST", {"body": "RB will lead; PGRC to forward student statements."}, role="RB")
    call(f"/rooms/{room['id']}/lead", "POST", {"lead_bureau": "RB"})
    s403, _, _ = call(f"/rooms/{room['id']}/decision", "POST", {"outcome": "MERGE", "note": "x"}, role="PGRC")
    check("non-lead Bureau cannot record the decision (403)", s403 == 403)
    _, room, _ = call(f"/rooms/{room['id']}/decision", "POST", {"outcome": "MERGE", "note": "Single show-cause notice by RB"})
    check("decision recorded", room["status"] == "MERGED")
    hero_pg = next(c for c in room["cases"] if c["bureau"] == "PGRC")
    hero_pg_id = urllib.parse.quote(hero_pg["case_id"], safe="")
    s, _, _ = call(f"/cases/{hero_pg_id}/actions", "POST", {"type": "transfer", "to_bureau": "AB", "remarks": "x"}, role="PGRC")
    check("guard: follower Bureau cannot transfer after MERGE (403)", s == 403)
    s, _, _ = call(f"/cases/{hero_pg_id}/actions", "POST", {"type": "remark", "remarks": "Statements forwarded to RB"}, role="PGRC")
    check("guard: follower Bureau can still add remarks", s == 200)
    _, d, _ = call("/dashboard/summary")
    check("effort-saved counter ticks", d["effort_saved"]["clusters_resolved"] == 1)

    other_inst = call("/institutions")[1]["items"][-1]["aicte_id"]
    s, parked, _ = call("/complaints", "POST", {"institution_name": "Zzyzx Quorlfplat Institute of Nothing", "bureau": "RB",
                                               "category": "Faculty Deficiency", "park_unmatched": True,
                                               "description": "Students report that faculty positions are vacant and visiting teachers take classes."})
    check("unmatched complaint is parked, not lost", s == 200 and parked["status"] == "PARKED")
    _, q, _ = call("/unmatched")
    check("review queue lists it", [i["id"] for i in q["items"]] == [parked["queue_id"]])
    s, _, _ = call(f"/unmatched/{parked['queue_id']}/resolve", "POST", {"institution_id": other_inst}, role="PGRC")
    check("another Bureau cannot resolve it (403)", s == 403)
    s, res, _ = call(f"/unmatched/{parked['queue_id']}/resolve", "POST", {"institution_id": other_inst}, role="RB")
    check("receiving Bureau resolves it into a real case", s == 200 and res["case"]["case_id"] and not res["already_resolved"])
    _, q, _ = call("/unmatched")
    check("queue is empty after resolving", q["counts"]["OPEN"] == 0 and q["counts"]["RESOLVED"] == 1)

    _, pool, _ = call("/cases?page_size=200")
    free = {}
    for c in pool["items"]:
        if not c["overlap"] and c["status"] != "Disposed" and c["institution"]["aicte_id"]:
            free.setdefault(c["institution"]["aicte_id"], []).append(c)
    pair = next(([a, b] for cs in free.values() for a in cs for b in cs
                 if a["bureau"] != b["bureau"] and a["case_id"] < b["case_id"]), None)
    check("two unlinked open cases exist at one institution", pair is not None)
    a, b = pair
    outsider = next(x for x in ("RB", "PGRC", "AB", "LC", "VIG") if x not in (a["bureau"], b["bureau"]))
    link = {"case_a": a["case_id"], "case_b": b["case_id"], "rationale": "Same grievance in different words"}
    s, _, _ = call("/links", "POST", link, role=outsider)
    check("manual link: a Bureau owning neither case is refused (403)", s == 403)
    s, _, _ = call("/links", "POST", link, role="REGIONAL")
    check("manual link: Regional Office is refused (403)", s == 403)
    s, made, _ = call("/links", "POST", link, role=a["bureau"])
    check("manual link: owning Bureau links the cases", s == 200 and made["created"] and made["pair"]["type"] == "MANUAL")
    s, again, _ = call("/links", "POST", link)
    check("manual link is idempotent", s == 200 and not again["created"] and again["pair"]["id"] == made["pair"]["id"])
    _, ov, _ = call("/overlaps")
    check("manual link shows up in the overlaps list",
          any(p["type"] == "MANUAL" for cl in ov["items"] for p in cl["pairs"]))
    _, room2, _ = call("/rooms", "POST", {"cluster_id": made["cluster_id"]})
    check("manual link can be opened as a Coordination Room", len(room2["cases"]) == 2 and room2["can_manage_members"])

    _, a0, _ = call("/alerts?unread=1")
    t = time.time()
    s, sim, _ = call("/simulate/complaint", "POST", {})
    ms = (time.time() - t) * 1000
    check("simulate fires HIGH overlap", s == 200 and sim["overlaps"] and sim["overlaps"][0]["band"] == "HIGH",
          f"({sim['overlaps'][0]['score']}% in {ms:.0f} ms)" if s == 200 and sim["overlaps"] else "")
    _, a1, _ = call("/alerts?unread=1")
    check("alert raised", a1["unread"] > a0["unread"])
    _, a_pg, _ = call("/alerts?limit=400", role="PGRC")
    _, a_all, _ = call("/alerts?limit=400", role="SENIOR")
    check("alerts are role-targeted: PGRC sees only PGRC-addressed or untargeted alerts",
          all((not x["target_bureaus"]) or "PGRC" in x["target_bureaus"] for x in a_pg["items"]))
    check("Senior Management sees more alerts than a single Bureau", len(a_all["items"]) > len(a_pg["items"]))
    check("PGRC unread count matches its own visible list",
          a_pg["unread"] == sum(1 for x in a_pg["items"] if not x["read"]))

    _, desk, _ = call("/dashboard/summary", role="PGRC")
    check("PGRC sees 'My desk'", desk["desk"] and desk["desk"]["bureau"] == "PGRC")
    rb_case = next(c for c in call("/cases?bureau=RB&status=Pending&page_size=5")[1]["items"])
    s, _, _ = call(f"/cases/{urllib.parse.quote(rb_case['case_id'], safe='')}/actions", "POST", {"type": "remark", "remarks": "x"}, role="PGRC")
    check("PGRC cannot act on an RB case (403)", s == 403)
    s, _, _ = call(f"/cases/{urllib.parse.quote(rb_case['case_id'], safe='')}/actions", "POST", {"type": "remark", "remarks": "Reply sought"}, role="RB")
    check("RB can act on its own case", s == 200)

    _, d0, _ = call("/dashboard/summary")
    _, clk, _ = call("/admin/clock", "POST", {"add_days": 7})
    _, d1, _ = call("/dashboard/summary")
    check("time machine auto-escalates cases", clk["sla"]["escalated"] >= 5 and d1["totals"]["beyond_sla"] > d0["totals"]["beyond_sla"],
          f"({clk['sla']['escalated']} escalated, beyond-timeline {d0['totals']['beyond_sla']}→{d1['totals']['beyond_sla']})")

    check("audit trail intact", call("/audit/verify")[1]["ok"])
    call("/admin/tamper", "POST", {})
    v = call("/audit/verify")[1]
    check("tamper detected and located", (not v["ok"]) and v["first_break"]["seq"] == 2)

    for kind in ["bureau", "region", "institution", "ageing", "disposal", "overlaps", "periodic"]:
        s, r, _ = call(f"/reports/{kind}")
        check(f"report: {kind}", s == 200 and len(r["rows"]) > 0)
    s, csv_text, _ = call("/reports/bureau?format=csv", raw=True)
    check("CSV export", s == 200 and csv_text.count("\n") >= 6)
    case_id = rb_case["case_id"]
    content = base64.b64encode(b"synthetic test document").decode()
    s, doc, _ = call(f"/cases/{urllib.parse.quote(case_id, safe='')}/documents", "POST",
                     {"filename": "reply.txt", "content_base64": content}, role="RB")
    check("document upload verified", s == 200 and doc["verified"])


def sweep():
    print("\n=== Read-endpoint sweep for every role (no 5xx allowed) ===")
    paths = ["/meta", "/clock", "/dashboard/summary", "/cases?page_size=5", "/cases?overdue=1", "/cases?overlap=1",
             "/institutions", "/overlaps", "/overlaps?status=all", "/alerts", "/reports/bureau", "/reports/periodic?period=quarter",
             "/search/nl?q=escalated%20faculty%20cases", "/audit/verify", "/export/cases?bureau=RB", "/unmatched"]
    slow = []
    for role in ["RB", "PGRC", "AB", "LC", "VIG", "REGIONAL", "SENIOR"]:
        for p in paths:
            s, _, dt = call(p, role=role, region="Southern", raw=p.startswith("/export"))
            if s >= 500:
                check(f"{role} {p}", False, f"-> HTTP {s}")
            if dt > 1.0:
                slow.append((role, p, round(dt, 2)))
    check("no server errors across roles", not any("->" in f for f in failures))
    check("every endpoint answered in < 1 s", not slow, str(slow))
    for p in ["/dashboard/summary", "/cases?page_size=25", "/overlaps", "/institutions"]:
        times = [call(p)[2] for _ in range(3)]
        print(f"  latency {p}: {min(times) * 1000:.0f} ms")


if __name__ == "__main__":
    try:
        flow(1)
        flow(2)
        call("/admin/reset", "POST")
        sweep()
    finally:
        call("/admin/reset", "POST")
    print("\n" + ("ALL CHECKS PASSED" if not failures else f"{len(failures)} FAILED: {failures}"))
    sys.exit(1 if failures else 0)
