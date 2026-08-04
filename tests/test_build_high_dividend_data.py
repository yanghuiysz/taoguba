import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_high_dividend_data import build_snapshot, main, snapshot_is_usable


ROOT = Path(__file__).resolve().parents[1]


class BuilderTests(unittest.TestCase):
    def test_snapshot_has_pools_summary_and_states(self):
        source = json.loads((ROOT / "tests/fixtures/high_dividend_source.json").read_text(encoding="utf-8"))
        config = json.loads((ROOT / "web/data/high_dividend_config.json").read_text(encoding="utf-8"))
        result = build_snapshot(source, config, "2026-08-04")
        self.assertEqual(result["version"], 1)
        self.assertEqual(len(result["stocks"]), 8)
        self.assertEqual(result["summary"]["total"], 8)
        self.assertIn("stable", result["summary"]["pools"])
        self.assertIn("可关注", result["summary"]["states"])

    def test_cli_writes_fixture_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "latest.json"
            rc = main(["--date", "2026-08-04", "--source-json", str(ROOT / "tests/fixtures/high_dividend_source.json"), "--output", str(output)])
            self.assertEqual(rc, 0)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["version"], 1)

    def test_malformed_stock_is_retained_as_missing(self):
        source = json.loads((ROOT / "tests/fixtures/high_dividend_source.json").read_text(encoding="utf-8"))
        source["stocks"][0]["price"] = "not-a-number"
        config = json.loads((ROOT / "web/data/high_dividend_config.json").read_text(encoding="utf-8"))
        result = build_snapshot(source, config, "2026-08-04")
        self.assertEqual(result["stocks"][0]["state"], "数据不足")

    def test_all_missing_live_seed_is_not_usable(self):
        source = {"date": "2026-08-04", "bondYield": 0.017, "bondDate": "2026-08-04", "source": {"kind": "akshare-live-seed"}, "stocks": [
            {"code": "600036", "name": "招商银行", "industry": "", "price": 30, "listingDate": "2002-04-09", "avgTurnover20": None, "dividends": [], "dividendYears": [], "ttmDividend": None, "latestProfit": None, "qualityScore": None}
        ]}
        config = json.loads((ROOT / "web/data/high_dividend_config.json").read_text(encoding="utf-8"))
        self.assertFalse(snapshot_is_usable(build_snapshot(source, config, "2026-08-04")))


if __name__ == "__main__":
    unittest.main()
