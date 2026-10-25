"""Intelligence layer: name normalisation, institution resolution, explainable overlap scoring.

Local and offline: rapidfuzz for names, TF-IDF cosine for text, plain rules for the rest.
"""
import json
import re
from datetime import date, datetime, timedelta

from rapidfuzz import fuzz
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer

from . import db
from .constants import CATEGORY_GROUP, HEADLINE_DUP, HEADLINE_HIGH, HEADLINE_MEDIUM

# ---------------------------------------------------------------- names -------------

ABBR = {"govt": "government", "gov": "government", "engg": "engineering", "eng": "engineering",
        "coll": "college", "clg": "college", "inst": "institute", "tech": "technology",
        "univ": "university", "poly": "polytechnic", "mgmt": "management", "sci": "science"}
CITY_ALIAS = {"bangalore": "bengaluru", "bombay": "mumbai", "madras": "chennai", "calcutta": "kolkata",
              "mysore": "mysuru", "mangalore": "mangaluru", "cochin": "kochi", "gurgaon": "gurugram",
              "vizag": "visakhapatnam", "poona": "pune"}
NAME_STOP = {"of", "the", "and", "for", "a"}


def normalize_name(s, trace=None):
    toks = re.findall(r"[a-z0-9]+", (s or "").lower().replace("&", " and "))
    out = []
    for t in toks:
        t2 = ABBR.get(t) or CITY_ALIAS.get(t) or t
        if t2 != t and trace is not None:
            trace.append((t, t2))
        if t2 in NAME_STOP:
            continue
        out.append(t2)
    return " ".join(out)


class Registry:
    """In-memory view of the institution master used for entity resolution."""

    def __init__(self, conn):
        self.insts = []
        self._rows = db.rows(conn, "SELECT aicte_id,name,city,region FROM institutions")
        for r in self._rows:
            city = normalize_name(r["city"])
            full = normalize_name(r["name"])
            self.insts.append({"id": r["aicte_id"], "name": r["name"], "city": city, "full": full,
                               "nocity": " ".join(t for t in full.split() if t != city)})
        self.by_id = {i["id"]: i for i in self.insts}

    def resolve(self, name, aicte_id=None):
        """Return {institution_id, method, confidence} or None when unresolved/ambiguous."""
        if aicte_id and aicte_id in self.by_id:
            return {"institution_id": aicte_id, "method": "ID", "confidence": 100.0}
        norm = normalize_name(name)
        toks = set(norm.split())
        cands = [i for i in self.insts if i["city"] in toks]
        if cands:
            scored = sorted(((fuzz.token_sort_ratio(norm, i["full"]), i) for i in cands),
                            key=lambda x: -x[0])
        else:
            scored = sorted(((fuzz.token_sort_ratio(norm, i["nocity"]), i) for i in self.insts),
                            key=lambda x: -x[0])
            if len(scored) > 1 and scored[0][0] - scored[1][0] < 5:
                return None
        best, inst = scored[0]
        if len(scored) > 1 and scored[1][0] >= best - 2 and best < 100:
            return None
        if best >= 88:
            return {"institution_id": inst["id"], "method": "NAME", "confidence": float(best)}
        if best >= 80:
            return {"institution_id": inst["id"], "method": "NAME_LOW", "confidence": float(best)}
        return None


    GENERIC = {"government", "college", "institute", "institution", "technology", "engineering", "management",
               "studies", "polytechnic", "school", "pharmacy", "university", "science", "sciences", "and"}

    def suggest(self, name, n=5):
        """Best fuzzy candidates for a name, for the user to confirm when resolution is not confident.

        Generic words (college, institute, engineering...) are ignored when ranking, so only the distinctive part
        of the name (e.g. 'Sahyadri', 'Kaveri', the city) can make a candidate look similar."""
        norm = normalize_name(name)
        if not norm:
            return []
        qd = " ".join(t for t in norm.split() if t not in self.GENERIC)
        info = {r["aicte_id"]: r for r in self._rows}
        scored = []
        for i in self.insts:
            idist = " ".join(t for t in i["full"].split() if t not in self.GENERIC)
            sc = fuzz.token_set_ratio(qd, idist) if qd else 0
            scored.append((max(sc, 0.7 * fuzz.WRatio(norm, i["full"])), i))
        scored.sort(key=lambda x: -x[0])
        return [{"institution_id": i["id"], "name": i["name"], "city": info[i["id"]]["city"],
                 "region": info[i["id"]]["region"], "score": round(sc)} for sc, i in scored[:n] if sc >= 65]


# ---------------------------------------------------------------- text --------------

