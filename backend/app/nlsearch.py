"""Rule-based natural-language search parser.

Turns e.g. "pending RB cases in Western region older than 30 days" into the same filters the Cases page
uses, and reports exactly what it understood (chips). No LLM: a small, explainable grammar over known vocabulary.
"""
import re
from datetime import date, timedelta

from rapidfuzz import fuzz

from . import db, intel
from .constants import BUREAUS, CATEGORIES, REGION_STATES

STATUS_RULES = [
    (r"\bpending info\b|\bawaiting (?:info|information|reply)\b", "status", "Pending Info", "Status: Pending Info"),
    (r"\bunder[ -]?process(?:ing)?\b|\bin progress\b", "status", "Under Process", "Status: Under Process"),
    (r"\btransferred\b|\breferred\b", "status", "Transferred", "Status: Transferred"),
    (r"\bescalated\b|\bescalations?\b", "status", "Escalated", "Status: Escalated"),
    (r"\bdisposed\b|\bclosed\b|\bresolved\b|\bsettled\b", "status", "Disposed", "Status: Disposed"),
    (r"\bpending\b|\bopen\b|\bunresolved\b|\boutstanding\b", "status", "Pending", "Status: Pending (not disposed)"),
]
FLAG_RULES = [
    (r"\boverdue\b|\bbeyond (?:the |its |their )?(?:prescribed )?(?:timelines?|sla|deadline)\b|\bbreached\b|\bdelayed\b"
     r"|\bpast (?:the |its )?(?:timeline|sla|deadline)\b", "overdue", "1", "Beyond timeline"),
    (r"\bnearing\b|\bapproaching\b|\bclose to (?:the )?(?:timeline|sla|deadline)\b|\babout to breach\b",
     "nearing", "1", "Nearing timeline"),
    (r"\boverlap(?:ping|s)?\b|\bduplicates?\b|\bmultiple bureaus\b", "overlap", "1", "In an overlap"),
]
BUREAU_RULES = [
    ("RB", r"\brb\b|\bregulation(?: bureau)?\b"),
    ("PGRC", r"\bpgrc\b|\bgrievance(?: redressal)?(?: cell)?\b"),
    ("AB", r"\bab\b|\bapproval bureau\b"),
    ("LC", r"\blc\b|\blegal(?: cell)?\b"),
    ("VIG", r"\bvig\b|\bvigilance(?: cell)?\b"),
]
CATEGORY_RULES = [
    (r"\bfaculty\b|\bteachers?\b|\bteaching staff\b", "Faculty Deficiency"),
    (r"\bfees?\b|\brefunds?\b|\bovercharg\w*", "Fee Overcharging / Refund"),
    (r"\bragging\b|\bharass\w*|\bsafety\b", "Ragging / Safety"),
    (r"\badmissions?\b", "Admission Irregularity"),
    (r"\bplacements?\b", "Placement Misrepresentation"),
    (r"\binfrastructure\b|\blab(?:oratories|s)?\b|\blibrary\b|\bhostel\b", "Infrastructure Deficiency"),
    (r"\bintake\b", "Excess Intake / Approval Violation"),
    (r"\baffiliation\b", "Affiliation / Approval Dispute"),
    (r"\bunapproved\b|\bwithout approval\b", "Unapproved Programme"),
    (r"\bfinancial\b|\bcorruption\b|\bbribe\w*|\bmisappropriation\b", "Financial Irregularity"),
    (r"\bdocuments?\b|\bcertificates?\b", "Document Withholding"),
    (r"\bacademic\b|\bexams?\b", "Academic Quality"),
]
STOP = set("""a an the all any of in on at for to from by with about and or show me list find get give cases case complaints
complaint those that which are is was were have has handled handling being under within region regions office offices
bureau cell institution institutions college colleges please what where who whose their its it this these older than
more over last past days day weeks week months month years year
received filed raised regarding timeline timelines sla deadline sorted""".split())
UNIT = {"day": 1, "week": 7, "month": 30, "year": 365}


def _cut(text, m):
    return text[: m.start()] + " " + text[m.end():]


