
"""Deterministic synthetic data: ~60 fictional institutions, ~300 cases, planted overlaps and decoys.

All institutions are fictional. Planted scenarios guarantee the demo always shines.
"""
import hashlib
import json
import random
import shutil
from datetime import datetime, time, timedelta

from . import db, intel
from . import sla_rules
from . import sla as sla_engine
from .constants import (BUREAU_CATEGORIES, BUREAU_ORDER, BUREAUS, CATEGORY_GROUP, REGION_STATES, SLA_DAYS)

GEO = {
    "Northern": [("Delhi", "Delhi"), ("Lucknow", "Uttar Pradesh"), ("Kanpur", "Uttar Pradesh"),
                 ("Dehradun", "Uttarakhand")],
    "North-Western": [("Chandigarh", "Chandigarh"), ("Ludhiana", "Punjab"), ("Jaipur", "Rajasthan"),
                      ("Gurugram", "Haryana")],
    "Central": [("Bhopal", "Madhya Pradesh"), ("Indore", "Madhya Pradesh"), ("Raipur", "Chhattisgarh")],
    "Eastern": [("Kolkata", "West Bengal"), ("Bhubaneswar", "Odisha"), ("Patna", "Bihar"),
                ("Guwahati", "Assam")],
    "Western": [("Pune", "Maharashtra"), ("Mumbai", "Maharashtra"), ("Nagpur", "Maharashtra"),
                ("Ahmedabad", "Gujarat")],
    "South-Western": [("Bengaluru", "Karnataka"), ("Mysuru", "Karnataka"), ("Mangaluru", "Karnataka")],
    "South-Central": [("Hyderabad", "Telangana"), ("Visakhapatnam", "Andhra Pradesh"),
                      ("Tirupati", "Andhra Pradesh")],
    "Southern": [("Chennai", "Tamil Nadu"), ("Coimbatore", "Tamil Nadu"), ("Kochi", "Kerala")],
}
THREE = {"Mumbai", "Bengaluru", "Chennai", "Hyderabad"}
REGION_WEIGHT = {"Western": 2.0, "Southern": 1.6, "South-Western": 1.3, "Northern": 1.1, "Eastern": 1.0,
                 "Central": 0.8, "North-Western": 0.9, "South-Central": 1.0}

PREFIXES = ["Vindhya", "Narmada", "Himalaya", "Ganga", "Aravali", "Deccan", "Konark", "Brahmaputra",
            "Saraswati", "Chanakya", "Tagore", "Ashoka", "Nalanda", "Takshashila", "Yamuna", "Godavari",
            "Krishna", "Tungabhadra", "Satpura", "Malabar", "Coromandel", "Nilgiri", "Sundarban",
            "Kanchenjunga", "Dhauladhar", "Shivalik", "Pratap", "Rajarshi", "Bharatiya", "Lokmanya",
            "Vasundhara", "Aryabhata", "Gautam", "Maitri", "Prerna", "Utkarsh", "Navjyoti", "Sagar",
            "Shikhar", "Triveni", "Ambika", "Kamala", "Jyoti", "Pragati", "Sanskriti", "Tejas", "Udaya",
            "Varuna", "Yashoda", "Zenith", "Anand", "Bhavani", "Charaka", "Dwarka", "Ekta", "Gandhar",
            "Hemant", "Indrayani", "Janaki", "Kalinga", "Lakshya", "Madhav", "Neelkanth"]
TEMPLATES = ["{p} Institute of Technology, {c}", "{p} College of Engineering and Technology, {c}",
             "{p} Institute of Management Studies, {c}", "{p} Polytechnic, {c}",
             "{p} School of Pharmacy, {c}", "{p} Institute of Engineering, {c}"]
FIRST = ["Anita", "Rajesh", "Sunil", "Meera", "Vikram", "Kavita", "Arvind", "Sudha", "Mohan", "Neha",
         "Prakash", "Rekha", "Dinesh", "Lata", "Harish", "Usha"]
LAST = ["Deshmukh", "Iyer", "Banerjee", "Reddy", "Sharma", "Nair", "Patil", "Gupta", "Menon", "Verma",
        "Kulkarni", "Das", "Pillai", "Joshi", "Rao", "Singh"]
PROGRAMMES = ["B.E./B.Tech", "M.E./M.Tech", "MBA", "MCA", "Diploma Engineering", "B.Pharm", "PGDM"]

OFFICERS = {
    "RB": [("S. Kulkarni", "Section Officer"), ("R. Iyer", "Desk Officer"), ("M. Banerjee", "Deputy Director"), ("V. Rao", "Director")],
    "PGRC": [("A. Mehta", "Section Officer"), ("P. Nair", "Desk Officer"), ("K. Sharma", "Deputy Director"), ("D. Gupta", "Director")],
    "AB": [("N. Reddy", "Section Officer"), ("T. Joshi", "Desk Officer"), ("L. Fernandes", "Deputy Director"), ("H. Khan", "Director")],
    "LC": [("S. Menon", "Legal Officer"), ("B. Chatterjee", "Desk Officer"), ("R. Pillai", "Deputy Legal Adviser"), ("J. Malhotra", "Legal Adviser")],
    "VIG": [("G. Singh", "Vigilance Officer"), ("C. Verma", "Desk Officer"), ("F. D'Souza", "Deputy Director"), ("O. Bhatt", "Chief Vigilance Officer")],
}

