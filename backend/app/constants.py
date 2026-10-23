"""Shared constants: bureaus, SLA, statuses, categories, regions."""

BUREAUS = {
    "RB": "Regulation Bureau",
    "PGRC": "Public Grievance Redressal Cell",
    "AB": "Approval Bureau",
    "LC": "Legal Cell",
    "VIG": "Vigilance Cell",
}
BUREAU_ORDER = list(BUREAUS)

# Illustrative prescribed timelines (days). Replace with AICTE's actual SLAs.
SLA_DAYS = {"RB": 30, "PGRC": 21, "AB": 45, "LC": 60, "VIG": 45}

STATUSES = ["Received", "Under Process", "Pending Info", "Transferred", "Escalated", "Disposed"]

CATEGORIES = [
    ("Faculty Deficiency", "Academic Compliance"),
    ("Academic Quality", "Academic Compliance"),
    ("Infrastructure Deficiency", "Academic Compliance"),
    ("Excess Intake / Approval Violation", "Approval & Regulation"),
    ("Affiliation / Approval Dispute", "Approval & Regulation"),
    ("Unapproved Programme", "Approval & Regulation"),
    ("Fee Overcharging / Refund", "Financial"),
    ("Financial Irregularity", "Financial"),
    ("Ragging / Safety", "Student Welfare"),
    ("Admission Irregularity", "Student Welfare"),
    ("Placement Misrepresentation", "Student Welfare"),
    ("Document Withholding", "Student Welfare"),
]
CATEGORY_GROUP = dict(CATEGORIES)

BUREAU_CATEGORIES = {
    "RB": ["Faculty Deficiency", "Infrastructure Deficiency", "Excess Intake / Approval Violation",
           "Unapproved Programme", "Academic Quality"],
    "PGRC": ["Academic Quality", "Fee Overcharging / Refund", "Ragging / Safety", "Admission Irregularity",
             "Placement Misrepresentation", "Document Withholding", "Faculty Deficiency"],
    "AB": ["Affiliation / Approval Dispute", "Excess Intake / Approval Violation",
           "Infrastructure Deficiency", "Unapproved Programme"],
    "LC": ["Affiliation / Approval Dispute", "Unapproved Programme", "Fee Overcharging / Refund",
           "Admission Irregularity"],
    "VIG": ["Financial Irregularity", "Fee Overcharging / Refund", "Admission Irregularity"],
}

REGION_STATES = {
    "Northern": ["Delhi", "Uttar Pradesh", "Uttarakhand"],
    "North-Western": ["Punjab", "Haryana", "Rajasthan", "Himachal Pradesh", "Jammu & Kashmir", "Chandigarh"],
    "Central": ["Madhya Pradesh", "Chhattisgarh"],
    "Eastern": ["West Bengal", "Odisha", "Bihar", "Jharkhand", "Assam"],
    "Western": ["Maharashtra", "Gujarat", "Goa"],
    "South-Western": ["Karnataka"],
    "South-Central": ["Telangana", "Andhra Pradesh"],
    "Southern": ["Tamil Nadu", "Kerala"],
}

OPEN_STATUSES = ["Received", "Under Process", "Pending Info", "Transferred", "Escalated"]

HEADLINE_HIGH = "Potential Overlapping Cases - Coordination Required"
HEADLINE_MEDIUM = "Possible Overlap - Review Recommended"
HEADLINE_DUP = "Potential Duplicate Complaint"