SYN = {"teacher": "faculty", "teachers": "faculty", "teaching": "faculty", "staff": "faculty",
       "professor": "faculty", "professors": "faculty", "lecturers": "faculty", "lecturer": "faculty",
       "fees": "fee", "charges": "fee", "charged": "fee", "tuition": "fee", "refund": "fee",
       "laboratories": "lab", "laboratory": "lab", "labs": "lab", "equipment": "lab",
       "admitted": "admission", "admissions": "admission", "enrolled": "admission", "enrol": "admission",
       "sanctioned": "intake", "seats": "intake", "approved": "approval",
       "harassment": "ragging", "placements": "placement", "bribery": "bribe", "bribes": "bribe",
       "funds": "fund", "misappropriation": "fund", "diverted": "fund"}
DOMAIN_STOP = {"college", "institute", "institution", "complaint", "regarding", "aicte", "reported",
               "alleged", "matter", "students", "student", "pending", "case"}
TEXT_STOP = sorted(set(ENGLISH_STOP_WORDS) | DOMAIN_STOP)


def _prep(text):
    return " ".join(SYN.get(t, t) for t in re.findall(r"[a-z]+", text.lower()))


TOPICS = {
    "faculty": {"faculty"},
    "fees": {"fee"},
    "infrastructure": {"lab", "library", "hostel", "building", "infrastructure", "classrooms", "campus"},
    "approval": {"approval", "intake", "affiliation", "unapproved"},
    "admission": {"admission", "counselling", "capitation"},
    "safety": {"ragging", "safety"},
    "placement": {"placement"},
    "finance": {"fund", "bribe", "corruption", "audited"},
}


def topics_of(text):
    toks = set(_prep(text).split())
    return {k for k, words in TOPICS.items() if toks & words}


class TextModel:
    def __init__(self, docs):
        """docs: {case_id: description}"""
        self.ids = list(docs)
        self.idx = {c: i for i, c in enumerate(self.ids)}
        self.vec = TfidfVectorizer(preprocessor=_prep, stop_words=TEXT_STOP, ngram_range=(1, 2),
                                   sublinear_tf=True, token_pattern=r"[a-z]{2,}")
        self.X = self.vec.fit_transform([docs[c] for c in self.ids])
        self.terms = self.vec.get_feature_names_out()
        self.entities = {case_id: extract_entities(text) for case_id, text in docs.items()}

    def cosine(self, a, b):
        return float(self.X[self.idx[a]].multiply(self.X[self.idx[b]]).sum())

    def shared_terms(self, a, b, n=4):
        ra, rb = self.X[self.idx[a]].tocoo(), self.X[self.idx[b]]
        wb = {c: v for c, v in zip(rb.tocoo().col, rb.tocoo().data)}
        pairs = [(v * wb[c], self.terms[c]) for c, v in zip(ra.col, ra.data) if c in wb and " " not in self.terms[c]]
        return [t for _, t in sorted(pairs, reverse=True)[:n]]

    def shared_entities(self, a, b):
        return {key: sorted(set(self.entities[a][key]) & set(self.entities[b][key]))
                for key in ("amount_values", "circulars", "roll_numbers")}


# ---------------------------------------------------------------- scoring -----------

TEXT_FULL_COSINE = 0.10  # cosine at/above which the text signal earns full points (calibrated: short paraphrased complaints rarely exceed 0.1-0.2)
HIGH, MEDIUM = 70, 50


def _clamp(x):
    return max(0.0, min(1.0, x))


def _d(x):
    return x if isinstance(x, date) else datetime.strptime(x[:10], "%Y-%m-%d").date()