DESC = {
    "Faculty Deficiency": [
        "Shortage of qualified faculty reported in several departments; classes are run with guest lecturers only.",
        "Faculty-student ratio is far below AICTE norms and many sanctioned teaching posts remain vacant.",
        "Teaching staff do not hold the prescribed qualifications; several professors are shown on paper but never attend."],
    "Academic Quality": [
        "Syllabus is not completed on time, examinations are delayed and internal assessment marks are manipulated.",
        "Poor teaching standards and irregular classes; students are not getting the prescribed contact hours.",
        "Results are repeatedly withheld and re-evaluation requests are ignored by the management."],
    "Infrastructure Deficiency": [
        "Laboratories lack functional equipment and the library has no current books or journals.",
        "Hostel buildings and classrooms are unsafe and in poor condition with no drinking water.",
        "Campus facilities shown during the approval inspection are not actually available to students."],
    "Excess Intake / Approval Violation": [
        "Institute has admitted more students than the intake approved by AICTE for the current academic year.",
        "Additional divisions are being run without sanctioned intake in violation of approval conditions.",
        "Intake was increased without prior permission and the approval process was bypassed."],
    "Affiliation / Approval Dispute": [
        "Dispute regarding extension of approval and university affiliation; the institute challenges the decision.",
        "Affiliation withdrawn by the university while the institute continues to enrol students.",
        "Approval for the programme lapsed and renewal is contested by the management."],
    "Unapproved Programme": [
        "Institute is conducting a programme that has no AICTE approval and is advertising admissions for it.",
        "New course launched without approval; students were enrolled and fees collected.",
        "Programme closed by AICTE earlier is being run again under another name."],
    "Fee Overcharging / Refund": [
        "College collected fees much higher than the fee structure fixed by the fee regulatory authority.",
        "Refund of fees is denied after withdrawal of admission despite repeated requests by the parent.",
        "Hidden charges and development fees were demanded at the time of admission."],
    "Financial Irregularity": [
        "Allegation of misappropriation of funds and diversion of student fees by the trust.",
        "Accounts of the institute are not audited and large cash payments are taken without receipts.",
        "Complaint of corruption and bribery in sanction of seats and grants."],
    "Ragging / Safety": [
        "Serious ragging incidents reported in the hostel and students are afraid to attend classes.",
        "Anti-ragging committee is not functioning and complaints of harassment are ignored.",
        "Safety lapses on campus including blocked fire exits and no security staff."],
    "Admission Irregularity": [
        "Admission given outside the counselling merit list and capitation fee demanded for seats.",
        "Students admitted without eligibility requirements and admission records were backdated.",
        "Seats reserved for category students were filled with other candidates."],
    "Placement Misrepresentation": [
        "College advertises one hundred percent placements but students received no job offers.",
        "Placement figures on the website and prospectus are false and misleading.",
        "Companies shown as recruiters deny ever visiting the campus."],
    "Document Withholding": [
        "Original certificates are being withheld after course completion until extra payment is made.",
        "College refuses to return original documents to students who left the course.",
        "Transfer certificate and marksheets have not been issued for months."],
}

# Topic bank for planted overlaps: (topic, bureau) -> (category, text). Different bureaus describe the
# same real-world problem in different words, which is exactly what the engine must still catch.
TOPIC = {
    ("faculty", "RB"): ("Faculty Deficiency", "Shortage of qualified faculty reported; the institution has admitted students beyond the approved intake with insufficient teaching staff in Mechanical and Civil departments."),
    ("faculty", "PGRC"): ("Academic Quality", "Students complain that regular teachers are not available for three semesters and classes are taken by visiting staff; laboratories are unusable."),
    ("faculty", "AB"): ("Excess Intake / Approval Violation", "Approval extension pending: faculty strength is below the norm for the sanctioned intake and recruitment of professors is not completed."),
    ("fees", "PGRC"): ("Fee Overcharging / Refund", "Parents allege the college charged fees above the approved fee structure and refuses a refund after withdrawal of admission."),
    ("fees", "VIG"): ("Financial Irregularity", "Complaint that excess fees collected from students were diverted and receipts were not issued for the charges."),
    ("fees", "LC"): ("Fee Overcharging / Refund", "Legal notice from parents demanding refund of excess tuition fees collected by the institute."),
    ("infra", "RB"): ("Infrastructure Deficiency", "Inspection found laboratory equipment and library facilities below AICTE norms for the approved programmes."),
    ("infra", "PGRC"): ("Infrastructure Deficiency", "Hostel and laboratory conditions are poor; the library stays closed and lab equipment does not work."),
    ("infra", "AB"): ("Infrastructure Deficiency", "Approval renewal is pending because of deficiency in laboratories, library and building facilities."),
    ("admission", "PGRC"): ("Admission Irregularity", "Students were admitted outside the counselling merit list and capitation fee was demanded for seats."),
    ("admission", "RB"): ("Excess Intake / Approval Violation", "Admission made beyond the sanctioned intake in violation of approval conditions; counselling rules not followed."),
    ("admission", "VIG"): ("Admission Irregularity", "Bribes were taken for admission seats outside the counselling merit process."),
    ("unapproved", "RB"): ("Unapproved Programme", "Institute is running a postgraduate programme without AICTE approval and advertising admissions for it."),
    ("unapproved", "PGRC"): ("Admission Irregularity", "Students enrolled in a course are now told the programme has no AICTE approval and degrees may be invalid."),
    ("unapproved", "LC"): ("Affiliation / Approval Dispute", "Writ petition by students regarding an unapproved programme and invalid degree; approval status disputed."),
    ("ragging", "PGRC"): ("Ragging / Safety", "Serious ragging incidents reported in the hostel; students are afraid to attend classes and harassment continues."),
    ("ragging", "RB"): ("Ragging / Safety", "Anti-ragging committee not constituted; hostel safety norms violated and harassment complaints ignored."),
    ("placement", "PGRC"): ("Placement Misrepresentation", "College advertises full placements but students received no job offers; placement claims are false."),
    ("placement", "RB"): ("Placement Misrepresentation", "Misleading advertisement of placement records on the prospectus and website; recruiters deny placements."),
}

