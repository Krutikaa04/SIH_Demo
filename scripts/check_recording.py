"""Check a running recording instance using GET requests only."""
import argparse
from contextlib import contextmanager
from http.cookiejar import CookieJar
import json
import re
import time
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener


HERO = "1-4520311"
MAX_RESPONSE = 8 * 1024 * 1024


def reader(base, opener=None):
    opener = opener or build_opener()
    def get(path):
        start = time.monotonic()
        request = Request(base + path, method="GET")
        with opener.open(request, timeout=8) as response:
            content = response.read(MAX_RESPONSE + 1)
            if len(content) > MAX_RESPONSE:
                raise ValueError("Response exceeds the recording-check size limit")
            return response.headers.get("Content-Type", ""), content, round((time.monotonic() - start) * 1000)
    return get


@contextmanager
def demo_reader(base):
    if urlsplit(base).hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("Demo sign-in is supported only on a loopback recording instance")
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    get = reader(base, opener)
    _, raw, _ = get("/api/auth/config")
    config = json.loads(raw)
    if not config.get("demo_mode") or not config.get("demo_password"):
        raise ValueError("This instance does not expose demo sign-in; no credentials were attempted")
    request = Request(base + "/api/auth/login", method="POST", headers={"Content-Type": "application/json"},
                      data=json.dumps({"username": "senior", "password": config["demo_password"]}).encode())
    with opener.open(request, timeout=8) as response:
        user = json.load(response)["user"]
    try:
        if user.get("role") != "SENIOR":
            raise ValueError("Recording preflight requires the Senior Management demo account")
        yield get
    finally:
        with opener.open(Request(base + "/api/auth/logout", method="POST", data=b"{}",
                                 headers={"Content-Type": "application/json"}), timeout=8):
            pass


def inspect(get, innovation=False):
    checks = []

    def check(name, fn):
        try:
            detail = fn()
            checks.append({"name": name, "status": "PASS", "detail": detail})
        except Exception as error:
            checks.append({"name": name, "status": "FAIL", "detail": str(error)})

    def require(condition, message):
        if not condition:
            raise ValueError(message)

    def payload(path):
        kind, content, elapsed = get(path)
        require("json" in kind.lower(), f"{path} returned {kind or 'no content type'}, expected JSON")
        data = json.loads(content)
        require(isinstance(data, dict), f"{path} did not return a JSON object")
        if elapsed > 1500:
            checks.append({"name": "Response time", "status": "WARN", "detail": f"{path}: {elapsed} ms"})
        return data

    def frontend():
        kind, raw, _ = get("/")
        html = raw.decode("utf-8")
        require("html" in kind.lower() and 'id="root"' in html, "Built frontend is missing")
        assets = set(re.findall(r'(?:src|href)=[\"\'](/assets/[^\"\']+)', html))
        require(any(asset.endswith(".js") for asset in assets), "No built JavaScript entry in index.html")
        for asset in sorted(assets):
            asset_type, content, _ = get(asset)
            require(bool(content) and "html" not in asset_type.lower(), f"Missing built asset: {asset}")
        return f"HTML and {len(assets)} bundled entry assets are reachable"

    def metadata():
        data = payload("/api/meta")
        require({b["code"] for b in data["bureaus"]} == {"RB", "PGRC", "AB", "LC", "VIG"}, "Bureau metadata mismatch")
        require(len(data["regions"]) == 8, "Expected eight prototype regions")
        return "Five Bureaus and eight regions available"

    def clock():
        data = payload("/api/clock")
        require(data["offset_days"] == 0, "Demo clock is advanced; use a fresh recording database before the take")
        return f"No simulated date offset; server clock {data['now']}"

    def audit():
        data = payload("/api/audit/verify")
        require(data.get("ok") is True and data.get("checked", 0) > 0, f"Audit chain is not ready: {data.get('first_break')}")
        return f"{data['checked']} audit records verified"

    def dashboard():
        data = payload("/api/dashboard/summary")
        require(data.get("role") == "SENIOR", "Expected Senior Management demo scope")
        require(data["totals"]["received"] > 0 and data["totals"]["pending"] > 0, "No complaint workload to demonstrate")
        return f"{data['totals']['received']} complaints; {data['totals']['pending']} open"

    def hero():
        data = payload("/api/overlaps")
        cluster = next((c for c in data["items"] if c["institution"]["aicte_id"] == HERO), None)
        require(cluster is not None, "The Sahyadri overlap is absent; start a fresh take database")
        require(cluster["status"] in ("OPEN", "LINKED"), "The hero overlap is already settled")
        require({"RB", "PGRC", "AB"}.issubset(cluster["bureaus"]), "Hero overlap is missing a participating Bureau")
        return f"{cluster['cluster_id']}: RB, PGRC and AB evidence available"

    def innovations():
        schema = payload("/openapi.json")
        required = {"/api/reports/{kind}", "/api/briefings/executive",
                    "/api/institutions/{institution_id}/aftercare", "/api/rooms/{room_id}/commitments"}
        require(required.issubset(schema.get("paths", {})), "Innovation endpoints missing; verify the merge sequence and restart the server")
        briefing = payload("/api/briefings/executive")
        require("action_agenda" in briefing and briefing.get("region") == "", "Scoped action agenda is missing")
        report = payload("/api/reports/coordination")
        require(report.get("kind") == "coordination" and "methodology" in report, "Recorded-outcomes report is missing")
        aftercare = payload(f"/api/institutions/{HERO}/aftercare")
        require(aftercare.get("institution_id") == HERO, "Aftercare response does not match the hero institution")
        return "Agenda, outcomes, aftercare and commitments API contracts present"

    for name, fn in [("Built UI", frontend), ("Metadata", metadata), ("Demo clock", clock),
                     ("Audit integrity", audit), ("Dashboard", dashboard), ("Hero story", hero)]:
        check(name, fn)
    if innovation:
        check("Innovation features", innovations)
    return {"ready": not any(c["status"] == "FAIL" for c in checks), "checks": checks,
            "scope": "GET-only operational checks; no reset, registration, clock or workflow mutations"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:8000", help="App root URL, without /api")
    parser.add_argument("--innovation", action="store_true", help="Require the full innovation recording batch")
    parser.add_argument("--demo-login", action="store_true", help="Sign in/out using the published local demo account; operational checks remain GET-only")
    parser.add_argument("--json", action="store_true", help="Print machine-readable results")
    args = parser.parse_args()
    base = args.url.rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        parser.error("Use an http(s) app root such as http://127.0.0.1:8000")
    try:
        if args.demo_login:
            with demo_reader(base) as get:
                result = inspect(get, args.innovation)
            result["scope"] += "; demo sign-in/out records an authentication session only"
        else:
            result = inspect(reader(base), args.innovation)
    except Exception as error:
        result = {"ready": False, "checks": [{"name": "Demo authentication", "status": "FAIL", "detail": str(error)}],
                  "scope": "No operational mutations attempted"}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for check in result["checks"]:
            print(f"{check['status']:4}  {check['name']}: {check['detail']}")
        print("READY FOR REHEARSAL" if result["ready"] else "NOT READY: resolve failed checks before recording")
        print(result["scope"])
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
