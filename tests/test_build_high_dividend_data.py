import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from scripts.build_high_dividend_data import (
    build_snapshot,
    calculate_technical_guide,
    main,
    parse_dividend_history,
    parse_financial_quality,
    parse_valuation,
    retry_fetch,
    snapshot_is_usable,
)


ROOT = Path(__file__).resolve().parents[1]


class BuilderTests(unittest.TestCase):
    def test_snapshot_has_pools_summary_and_states(self):
        source = json.loads((ROOT / "tests/fixtures/high_dividend_source.json").read_text(encoding="utf-8"))
        config = json.loads((ROOT / "web/data/high_dividend_config.json").read_text(encoding="utf-8"))
        result = build_snapshot(source, config, "2026-08-04")
        self.assertEqual(result["version"], 1)
        self.assertGreaterEqual(len(result["stocks"]), 8)
        self.assertEqual(result["summary"]["total"], len(result["stocks"]))
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

    def test_watchlist_catalog_keeps_uncovered_stock_visible(self):
        source = {"bondYield": 0.017, "bondDate": "2026-08-04", "stocks": []}
        config = {
            "stableIndustries": [],
            "cyclicalIndustries": [],
            "poolOverrides": {"600941": "stable"},
            "watchlist": ["600941"],
            "watchlistCatalog": [
                {"code": "600941", "name": "中国移动", "industry": "电信运营"}
            ],
        }
        result = build_snapshot(source, config, "2026-08-04")
        stock = result["stocks"][0]
        self.assertEqual(stock["code"], "600941")
        self.assertTrue(stock["watchlisted"])
        self.assertEqual(stock["state"], "数据不足")

    def test_dividend_parser_aggregates_cash_by_report_year(self):
        frame = pd.DataFrame([
            {"派息比例": 5.0, "报告时间": "2024中报"},
            {"派息比例": 10.0, "报告时间": "2024年报"},
            {"派息比例": 12.0, "报告时间": "2025年报"},
        ])
        dividends, years = parse_dividend_history(frame, 2024, 2025)
        self.assertEqual(years, [2024, 2025])
        self.assertEqual(dividends, [1.5, 1.2])

    def test_financial_parser_uses_latest_annual_profitability(self):
        frame = pd.DataFrame([
            {"日期": "2025-09-30", "每股收益_调整后(元)": 2.0, "净资产收益率(%)": 12.0, "股息发放率(%)": 60.0},
            {"日期": "2024-12-31", "每股收益_调整后(元)": 1.5, "净资产收益率(%)": 10.0, "股息发放率(%)": 55.0},
            {"日期": "2025-12-31", "每股收益_调整后(元)": 1.8, "净资产收益率(%)": 11.0, "股息发放率(%)": 58.0},
        ])
        result = parse_financial_quality(frame)
        self.assertEqual(result["latestProfit"], 1.8)
        self.assertEqual(result["payoutRatio"], 0.58)
        self.assertGreaterEqual(result["qualityScore"], 70)

    def test_retry_fetch_recovers_from_transient_provider_error(self):
        attempts = []
        def flaky():
            attempts.append(1)
            if len(attempts) < 3:
                raise ValueError("temporary")
            return "ok"
        self.assertEqual(retry_fetch(flaky, attempts=3), "ok")
        self.assertEqual(len(attempts), 3)

    def test_valuation_parser_uses_latest_available_value(self):
        frame = pd.DataFrame([
            {"date": "2026-08-03", "value": 12.4},
            {"date": "2026-08-04", "value": 11.8},
        ])
        self.assertEqual(parse_valuation(frame), {"value": 11.8, "date": "2026-08-04", "percentile": 50.0, "low": 11.8, "high": 12.4, "samples": 2})

    def test_valuation_percentile_places_latest_value_in_history(self):
        frame = pd.DataFrame([
            {"date": f"2026-08-0{index + 1}", "value": value}
            for index, value in enumerate([8.0, 10.0, 12.0, 14.0, 10.0])
        ])
        result = parse_valuation(frame)
        self.assertEqual(result["value"], 10.0)
        self.assertEqual(result["percentile"], 60.0)
        self.assertEqual(result["samples"], 5)

    def test_technical_guide_returns_price_zone_and_risk_controls(self):
        closes = [10 + index * 0.05 for index in range(60)]
        frame = pd.DataFrame({
            "date": pd.date_range("2026-05-01", periods=60),
            "close": closes,
            "high": [value + 0.2 for value in closes],
            "low": [value - 0.2 for value in closes],
            "amount": [100_000_000] * 60,
        })
        guide = calculate_technical_guide(frame)
        self.assertEqual(guide["asOf"], "2026-06-29")
        self.assertGreater(guide["resistance20"], guide["support20"])
        self.assertIn(guide["signal"], {"低吸观察", "持有等待", "高抛观察"})
        self.assertIsNotNone(guide["ma20"])
        self.assertIsNotNone(guide["ma60"])


if __name__ == "__main__":
    unittest.main()