REMARKS = ["Reply sought from the institution within 15 days", "Inspection report called from Regional Office",
           "Hearing scheduled with institute management", "Documents verified; clarification awaited",
           "Show-cause notice issued to the institution", "Matter examined; comments of the Bureau recorded"]
TRANSFER_R = ["Matter relates to approval conditions; transferred", "Transferred for examination as per jurisdiction",
              "Forwarded to the concerned Bureau for necessary action", "Legal opinion needed; referred"]
OUTCOMES = ["Show-cause notice issued; institution complied", "Complaint found unsubstantiated after inspection",
            "Penalty imposed and compliance verified", "Referred to the University / State Authority",
            "Complainant satisfied; refund made", "Approval conditions enforced; matter closed"]
NEXT_ACTIONS = ["Await institution reply", "Examine reply and place before competent authority",
                "Schedule inspection by Regional Office", "Issue show-cause notice", "Seek comments from Bureau",
                "Prepare draft order"]
SOURCES = ["CPGRAMS", "Email", "Letter", "AICTE Portal", "Regional Office", "Court Referral"]

# Planted overlap clusters: (institution (city, idx), topic, [(bureau, days_ago, quotes_id, name_form)])
PLANTED = [
    (("Pune", 0), "faculty", [("RB", 24, False, "abbr"), ("PGRC", 12, True, "full"), ("AB", 18, True, "upper")]),
    (("Mumbai", 1), "fees", [("PGRC", 16, True, "full"), ("VIG", 11, False, "abbr"), ("LC", 6, True, "full")]),
    (("Chennai", 0), "infra", [("RB", 15, False, "abbr"), ("PGRC", 9, True, "alias"), ("AB", 4, False, "upper")]),
    (("Kolkata", 1), "admission", [("PGRC", 14, True, "full"), ("RB", 8, False, "abbr")]),
    (("Kochi", 0), "unapproved", [("RB", 19, True, "full"), ("PGRC", 13, False, "typo"), ("LC", 7, False, "abbr")]),
    (("Lucknow", 0), "faculty", [("RB", 22, True, "full"), ("PGRC", 10, False, "abbr")]),
    (("Delhi", 1), "fees", [("PGRC", 12, False, "alias"), ("LC", 5, True, "full")]),
    (("Hyderabad", 0), "infra", [("RB", 17, True, "full"), ("AB", 9, False, "abbr")]),
    (("Bhopal", 1), "ragging", [("PGRC", 10, False, "typo"), ("RB", 3, True, "full")]),
    (("Jaipur", 0), "placement", [("PGRC", 20, True, "full"), ("RB", 11, False, "abbr")]),
    (("Nagpur", 1), "admission", [("PGRC", 13, False, "abbr"), ("VIG", 6, True, "full")]),
]

# Simulation targets: each has one staged open case; "Simulate" files a complaint from another Bureau
# about the same institution under a different spelling and without an AICTE ID.
SIM = [
    {"inst": ("Bengaluru", 1), "staged": ("RB", "infra", 6), "new": ("PGRC", "infra", "alias")},
    {"inst": ("Ahmedabad", 1), "staged": ("PGRC", "fees", 9), "new": ("VIG", "fees", "abbr")},
    {"inst": ("Patna", 0), "staged": ("RB", "faculty", 11), "new": ("PGRC", "faculty", "typo")},
    {"inst": ("Visakhapatnam", 1), "staged": ("RB", "unapproved", 5), "new": ("LC", "unapproved", "upper")},
    {"inst": ("Indore", 0), "staged": ("PGRC", "ragging", 4), "new": ("RB", "ragging", "abbr")},
    {"inst": ("Ludhiana", 1), "staged": ("RB", "admission", 10), "new": ("PGRC", "admission", "full")},
]