def score_pair(a, b, tm, *, include_entities=True):
    """Score two cases about the same institution. Returns None when not a candidate."""
    if not a["institution_id"] or a["institution_id"] != b["institution_id"]:
        return None
    # 1. identity (max 30)
    both_id = (a["resolution_method"] == "ID" and b["resolution_method"] == "ID"
               and a["submitted_aicte_id"] == b["submitted_aicte_id"])
    if both_id:
        ident, ident_d = 30.0, f"Both complaints quote the same AICTE ID {a['institution_id']}"
    else:
        conf = min(a["resolution_conf"], b["resolution_conf"])
        if conf >= 88:
            ident = 18.0
        elif conf >= 80:
            ident = 10.0
        else:
            return None
        missing = [c["case_id"].split("/")[0] for c in (a, b) if not c["submitted_aicte_id"]]
        if len(missing) == 2:
            ident_d = f"Neither case quotes an AICTE ID; both matched by name to {a['institution_id']}"
        elif missing:
            ident_d = f"The {missing[0]} case has no AICTE ID; matched by name to {a['institution_id']}"
        else:
            ident_d = f"Resolved to the same master record {a['institution_id']} by name"

    # 2. name similarity (max 15)
    ta, tb = [], []
    na, nb = normalize_name(a["submitted_institution_name"], ta), normalize_name(b["submitted_institution_name"], tb)
    ratio = fuzz.token_set_ratio(na, nb)
    name_pts = round(15 * _clamp((ratio - 70) / 30), 1)
    changes = sorted({f"'{x}'→'{y}'" for x, y in ta + tb})[:4]
    name_d = f"{ratio:.0f}% similar after normalising" + (f" {', '.join(changes)}" if changes else "")

    # 3. text similarity (max 25)
    cos = tm.cosine(a["case_id"], b["case_id"])
    text_pts = round(25 * min(1.0, cos / TEXT_FULL_COSINE), 1)
    shared = tm.shared_terms(a["case_id"], b["case_id"])
    text_d = f"cosine {cos:.2f}" + (f"; shared terms: {', '.join(shared)}" if shared else "; no shared key terms")

    # 4. category (max 15)
    if a["category"] == b["category"]:
        cat_pts, cat_d = 15.0, f"Same category: {a['category']}"
    elif CATEGORY_GROUP.get(a["category"]) == CATEGORY_GROUP.get(b["category"]):
        cat_pts = 9.0
        cat_d = f"{a['category']} vs {b['category']} — same group ({CATEGORY_GROUP[a['category']]})"
    else:
        common = topics_of(a["description"]) & topics_of(b["description"])
        if common:
            cat_pts = 6.0
            cat_d = f"Different categories, but both concern {', '.join(sorted(common))}"
        else:
            cat_pts, cat_d = 0.0, f"{a['category']} vs {b['category']} — unrelated"

    # 5. time window (max 15)
    days = abs((_d(a["received_on"]) - _d(b["received_on"])).days)
    time_pts = 15.0 if days <= 30 else round(15 * _clamp((180 - days) / 150), 1)
    time_d = f"received {days} day{'s' if days != 1 else ''} apart"

    # Topic gate: same institution + same period alone is not an overlap.
    if text_pts + cat_pts < 10:
        return None

    base_points = ident + name_pts + text_pts + cat_pts + time_pts
    matches = tm.shared_entities(a["case_id"], b["case_id"]) if include_entities else {}
    requested_points, entity_detail = _entity_signal(matches)
    entity_points = round(min(requested_points, max(0.0, 100 - base_points)), 1)
    if entity_points < requested_points:
        entity_detail += f"; bonus limited to {entity_points:g} to keep the overall score at most 100"
    total = min(100, round(base_points + entity_points))
    band = "HIGH" if total >= HIGH else "MEDIUM" if total >= MEDIUM else None
    if band is None:
        return None
    cross = a["bureau_code"] != b["bureau_code"]
    if cross:
        headline = HEADLINE_HIGH if band == "HIGH" else HEADLINE_MEDIUM
    else:
        headline = HEADLINE_DUP
    breakdown = [
        {"signal": "identity", "label": "Same institution", "points": ident, "max": 30, "detail": ident_d},
        {"signal": "name", "label": "Name similarity", "points": name_pts, "max": 15, "detail": name_d},
        {"signal": "text", "label": "Complaint text", "points": text_pts, "max": 25, "detail": text_d},
        {"signal": "category", "label": "Category", "points": cat_pts, "max": 15, "detail": cat_d},
        {"signal": "time", "label": "Time window", "points": time_pts, "max": 15, "detail": time_d},
        {"signal": "entities", "label": "Shared references and amounts", "points": entity_points,
         "max": 10, "detail": entity_detail},
    ]
    marks = {True: "✔", False: "✘"}
    lines = [f"{total}% – {band} – {headline}."]
    for s in breakdown:
        full = s["points"] >= 0.75 * s["max"]
        mark = marks[full] if s["points"] > 0 and full else ("◐" if s["points"] > 0 else "✘")
        lines.append(f"{mark} {s['label']}: {s['detail']} (+{s['points']:g}/{s['max']})")
    lines.append(f"Handled in parallel by {a['bureau_code']} and {b['bureau_code']}." if cross
                 else f"Both cases sit with {a['bureau_code']} but with different officers.")
    return {"score": total, "band": band, "type": "CROSS_BUREAU" if cross else "DUPLICATE",
            "breakdown": breakdown, "explanation": "\n".join(lines), "headline": headline}


