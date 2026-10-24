"""Unit tests for entity extractor (Issue #11).

Tests positive extraction, negative rejection (no false positives for ordinary prose),
numeric amount normalization, edge cases (None, empty, large input).
"""
import pytest
from app import intel


class TestEntityExtractionPrecision:
    # 15+ negative strings that must NOT produce false positive entities
    NEGATIVE_CORPUS = [
        "Please file documents in the record room.",
        "We need to order the supplies before next Friday.",
        "Give preference to second-year students.",
        "The professor took the roll call in the morning.",
        "Regular attendance is mandatory for all courses.",
        "The registered office is situated in New Delhi.",
        "Reference checks are being processed by HR.",
        "The student filed a complaint regarding delay in results.",
        "Court issued an order regarding the land dispute.",
        "A notification was sent to all affiliated colleges.",
        "Enrollment process will commence next month.",
        "Hall ticket issuance date has not been announced yet.",
        "There is no registration fee for the national workshop.",
        "Please order the committee to submit the final report.",
        "In reference to your recent inquiry, we clarify the rules.",
        "File your objections within fifteen days.",
        "Attendance roll must be maintained by faculty members.",
    ]

    # 15+ positive strings with various official formats
    POSITIVE_CORPUS = [
        ("Student paid ₹45,000 fee as per Circular No. AICTE/2026/04.",
         {"amounts": ["₹45,000"], "amount_values": [45000], "circulars": ["AICTE/2026/04"]}),
        ("Ref: AICTE-2023-11 issued for refund of fees.",
         {"circulars": ["AICTE-2023-11"]}),
        ("F.No. 12-3/2025 states the guidelines.",
         {"circulars": ["12-3/2025"]}),
        ("Pursuant to Order #2024/99 dated 15 Jan.",
         {"circulars": ["2024/99"]}),
        ("Notification No. 45/2024 published today.",
         {"circulars": ["45/2024"]}),
        ("Roll no: ENR-99214 reported malpractice.",
         {"roll_numbers": ["ENR-99214"]}),
        ("Registration No. 2024-REG-991 applied for transfer.",
         {"roll_numbers": ["2024-REG-991"]}),
        ("Student with hall ticket HT2026001 was absent.",
         {"roll_numbers": ["HT2026001"]}),
        ("Enrollment #123456 verified by the cell.",
         {"roll_numbers": ["123456"]}),
        ("Institution demanded Rs. 1.5 lakh capitation fee.",
         {"amounts": ["Rs. 1.5 lakh"], "amount_values": [150000]}),
        ("Building fund of 2 crore was diverted.",
         {"amounts": ["2 crore"], "amount_values": [20000000]}),
        ("Fine of INR 50,000 was imposed by the council.",
         {"amounts": ["INR 50,000"], "amount_values": [50000]}),
        ("Refund of 25000 rupees was processed.",
         {"amounts": ["25000 rupees"], "amount_values": [25000]}),
        ("Under File No. 8-12/2026 the matter was closed.",
         {"circulars": ["8-12/2026"]}),
        ("Candidate reg no: REG-88120 requested duplicate marksheet.",
         {"roll_numbers": ["REG-88120"]}),
        ("Demand draft of ₹ 75,000 submitted against order 99/2025.",
         {"amounts": ["₹ 75,000"], "amount_values": [75000], "circulars": ["99/2025"]}),
    ]

    @pytest.mark.parametrize("text", NEGATIVE_CORPUS)
    def test_negative_corpus_no_false_positives(self, text):
        """Ordinary prose words (file, order, ref, roll, reg) must produce zero entities."""
        res = intel.extract_entities(text)
        assert res["circulars"] == [], f"Unexpected circular matched in: {text}"
        assert res["roll_numbers"] == [], f"Unexpected roll number matched in: {text}"

    @pytest.mark.parametrize("text,expected", POSITIVE_CORPUS)
    def test_positive_corpus_matches(self, text, expected):
        """Recognised entity patterns must be extracted and normalised."""
        res = intel.extract_entities(text)
        if "amounts" in expected:
            for exp in expected["amounts"]:
                assert any(exp in a for a in res["amounts"]), f"Expected amount {exp} in {res['amounts']}"
        if "amount_values" in expected:
            for exp_val in expected["amount_values"]:
                assert exp_val in res["amount_values"], f"Expected value {exp_val} in {res['amount_values']}"
        if "circulars" in expected:
            for exp_circ in expected["circulars"]:
                assert exp_circ in res["circulars"], f"Expected circular {exp_circ} in {res['circulars']}"
        if "roll_numbers" in expected:
            for exp_roll in expected["roll_numbers"]:
                assert exp_roll in res["roll_numbers"], f"Expected roll {exp_roll} in {res['roll_numbers']}"

    def test_amount_conversions(self):
        """Test numeric lakh, crore and standard rupee conversions."""
        cases = [
            ("demanded 1.5 lakh", 150000),
            ("diverted 2 crore", 20000000),
            ("penalty of Rs. 45,000", 45000),
            ("fee of ₹50,000", 50000),
            ("INR 1,20,000 paid", 120000),
            ("grant of 0.5 crore", 5000000),
            ("3 lakhs sanctioned", 300000),
        ]
        for text, expected_num in cases:
            res = intel.extract_entities(text)
            assert expected_num in res["amount_values"], f"Failed for {text}: got {res['amount_values']}"

    def test_edge_cases(self):
        """Test None, empty string, and very large text."""
        assert intel.extract_entities("") == {"amounts": [], "amount_values": [], "circulars": [], "roll_numbers": []}
        assert intel.extract_entities(None) == {"amounts": [], "amount_values": [], "circulars": [], "roll_numbers": []}
        
        # 100 kB text with embedded entities at start and end
        large_text = "Student filed complaint. " * 4000 + " Circular No. AICTE/2026/999. ₹10,000 fee."
        res = intel.extract_entities(large_text)
        assert isinstance(res, dict)
        assert "amounts" in res
        assert "circulars" in res

    def test_explicit_rejection_of_problem_statement_examples(self):
        """Issue #11 explicitly names 'file documents', 'order the', 'preference'."""
        assert intel.extract_entities("file documents")["circulars"] == []
        assert intel.extract_entities("order the")["circulars"] == []
        assert intel.extract_entities("preference")["circulars"] == []
        assert intel.extract_entities("roll call")["roll_numbers"] == []
        assert intel.extract_entities("regular attendance")["roll_numbers"] == []