def name_variant(name, form, rng):
    """Render an institution name the way a complainant might write it."""
    if form == "full":
        return name
    base = name.replace(",", "")
    for a, b in (("Government", "Govt."), ("Engineering", "Engg"), ("Technology", "Tech"), ("Institute", "Inst."),
                 ("Management", "Mgmt")):
        base = base.replace(a, b)
    if form == "abbr":
        return base
    if form == "upper":
        return base.upper().replace("INST.", "INST").replace("GOVT.", "GOVT")
    if form == "alias":
        for a, b in (("Bengaluru", "Bangalore"), ("Mumbai", "Bombay"), ("Chennai", "Madras"),
                     ("Kolkata", "Calcutta"), ("Mysuru", "Mysore"), ("Kochi", "Cochin"), ("Gurugram", "Gurgaon")):
            base = base.replace(a, b)
        return base
    if form == "typo":
        words = name.replace(",", "").split()
        long_idx = [i for i, w in enumerate(words) if len(w) >= 8]
        if long_idx:
            i = rng.choice(long_idx)
            w = words[i]
            k = rng.randrange(2, len(w) - 2)
            words[i] = w[:k] + w[k + 1:]
        return " ".join(words)
    return name


def build_institutions(rng):
    pool = PREFIXES[:]
    rng.shuffle(pool)
    out = []
    used_ids = {"1-4520311"}
    for region, cities in GEO.items():
        for city, state in cities:
            for idx in range(3 if city in THREE else 2):
                p = pool.pop()
                if idx == 0:
                    name = f"{p} Government College of Engineering, {city}"
                else:
                    name = rng.choice(TEMPLATES).format(p=p, c=city)
                out.append({"key": (city, idx), "name": name, "city": city, "state": state, "region": region})
    overrides = {("Pune", 0): "Sahyadri Government College of Engineering, Pune",
                 ("Bengaluru", 1): "Kaveri Institute of Technology, Bengaluru",
                 ("Coimbatore", 1): "Vidyasagar Institute of Technology, Coimbatore",
                 ("Tirupati", 1): "Vidyasagar Institute of Technology, Tirupati"}
    for i in out:
        if i["key"] in overrides:
            i["name"] = overrides[i["key"]]
        if i["key"] == ("Pune", 0):
            i["aicte_id"] = "1-4520311"
        else:
            while True:
                aid = "1-%07d" % rng.randint(1000000, 9999999)
                if aid not in used_ids:
                    used_ids.add(aid)
                    i["aicte_id"] = aid
                    break
        gov = "Government" in i["name"]
        i["type"] = "Government" if gov else rng.choice(["Private", "Private", "Private-Aided", "Deemed University"])
        i["programmes"] = rng.sample(PROGRAMMES, rng.randint(2, 4))
        i["est_year"] = rng.randint(1958, 2012)
        i["head_name"] = f"Dr. {rng.choice(FIRST)} {rng.choice(LAST)}"
        i["phone"] = "+91-%d-%07d" % (rng.randint(20, 80), rng.randint(2000000, 9999999))
        slug = "".join(ch for ch in i["name"].split(",")[0].lower() if ch.isalpha())[:18]
        i["email"] = f"principal@{slug}.edu.in"
        i["address"] = f"{rng.randint(1, 240)}, {rng.choice(['Station Road', 'College Road', 'Ring Road', 'Civil Lines', 'Knowledge Park'])}, {i['city']}, {i['state']} - {rng.randint(110000, 799999)}"
        w = REGION_WEIGHT[i["region"]] * rng.uniform(0.5, 1.5)
        i["weight"] = w
    # a few repeat-offender hotspots
    for i in rng.sample(out, 5):
        i["weight"] *= 3
    return out