def _entity_signal(matches):
    points, details = 0, []
    amounts = matches.get("amount_values", [])
    circulars = matches.get("circulars", [])
    rolls = matches.get("roll_numbers", [])
    if amounts:
        points += 4
        details.append("Same amount: " + ", ".join(f"₹{value:,}" for value in amounts[:3]))
    if circulars:
        points += 6
        details.append("Same circular/reference: " + ", ".join(circulars[:3]))
    if rolls:
        points += 6
        details.append("Same roll/registration number: " + ", ".join(rolls[:3]))
    return min(10, points), "; ".join(details) or "No shared explicit amount, circular or roll number"


# ---------------------------------------------------------------- detection ---------

def load_cases(conn):
    return db.rows(conn, "SELECT * FROM cases")


def _eligible(c, now_dt):
    if c["status"] != "Disposed":
        return True
    return c["disposed_on"] and (now_dt.date() - _d(c["disposed_on"])).days <= 90


def detect(conn, only_case=None, institutions=None):
    """Score candidate pairs and persist them. Returns list of newly created pair dicts.

    only_case: restrict to pairs involving this case (live path). Otherwise all institutions.
    """
    cases = load_cases(conn)
    tm = TextModel({c["case_id"]: c["description"] for c in cases})
    now_dt = db.now(conn)
    by_inst = {}
    for c in cases:
        if c["institution_id"] and _eligible(c, now_dt):
            by_inst.setdefault(c["institution_id"], []).append(c)
    by_id = {c["case_id"]: c for c in cases}
    targets = [by_id[only_case]["institution_id"]] if only_case else (institutions or list(by_inst))
    created = []
    for inst in targets:
        group = by_inst.get(inst, [])
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if only_case and only_case not in (a["case_id"], b["case_id"]):
                    continue
                a, b = sorted((a, b), key=lambda c: c["case_id"])
                res = score_pair(a, b, tm)
                if not res:
                    continue
                existing = db.one(conn, "SELECT id FROM overlap_pairs WHERE case_a=? AND case_b=?",
                                  (a["case_id"], b["case_id"]))
                if existing:
                    continue
                pid = "PR-%04d" % db.next_counter(conn, "pair_seq")
                conn.execute(
                    "INSERT INTO overlap_pairs(id,case_a,case_b,institution_id,type,score,band,breakdown,"
                    "explanation,headline,status,detected_at) VALUES(?,?,?,?,?,?,?,?,?,?,'OPEN',?)",
                    (pid, a["case_id"], b["case_id"], inst, res["type"], res["score"], res["band"],
                     json.dumps(res["breakdown"]), res["explanation"], res["headline"], db.iso(now_dt)))
                created.append({"id": pid, "institution_id": inst, "case_a": a["case_id"],
                                "case_b": b["case_id"], **res})
        recluster(conn, inst)
    return created


def preview_pairs(conn, draft):
    """Score a not-yet-saved case against the institution's eligible cases (no writes)."""
    cases = load_cases(conn)
    now_dt = db.now(conn)
    group = [c for c in cases if c["institution_id"] == draft["institution_id"] and _eligible(c, now_dt)]
    if not group:
        return []
    docs = {c["case_id"]: c["description"] for c in cases}
    docs[draft["case_id"]] = draft["description"]
    tm = TextModel(docs)
    out = []
    for c in group:
        res = score_pair(draft, c, tm)
        if res:
            out.append({**res, "other": c})
    return out


def recluster(conn, institution_id):
    """Union-find over the institution's active pairs; assign stable cluster ids."""
    pairs = db.rows(conn, "SELECT id,case_a,case_b,cluster_id FROM overlap_pairs "
                          "WHERE institution_id=? AND status NOT IN ('DISMISSED','REJECTED')", (institution_id,))
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for p in pairs:
        parent[find(p["case_a"])] = find(p["case_b"])
    comps = {}
    for p in pairs:
        comps.setdefault(find(p["case_a"]), []).append(p)
    for plist in comps.values():
        cases = {c for p in plist for c in (p["case_a"], p["case_b"])}
        existing = sorted({p["cluster_id"] for p in plist if p["cluster_id"]} |
                          {r["cluster_id"] for r in conn.execute(
                              "SELECT cluster_id FROM cases WHERE case_id IN (%s) AND cluster_id IS NOT NULL"
                              % ",".join("?" * len(cases)), tuple(cases))})
        cid = existing[0] if existing else "OVL-%04d" % db.next_counter(conn, "cluster_seq")
        conn.execute("UPDATE overlap_pairs SET cluster_id=? WHERE id IN (%s)" % ",".join("?" * len(plist)),
                     (cid, *[p["id"] for p in plist]))
        conn.execute("UPDATE cases SET cluster_id=? WHERE case_id IN (%s)" % ",".join("?" * len(cases)),
                     (cid, *cases))


