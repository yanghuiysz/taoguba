import copy
import json
import unittest
from pathlib import Path

from scripts.validate_web_data import validate_high_dividend


ROOT = Path(__file__).resolve().parents[1]


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / "web/data/high_dividend/latest.json").read_text(encoding="utf-8"))

    def test_valid_snapshot(self):
        result = validate_high_dividend(self.payload)
        self.assertEqual(result["stocks"], len(self.payload["stocks"]))

    def test_rejects_duplicate_code_and_invalid_enum(self):
        duplicate = copy.deepcopy(self.payload)
        duplicate["stocks"].append(copy.deepcopy(duplicate["stocks"][0]))
        with self.assertRaises(ValueError):
            validate_high_dividend(duplicate)
        invalid = copy.deepcopy(self.payload)
        invalid["stocks"][0]["state"] = "买入"
        with self.assertRaises(ValueError):
            validate_high_dividend(invalid)

    def test_rejects_empty_reasons(self):
        invalid = copy.deepcopy(self.payload)
        invalid["stocks"][0]["reasons"] = []
        with self.assertRaises(ValueError):
            validate_high_dividend(invalid)

    def test_rejects_missing_valuation_or_trading_guide(self):
        for field in ["peTtm", "pePercentile5y", "pb", "fitScore", "technicalGuide"]:
            invalid = copy.deepcopy(self.payload)
            invalid["stocks"][0].pop(field, None)
            with self.assertRaises(ValueError, msg=field):
                validate_high_dividend(invalid)


if __name__ == "__main__":
    unittest.main()