def seed(conn):
    shutil.rmtree(db.ROOT / "data" / "uploads", ignore_errors=True)
    db.reset_schema(conn)

    rng = random.Random(42)
    now_dt = datetime.now().replace(microsecond=0)
    today = now_dt.date()

    insts = build_institutions(rng)
    by_key = {i["key"]: i for i in insts}

    for i in insts:
        conn.execute(
            "INSERT INTO institutions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                i["aicte_id"], i["name"], i["city"], i["state"],
                i["region"], i["address"], i["type"],
                json.dumps(i["programmes"]), i["est_year"],
                i["head_name"], i["phone"], i["email"]
            )
        )

    officers = {}
    for b, lst in OFFICERS.items():
        officers[b] = []
        for n, (name, desig) in enumerate(lst, 1):
            oid = f"OFF-{b}-{n:02d}"
            conn.execute(
                "INSERT INTO officers VALUES(?,?,?,?,?)",
                (oid, name, b, desig, n)
            )
            officers[b].append({
                "id": oid,
                "name": name,
                "designation": desig,
                "level": n
            })

    reg = intel.Registry(conn)
    specs = []

    def add(bureau, category, text, inst, form, quotes_id,
            days=None, plan="normal", sev=None, transfers=0):
        specs.append({
            "bureau": bureau,
            "category": category,
            "text": text,
            "inst": inst,
            "form": form,
            "quotes_id": quotes_id,
            "days": days,
            "plan": plan,
            "sev": sev or rng.randint(2, 5),
            "transfers": transfers
        })

    # 1. Planted overlap clusters
    for key, topic, members in PLANTED:
        for bureau, days, qid, form in members:
            cat, text = TOPIC[(topic, bureau)]
            add(
                bureau, cat, text, by_key[key], form, qid,
                days=days, sev=4 if bureau == "RB" else 3
            )

    # 2. Simulation targets
    for s in SIM:
        b, topic, days = s["staged"]
        cat, text = TOPIC[(topic, b)]
        add(
            b, cat, text, by_key[s["inst"]],
            "abbr", False, days=days, sev=4
        )

    # 3. Decoy: same name, different city
    add(
        "RB", *TOPIC[("faculty", "RB")],
        by_key[("Coimbatore", 1)], "abbr", False, days=12
    )
    add(
        "PGRC", *TOPIC[("faculty", "PGRC")],
        by_key[("Tirupati", 1)], "abbr", False, days=10
    )

    # 4. Old disposed case and a fresh case
    add(
        "PGRC", "Faculty Deficiency",
        DESC["Faculty Deficiency"][1],
        by_key[("Mangaluru", 0)], "full", True,
        days=430, plan="disposed_old"
    )
    add(
        "RB", "Faculty Deficiency",
        DESC["Faculty Deficiency"][0],
        by_key[("Mangaluru", 0)], "abbr", False, days=9
    )

    # Hero backstory: earlier faculty / academic complaints
    for b, cat, d in (
        ("RB", "Faculty Deficiency", 190),
        ("RB", "Faculty Deficiency", 330),
        ("PGRC", "Academic Quality", 250),
        ("PGRC", "Academic Quality", 400)
    ):
        add(
            b, cat, rng.choice(DESC[cat]),
            by_key[("Pune", 0)], "abbr", True,
            days=d, plan="disposed_old", sev=4
        )

    # 5. Decoy: same institution, unrelated topics
    add(
        "PGRC", "Fee Overcharging / Refund",
        DESC["Fee Overcharging / Refund"][0],
        by_key[("Mysuru", 1)], "full", True, days=7
    )
    add(
        "RB", "Infrastructure Deficiency",
        DESC["Infrastructure Deficiency"][1],
        by_key[("Mysuru", 1)], "abbr", False, days=5
    )

    # 6. Background cases
    corpus = sorted(
        {t for lst in DESC.values() for t in lst}
        | {t for _, t in TOPIC.values()}
    )
    tid = {t: f"txt{i}" for i, t in enumerate(corpus)}
    tmodel = intel.TextModel({tid[t]: t for t in corpus})

    def eligible(s):
        return (
            s["plan"] not in ("disposed", "disposed_old")
            or s["days"] <= 165
        )

    def proxy(s):
        return {
            "case_id": tid[s["text"]],
            "bureau_code": s["bureau"],
            "institution_id": s["inst"]["aicte_id"],
            "submitted_institution_name": s["inst"]["name"],
            "submitted_aicte_id": (
                s["inst"]["aicte_id"] if s["quotes_id"] else None
            ),
            "resolution_method": (
                "ID" if s["quotes_id"] else "NAME"
            ),
            "resolution_conf": 100.0,
            "category": s["category"],
            "description": s["text"],
            "received_on": str(
                today - timedelta(days=s["days"])
            )
        }

    def collides(new):
        """Check if a background case creates an accidental overlap."""
        if not eligible(new):
            return False

        for s in specs:
            if (
                s["inst"] is new["inst"]
                and eligible(s)
                and tid[s["text"]] != tid[new["text"]]
            ):
                if intel.score_pair(
                    proxy(s), proxy(new), tmodel
                ):
                    return True

            elif s["inst"] is new["inst"] and eligible(s):
                return True

        return False

    reserved = {
        by_key[("Pune", 0)]["aicte_id"],
        by_key[("Coimbatore", 1)]["aicte_id"],
        by_key[("Tirupati", 1)]["aicte_id"],
        by_key[("Mangaluru", 0)]["aicte_id"],
        by_key[("Mysuru", 1)]["aicte_id"]
    } | {
        by_key[x["inst"]]["aicte_id"] for x in SIM
    }

    weights = [
        0 if i["aicte_id"] in reserved else i["weight"]
        for i in insts
    ]

    # Long-stale open cases
    def stale(bureau, region, n, lo, hi):
        pool = [
            i for i in insts
            if i["region"] == region
            and i["aicte_id"] not in reserved
        ]
        made, tries = 0, 0

        while made < n and tries < 400:
            tries += 1
            cat = rng.choice(BUREAU_CATEGORIES[bureau])
            inst = rng.choice(pool)

            cand = {
                "bureau": bureau,
                "category": cat,
                "text": rng.choice(DESC[cat]),
                "inst": inst,
                "quotes_id": rng.random() < 0.5,
                "days": rng.randint(lo, hi),
                "plan": "breached"
            }

            if collides(cand):
                continue

            add(
                bureau, cat, cand["text"], inst,
                rng.choice(["full", "abbr", "upper"]),
                cand["quotes_id"],
                days=cand["days"],
                plan="breached",
                transfers=rng.choice([0, 1])
            )
            made += 1

    stale("RB", "Western", 16, 35, 80)
    stale("PGRC", "South-Western", 5, 25, 60)
    stale("AB", "Southern", 4, 50, 110)

    wbur = [0.37, 0.33, 0.15, 0.08, 0.07]
    plans = (
        ["disposed"] * 34
        + ["nearing"] * 9
        + ["breached"] * 15
        + ["transferred"] * 8
        + ["normal"] * 34
    )

    total = 300
    guard = 0

    while len(specs) < total and guard < 20000:
        guard += 1

        bureau = rng.choices(BUREAU_ORDER, wbur)[0]
        cat = rng.choice(BUREAU_CATEGORIES[bureau])
        inst = rng.choices(insts, weights)[0]
        plan = rng.choice(plans)

        # Issue #19: Use the configured category-specific SLA.
        rule = sla_rules.rule_for(conn, bureau, cat)
        sla = rule["days"]

        if plan == "normal":
            days = max(
                1, round(rng.uniform(0.05, 0.7) * sla)
            )
        elif plan == "nearing":
            days = round(
                rng.uniform(0.78, 0.97) * sla
            )
        elif plan == "breached":
            days = round(
                rng.uniform(
                    1.05,
                    3.0 if rng.random() < 0.5 else 1.7
                ) * sla
            )
        elif plan == "transferred":
            days = max(
                2, round(rng.uniform(0.15, 0.8) * sla)
            )
        else:
            days = rng.randint(25, 330)

        text = rng.choice(DESC[cat])

        cand = {
            "bureau": bureau,
            "category": cat,
            "text": text,
            "inst": inst,
            "quotes_id": rng.random() < 0.55,
            "days": days,
            "plan": plan
        }

        if collides(cand):
            continue

        add(
            bureau, cat, text, inst,
            rng.choice([
                "full", "abbr", "abbr",
                "upper", "alias", "typo"
            ]),
            cand["quotes_id"],
            days=days,
            plan=plan,
            transfers=(
                rng.choice([0, 0, 0, 1, 1, 2])
                if plan != "normal"
                else rng.choice([0, 0, 0, 1])
            )
        )

    # Ping-pong cases
    pp = [
        s for s in specs
        if s["plan"] in ("breached", "nearing")
    ][:4]

    for s in pp:
        s["transfers"] = 3

    # Insert cases in chronological order.
    mismatches = 0
    specs.sort(key=lambda s: -(s["days"] or 0))
    counters = {}

    for s in specs:
        bureau = s["bureau"]
        received = today - timedelta(days=s["days"])
        name = name_variant(
            s["inst"]["name"], s["form"], rng
        )
        aid = (
            s["inst"]["aicte_id"]
            if s["quotes_id"] else None
        )

        res = reg.resolve(name, aid)

        if (
            not res
            or res["institution_id"] != s["inst"]["aicte_id"]
        ):
            mismatches += 1
            res = {
                "institution_id": s["inst"]["aicte_id"],
                "method": "NAME",
                "confidence": 90.0
            }

        key = (bureau, received.year)
        counters[key] = counters.get(key, 0) + 1
        case_id = (
            f"{bureau}/{received.year}/{counters[key]:05d}"
        )

        # Issue #19: Resolve the rule for this exact category.
        rule = sla_rules.rule_for(
            conn, bureau, s["category"]
        )

        _insert_with_history(
            conn, rng, s, case_id, received,
            name, aid, res, rule["days"],
            officers, now_dt, rule=rule
        )

    if mismatches:
        print(
            f"[seed] note: {mismatches} case(s) fell back "
            "to intended institution (resolver ambiguity)"
        )

    # Run the real overlap engine.
    created = intel.detect(conn)
    best = {}

    for p in created:
        c = db.one(
            conn,
            "SELECT cluster_id FROM overlap_pairs WHERE id=?",
            (p["id"],)
        )
        key = c["cluster_id"]

        if (
            key not in best
            or p["score"] > best[key]["score"]
        ):
            best[key] = {**p, "cluster_id": key}

    for n, (cid, p) in enumerate(
        sorted(
            best.items(),
            key=lambda x: -x[1]["score"]
        )
    ):
        ts = now_dt - timedelta(hours=2 + n * 5)

        sev = (
            "HIGH" if p["band"] == "HIGH"
            else "MEDIUM"
        )

        conn.execute(
            "INSERT INTO alerts(type,severity,case_id,institution_id,pair_id,cluster_id,message,created_at,is_read)"
            " VALUES('OVERLAP',?,?,?,?,?,?,?,?)",
            (
                sev, p["case_a"], p["institution_id"],
                p["id"], cid, p["headline"],
                db.iso(ts), 1 if n > 5 else 0
            )
        )

    # ---------------------------------------------------
    # Issue #19: Working-day-aware seeded SLA alerts
    # ---------------------------------------------------

    holidays = sla_rules.holiday_dates(conn)

    open_cases = db.rows(
        conn,
        "SELECT * FROM cases WHERE status!='Disposed'"
    )

    overdue = []
    near = []

    for case in open_cases:
        progress = sla_rules.case_progress(
            case, today, holidays
        )

        elapsed = progress["age_days"] / progress["days"]
        warning = progress["warn_pct"] / 100

        if elapsed >= 1.0:
            overdue.append(case)
        elif elapsed >= warning:
            near.append(case)

    overdue.sort(key=lambda c: c["due_date"])
    near.sort(key=lambda c: c["due_date"])

    for n, c in enumerate(overdue[:8]):
        conn.execute(
            "INSERT INTO alerts(type,severity,case_id,institution_id,message,created_at,is_read) "
            "VALUES('SLA_BREACH','HIGH',?,?,?,?,?)",
            (
                c["case_id"],
                c["institution_id"],
                (
                    f"{c['case_id']} is beyond its prescribed "
                    f"timeline (due {c['due_date']})"
                ),
                db.iso(
                    now_dt - timedelta(hours=3 + n * 9)
                ),
                1
            )
        )

    for n, c in enumerate(near[:6]):
        conn.execute(
            "INSERT INTO alerts(type,severity,case_id,institution_id,message,created_at,is_read) "
            "VALUES('SLA_NEAR','MEDIUM',?,?,?,?,?)",
            (
                c["case_id"],
                c["institution_id"],
                (
                    f"{c['case_id']} is nearing its "
                    f"timeline (due {c['due_date']})"
                ),
                db.iso(
                    now_dt - timedelta(hours=5 + n * 8)
                ),
                1
            )
        )

    _seed_documents(conn, rng, now_dt)
    sla_engine.init_state(conn)

    db.set_setting(conn, "sim_counter", "0")
    conn.commit()