# ---------------------------------------------------------------- entity extraction ---

AMOUNT_PREFIX_RE = re.compile(
    r"(?<!\w)(?:₹|Rs\.?|INR)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)\s*(lakhs?|crores?|cr\.?)?\b",
    re.IGNORECASE
)
AMOUNT_SUFFIX_RE = re.compile(
    r"\b([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)\s*(lakhs?|crores?|cr\.?|rupees?)\b",
    re.IGNORECASE
)

CIRCULAR_RE = re.compile(
    r"\b(?:circular|ref(?:erence)?|notification|order|file|f\.?\s*no\.?)"
    r"(?:\s*(?:no\.?|#|num(?:ber)?))?"
    r"(?:\s*[:\-–/#]\s*|\s+|#)"
    r"((?=[A-Za-z0-9\-/.]{2,}\b)[A-Za-z0-9\-/.]*\d[A-Za-z0-9\-/.]*)",
    re.IGNORECASE
)

ROLL_RE = re.compile(
    r"\b(?:roll|reg(?:istration)?|enrol(?:l)?ment|hall[- ]?ticket)"
    r"(?:\s*(?:no\.?|#|num(?:ber)?))?"
    r"(?:\s*[:\-–/#]\s*|\s+|#)"
    r"((?=[A-Za-z0-9\-]{2,}\b)[A-Za-z0-9\-]*\d[A-Za-z0-9\-]*)",
    re.IGNORECASE
)


def _parse_amount_to_number(num_str: str, unit: str = "") -> int:
    clean_num = num_str.replace(",", "").strip()
    try:
        val = float(clean_num)
    except ValueError:
        return 0
    unit_lower = (unit or "").lower().strip()
    if "crore" in unit_lower or unit_lower in ("cr", "cr."):
        val *= 10_000_000
    elif "lakh" in unit_lower:
        val *= 100_000
    try:
        return int(round(val))
    except (OverflowError, ValueError):
        return 0


def extract_entities(text: str) -> dict:
    """Extracts financial amounts, circular numbers, and roll/registration numbers from text.

    Accepted formats:
      - Amounts: ₹45,000, Rs. 1.5 lakh, INR 50,000, 2 crore, 25000 rupees.
      - Circulars: Circular No. AICTE/2026/04, F.No. 12-3/2025, Ref: AICTE-2023-11, Order #2024/99.
      - Roll Numbers: Roll no: ENR-99214, Registration No. 2024-REG-991, Hall Ticket HT2026001.

    Returns:
      dict with keys:
        amounts: list[str] of formatted amount strings (sorted unique)
        amount_values: list[int] of numeric rupee values (sorted unique)
        circulars: list[str] of uppercase normalised identifiers (sorted unique)
        roll_numbers: list[str] of uppercase normalised identifiers (sorted unique)
    """
    if not text:
        return {"amounts": [], "amount_values": [], "circulars": [], "roll_numbers": []}

    s = str(text)[:20000]

    raw_amounts = []
    amount_values = []

    for m in AMOUNT_PREFIX_RE.finditer(s):
        full_match = m.group(0).strip()
        num_part = m.group(1)
        unit_part = m.group(2) or ""
        val = _parse_amount_to_number(num_part, unit_part)
        if val > 0:
            raw_amounts.append(full_match)
            amount_values.append(val)

    for m in AMOUNT_SUFFIX_RE.finditer(s):
        full_match = m.group(0).strip()
        num_part = m.group(1)
        unit_part = m.group(2) or ""
        val = _parse_amount_to_number(num_part, unit_part)
        if val > 0 and full_match not in raw_amounts:
            raw_amounts.append(full_match)
            amount_values.append(val)

    circulars = []
    for m in CIRCULAR_RE.finditer(s):
        ident = m.group(1).strip().rstrip(".,;:-/").upper()
        if ident and any(c.isdigit() for c in ident):
            circulars.append(ident)

    roll_numbers = []
    for m in ROLL_RE.finditer(s):
        ident = m.group(1).strip().rstrip(".,;:-/").upper()
        if ident and any(c.isdigit() for c in ident):
            roll_numbers.append(ident)

    return {
        "amounts": sorted(set(raw_amounts)),
        "amount_values": sorted(set(amount_values)),
        "circulars": sorted(set(circulars)),
        "roll_numbers": sorted(set(roll_numbers))
    }