def parse(conn, raw):
    q = (raw or "").strip()
    text = " " + q.lower() + " "
    params, chips = {}, []

    def chip(field, label, value=None):
        chips.append({"field": field, "label": label, "value": value})

    # explicit identifiers
    m = re.search(r"\b1-\d{7}\b", text)
    if m:
        params["institution_id"] = m.group(0)
        chip("institution_id", f"AICTE ID: {m.group(0)}", m.group(0))
        text = _cut(text, m)
    m = re.search(r"\b([a-z]{2,4})/(\d{4})/(\d{5})\b", text)
    if m:
        params["q"] = m.group(0).upper()
        chip("q", f"Case ID: {m.group(0).upper()}", params["q"])
        text = _cut(text, m)

    # age expressions
    m = re.search(r"\b(?:older|more|greater|longer|over|above)\s+(?:than\s+)?(\d+)\s*(day|week|month|year)s?\b", text)
    if m:
        n = int(m.group(1)) * UNIT[m.group(2)]
        params["age_gt"] = n
        chip("age_gt", f"Older than {m.group(1)} {m.group(2)}{'s' if m.group(1) != '1' else ''}", n)
        text = _cut(text, m)
    m = re.search(r"\b(?:within|in|during)?\s*(?:the\s+)?(?:last|past)\s+(\d+)\s*(day|week|month|year)s?\b", text)
    if m:
        n = int(m.group(1)) * UNIT[m.group(2)]
        params["age_lt"] = n
        chip("age_lt", f"Received in the last {m.group(1)} {m.group(2)}{'s' if m.group(1) != '1' else ''}", n)
        text = _cut(text, m)
    today = db.now(conn).date()
    for pat, label, fn in [
        (r"\bthis week\b", "Received this week", lambda: ("age_lt", 7)),
        (r"\btoday\b", "Received today", lambda: ("age_lt", 1)),
        (r"\bthis month\b", "Received this month", lambda: ("date_from", str(today.replace(day=1)))),
        (r"\bthis year\b", "Received this year", lambda: ("date_from", str(today.replace(month=1, day=1)))),
    ]:
        m = re.search(pat, text)
        if m:
            k, v = fn()
            params[k] = v
            chip(k, label, v)
            text = _cut(text, m)
    m = re.search(r"\blast month\b", text)
    if m:
        first = today.replace(day=1)
        prev_end = first - timedelta(days=1)
        params["date_from"], params["date_to"] = str(prev_end.replace(day=1)), str(prev_end)
        chip("date_from", "Received last month")
        text = _cut(text, m)
    m = re.search(r"\bsince\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b", text)
    if m:
        months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
                  "november", "december"]
        mi = months.index(m.group(1)) + 1
        yr = today.year if mi <= today.month else today.year - 1
        params["date_from"] = str(date(yr, mi, 1))
        chip("date_from", f"Received since {m.group(1).title()}", params["date_from"])
        text = _cut(text, m)

    # status & flags
    for pat, field, value, label in STATUS_RULES:
        m = re.search(pat, text)
        if m and "status" not in params:
            params[field] = value
            chip(field, label, value)
            text = _cut(text, m)
    for pat, field, value, label in FLAG_RULES:
        m = re.search(pat, text)
        if m:
            params[field] = value
            chip(field, label, value)
            text = _cut(text, m)

    # bureau
    for code, pat in BUREAU_RULES:
        m = re.search(pat, text)
        if m and "bureau" not in params:
            params["bureau"] = code
            chip("bureau", f"Bureau: {code} — {BUREAUS[code]}", code)
            text = _cut(text, m)

    # region (longest names first so "south-western" is not read as "western")
    names = sorted(REGION_STATES, key=len, reverse=True)
    for name in names:
        pat = r"\b" + name.lower().replace("-", "[- ]?") + r"(?:\s+region)?\b"
        m = re.search(pat, text)
        if m and "region" not in params:
            params["region"] = name
            chip("region", f"Region: {name}", name)
            text = _cut(text, m)
    if "region" not in params:
        for reg, states in REGION_STATES.items():
            for st in states:
                m = re.search(r"\b" + re.escape(st.lower()) + r"\b", text)
                if m:
                    params["region"] = reg
                    chip("region", f"Region: {reg} ({st})", reg)
                    text = _cut(text, m)
                    break
            if "region" in params:
                break

    # category
    for pat, cat in CATEGORY_RULES:
        m = re.search(pat, text)
        if m and "category" not in params:
            params["category"] = cat
            chip("category", f"Category: {cat}", cat)
            text = _cut(text, m)

    # institution (fuzzy) or leftover keywords
    left = [t for t in re.findall(r"[a-z0-9&.]+", text) if t not in STOP and len(t) > 1]
    if left and "institution_id" not in params:
        phrase = intel.normalize_name(" ".join(left))
        best = None
        if phrase:
            scored = []
            for i in db.rows(conn, "SELECT aicte_id,name FROM institutions"):
                full = intel.normalize_name(i["name"])
                score = max(fuzz.token_set_ratio(phrase, full), fuzz.partial_ratio(phrase, full) * 0.97)
                scored.append((score, i))
            scored.sort(key=lambda x: -x[0])
            if scored and scored[0][0] >= 88 and (len(scored) < 2 or scored[1][0] < scored[0][0] - 1):
                best = scored[0][1]
        if best:
            params["institution_id"] = best["aicte_id"]
            chip("institution_id", f"Institution: {best['name']}", best["aicte_id"])
            left = []
    if left and "q" not in params:
        cities = {r["city"].lower(): r["city"] for r in db.rows(conn, "SELECT DISTINCT city FROM institutions")}
        for t in list(left):
            c = intel.CITY_ALIAS.get(t, t)
            if c in cities:
                params["q"] = cities[c]
                chip("q", f"City: {cities[c]}", cities[c])
                left = [x for x in left if x != t]
                break
    if left and "q" not in params:
        params["q"] = " ".join(left)
        chip("q", f"Text contains: “{params['q']}”", params["q"])

    return {"query": q, "chips": chips, "params": params, "understood": bool(chips)}