def _insert_with_history(conn, rng, s, case_id, received, name, aid, res, sla, officers, now_dt, rule=None):
    bureau = s["bureau"]
    rule = rule or sla_rules.rule_for(conn, bureau, s["category"])
    holidays = sla_rules.holiday_dates(conn) if rule["use_working_days"] else None
    due = sla_rules.due_date(received, rule, holidays)
    plan = s["plan"]
    t0 = datetime.combine(received, time(10, 0)) + timedelta(minutes=rng.randint(0, 300))
    disposed = plan in ("disposed", "disposed_old")
    if disposed:
        span_days = max(3, round(rng.uniform(0.2, 1.2) * sla)) if plan == "disposed" else 50
        end = min(t0 + timedelta(days=span_days), now_dt - timedelta(hours=3))
        if plan == "disposed_old":
            end = t0 + timedelta(days=50)
    else:
        end = now_dt - timedelta(hours=rng.randint(2, 30))
    if end <= t0 + timedelta(hours=2):
        end = t0 + timedelta(hours=2)
    span = (end - t0).total_seconds()

    n_tr = s["transfers"] if not disposed or plan == "disposed" else 0
    if plan == "transferred":
        n_tr = max(1, n_tr)
    mids = ["TRANSFER"] * n_tr + ["REMARK"] * rng.choice([0, 1, 1, 2]) if span > 4 * 86400 else ["TRANSFER"] * n_tr
    rng.shuffle(mids)
    if plan == "transferred":
        if "TRANSFER" in mids:
            mids.remove("TRANSFER")
        mids.append("TRANSFER")
    esc_kind = None
    status = "Under Process"
    if plan == "normal":
        status = "Received" if s["days"] <= 3 and not mids else ("Pending Info" if rng.random() < 0.2 else "Under Process")
    elif plan == "nearing":
        status = "Pending Info" if rng.random() < 0.2 else "Under Process"
    elif plan == "breached":
        status, esc_kind = "Escalated", rng.choice(["ESCALATE", "AUTO_ESCALATE"])
    elif plan == "transferred":
        status = "Transferred"
    elif disposed:
        status = "Disposed"
    fr = sorted(rng.uniform(0.18, 0.88) for _ in mids)

    cur = bureau
    off = rng.choice(officers[cur][:2])
    events = [(t0, "RECEIVED", "Diary Section", "SYS", cur, None, None,
               f"Complaint received via {rng.choice(SOURCES)} and diarised as {case_id}")]
    events.append((t0 + timedelta(minutes=rng.randint(30, 600)), "ASSIGNED", off["name"], off["id"], cur, None, None,
                   f"Assigned to {off['name']} ({off['designation']}), {cur}"))
    transfers = 0
    last_label = events[-1][7]
    last_ts = events[-1][0]
    for kind, f in zip(mids, fr):
        ts = t0 + timedelta(seconds=span * f)
        if kind == "TRANSFER":
            to = rng.choice([b for b in BUREAU_ORDER if b != cur])
            events.append((ts, "TRANSFER", off["name"], off["id"], cur, cur, to, rng.choice(TRANSFER_R)))
            last_label = f"Transferred from {cur} to {to}"
            cur = to
            off = rng.choice(officers[cur][:2])
            transfers += 1
        else:
            events.append((ts, "REMARK", off["name"], off["id"], cur, None, None, rng.choice(REMARKS)))
            last_label = events[-1][7]
        last_ts = ts
    esc_level = 0
    if esc_kind:
        n_esc = 2 if s["days"] / sla >= 1.5 else 1
        for k in range(n_esc):
            ts = max(last_ts + timedelta(minutes=30), t0 + timedelta(seconds=span * (0.82 + 0.07 * k)))
            boss = officers[cur][2 + k]
            who = f"{boss['name']} ({boss['designation']})"
            tail = ", Competent Authority" if k == 1 else ""
            if esc_kind == "AUTO_ESCALATE" or k == 1:
                events.append((ts, "AUTO_ESCALATE", "System (SLA engine)", "SYS", cur, cur, cur,
                               f"Timeline of {sla} days exceeded; auto-escalated to {who}{tail}"))
            else:
                events.append((ts, "ESCALATE", off["name"], off["id"], cur, cur, cur,
                               f"Escalated to {who} as the case is overdue"))
            last_label, last_ts, esc_level = f"Escalated to {boss['designation']}", ts, k + 1
            off = boss
    outcome = None
    disposed_on = None
    if disposed:
        outcome = rng.choice(OUTCOMES)
        events.append((end, "DISPOSE", off["name"], off["id"], cur, None, None, outcome))
        last_label, last_ts, disposed_on = f"Disposed: {outcome}", end, end.date()

    if status == "Received":
        nxt = "Assign and scrutinise"
    elif status == "Pending Info":
        nxt = "Await reply from the institution"
    elif status == "Transferred":
        nxt = f"{cur} to acknowledge and examine"
    elif status == "Escalated":
        nxt = "Director to review and issue directions"
    elif status == "Disposed":
        nxt = "—"
    else:
        nxt = rng.choice(NEXT_ACTIONS)

    conn.execute(
        "INSERT INTO cases(case_id,reference_no,institution_id,submitted_institution_name,submitted_aicte_id,"
        "resolution_method,resolution_conf,source,received_on,category,category_group,severity,description,status,"
        "origin_bureau,bureau_code,assigned_officer_id,last_action,last_action_at,next_action,sla_days,due_date,"
        "escalation_level,transfer_count,disposed_on,outcome,sla_use_working_days,sla_warn_pct) "
        "VALUES(" + ",".join(["?"] * 28) + ")",
        (case_id, f"{bureau}-{rng.randint(1000, 9999)}/{received.year}", res["institution_id"], name, aid,
         res["method"], res["confidence"], rng.choice(SOURCES), str(received), s["category"],
         CATEGORY_GROUP[s["category"]], s["sev"], s["text"], status, bureau, cur, off["id"], last_label,
         db.iso(last_ts), nxt, sla, str(due), esc_level, transfers,
         str(disposed_on) if disposed_on else None, outcome,
         int(rule["use_working_days"]), rule["warn_pct"]))
    for ts, kind, actor, aid_, abureau, fb, tb, remarks in sorted(events, key=lambda e: e[0]):
        db.append_action(conn, case_id, db.iso(ts), aid_, actor, abureau, kind, fb, tb, remarks)


def _seed_documents(conn, rng, now_dt):
    """Attach small synthetic supporting documents (real files) to a share of cases."""
    base = db.ROOT / "data" / "uploads"
    for c in db.rows(conn, "SELECT case_id,institution_id,received_on,category,description,status FROM cases"):
        inst = db.one(conn, "SELECT name FROM institutions WHERE aicte_id=?", (c["institution_id"],))["name"]
        hist = db.rows(conn, "SELECT seq,ts,actor_name FROM action_history WHERE case_id=? ORDER BY seq", (c["case_id"],))
        docs = []
        if rng.random() < 0.55:
            docs.append((1, "Complaint_letter.txt",
                         f"SYNTHETIC DOCUMENT (prototype)\nComplaint letter\nCase: {c['case_id']}\nInstitution: {inst}\n"
                         f"Category: {c['category']}\nReceived: {c['received_on']}\n\n{c['description']}\n"))
        if len(hist) >= 4 and rng.random() < 0.3:
            docs.append((3, "Inspection_report.txt",
                         f"SYNTHETIC DOCUMENT (prototype)\nInspection report\nCase: {c['case_id']}\nInstitution: {inst}\n"
                         f"Findings: observations recorded by the Regional Office; clarification sought from the institution.\n"))
        for seq, fname, text in docs:
            raw = text.encode("utf-8")
            sha = hashlib.sha256(raw).hexdigest()
            folder = base / c["case_id"].replace("/", "_")
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"{sha[:8]}_{fname}"
            path.write_bytes(raw)
            ev = next((h for h in hist if h["seq"] == seq), hist[0])
            conn.execute("INSERT INTO documents(case_id,seq,filename,path,sha256,size,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?)",
                         (c["case_id"], ev["seq"], fname, str(path), sha, len(raw), ev["actor_name"], ev["ts"]))


# ---- live path (Simulate New Complaint) --------------------------------------------

def simulate_spec(conn, n):
    """Build the n-th scripted complaint (0-based, cycles through SIM)."""
    s = SIM[n % len(SIM)]
    inst_row = None
    city, idx = s["inst"]
    rows = db.rows(conn, "SELECT * FROM institutions WHERE city=? ORDER BY rowid", (city,))
    inst_row = rows[idx]
    bureau, topic, form = s["new"]
    cat, text = TOPIC[(topic, bureau)]
    rng = random.Random(1000 + n)
    return {"bureau": bureau, "category": cat, "text": text, "name": name_variant(inst_row["name"], form, rng),
            "institution": inst_row}
