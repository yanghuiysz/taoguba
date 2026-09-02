import importlib.util
import math
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("build_cyb_trend_stats.py")
SPEC = importlib.util.spec_from_file_location("build_cyb_trend_stats", MODULE_PATH)
trend = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = trend
SPEC.loader.exec_module(trend)

VALIDATOR_PATH = Path(__file__).with_name("validate_web_data.py")
VALIDATOR_SPEC = importlib.util.spec_from_file_location("validate_web_data", VALIDATOR_PATH)
validator = importlib.util.module_from_spec(VALIDATOR_SPEC)
sys.modules[VALIDATOR_SPEC.name] = validator
VALIDATOR_SPEC.loader.exec_module(validator)


def row(date, time, price):
    return {"date": date, "time": time, "price": price, "volume": 1.0, "amount": 1.0}


def dt(date, time):
    return datetime.strptime(date + time, "%Y%m%d%H%M%S")


def bars_from_prices(prices, start=None):
    start = start or dt("20260811", "093000")
    bars = []
    current = start
    for price in prices:
        if current.hour == 11 and current.minute == 30:
            current = current.replace(hour=13, minute=0)
        bars.append({
            "date": current.strftime("%Y%m%d"),
            "time": current.strftime("%H%M%S"),
            "price": float(price),
            "dt": current,
        })
        current += timedelta(minutes=1)
    return bars


def bars_from_timed_prices(points, date="20260811"):
    return [
        {
            "date": date,
            "time": time,
            "price": float(price),
            "dt": dt(date, time),
        }
        for time, price in points
    ]


def k15_from_ranges(highs, lows):
    return [
        {"label": f"2026-08-11 10:{index:02d}", "O": low, "H": high, "L": low, "C": high}
        for index, (high, low) in enumerate(zip(highs, lows))
    ]


class CybFoundationTests(unittest.TestCase):
    def test_parse_eastmoney_trends_uses_minute_close(self):
        payload = {
            "data": {
                "trends": [
                    "2026-08-12 09:30,4070.10,4071.25,4072.00,4069.50,123,456.0,4070.80",
                ],
            },
        }

        records = trend.parse_eastmoney_trends(payload)

        self.assertEqual(records, [{
            "date": "20260812",
            "time": "093000",
            "price": 4071.25,
            "volume": 123.0,
            "amount": 456.0,
        }])

    def test_fetch_minute_days_falls_back_to_eastmoney(self):
        fallback = [row("20260812", "093000", 100)]
        with patch.object(trend, "fetch_westock_minute_days", side_effect=RuntimeError("network")), patch.object(
            trend, "fetch_eastmoney_minute_days", return_value=fallback
        ) as eastmoney:
            records = trend.fetch_minute_days(2)

        self.assertEqual(records, fallback)
        eastmoney.assert_called_once_with(2)

    def test_westock_uses_argument_list_without_shell(self):
        output = "| code | date | time | price | volume | amount |\n| sz399006 | 20260814 | 093000 | 100 | 1 | 2 |"
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr="")
        with patch.dict(trend.os.environ, {"NPX": r"C:\Program Files\nodejs\npx.cmd"}), patch.object(
            trend.subprocess, "run", return_value=completed
        ) as run:
            records = trend.fetch_westock_minute_days(5)

        args, kwargs = run.call_args
        self.assertEqual(args[0][0], r"C:\Program Files\nodejs\npx.cmd")
        self.assertIn("westock-data-clawhub@1.0.4", args[0])
        self.assertIn("sz399006", args[0])
        self.assertFalse(kwargs.get("shell", False))
        self.assertEqual(records[0]["date"], "20260814")

    def test_westock_business_error_is_not_treated_as_empty_success(self):
        completed = subprocess.CompletedProcess([], 0, stdout="执行失败 [SKILL_006]: 未找到数据", stderr="")
        with patch.object(trend.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(RuntimeError, "未找到数据"):
                trend.fetch_westock_minute_days(5)

    def test_fetch_minute_days_prefers_westock(self):
        primary = [row("20260814", "093000", 100)]
        with patch.object(trend, "fetch_westock_minute_days", return_value=primary) as westock, patch.object(
            trend, "fetch_eastmoney_minute_days"
        ) as eastmoney:
            records = trend.fetch_minute_days(5)

        self.assertEqual(records, primary)
        westock.assert_called_once_with(5)
        eastmoney.assert_not_called()

    def test_prepare_bars_sorts_deduplicates_and_filters(self):
        records = [
            row("20260811", "093100", 101),
            row("20260811", "093000", 100),
            row("20260811", "093100", 102),
            row("20260811", "120000", 999),
            row("20260811", "093200", -1),
            row("20260811", "093300", math.nan),
        ]

        bars = trend.prepare_minute_bars(records)

        self.assertEqual(
            [(bar["time"], bar["price"]) for bar in bars],
            [("093000", 100.0), ("093100", 102.0)],
        )

    def test_trading_minutes_excludes_lunch_break(self):
        self.assertEqual(
            trend.trading_minutes_between(
                dt("20260811", "112000"),
                dt("20260811", "131000"),
            ),
            20,
        )

    def test_resample_15min_builds_ohlc(self):
        bars = trend.prepare_minute_bars([
            row("20260811", "093000", 100),
            row("20260811", "093500", 103),
            row("20260811", "094000", 99),
            row("20260811", "094400", 101),
        ])

        result = trend.resample_15min(bars)

        self.assertEqual(len(result), 1)
        self.assertEqual(
            {key: result[0][key] for key in ("label", "O", "H", "L", "C")},
            {
                "label": "2026-08-11 09:30",
                "O": 100.0,
                "H": 103.0,
                "L": 99.0,
                "C": 101.0,
            },
        )


class CybDipTests(unittest.TestCase):
    def test_consecutive_bearish_15min_bars_merge_into_one_dip(self):
        bars = bars_from_timed_prices([
            ("093000", 100), ("094400", 99.5),
            ("094500", 99.4), ("095900", 99.0),
            ("100000", 99.1), ("101400", 100.0),
        ])

        dips = trend.detect_dips(bars)

        self.assertEqual(len(dips), 1)
        self.assertEqual(dips[0]["type"], "2连阴")
        self.assertEqual(dips[0]["peak"], 100.0)
        self.assertEqual(dips[0]["trough"], 99.0)

    def test_bullish_15min_bar_splits_two_bearish_waves(self):
        bars = bars_from_timed_prices([
            ("093000", 100), ("094400", 99.0),
            ("094500", 99.1), ("095900", 100.0),
            ("100000", 100.0), ("101400", 98.0),
            ("101500", 98.2), ("102900", 99.5),
        ])

        dips = trend.detect_dips(bars)

        self.assertEqual(len(dips), 2)
        self.assertEqual([dip["type"] for dip in dips], ["单阴", "单阴"])

    def test_recovery_is_measured_after_trough_until_next_wave_or_close(self):
        bars = bars_from_timed_prices([
            ("093000", 100), ("094400", 99.0),
            ("094500", 99.2), ("095000", 99.5), ("095900", 100.2),
        ])

        dip = trend.detect_dips(bars)[0]

        self.assertEqual(dip["recoveryRate"], 100.0)
        self.assertEqual(dip["recovery50Minutes"], 6)
        self.assertTrue(dip["fullyRecovered"])


class CybMajorDipTests(unittest.TestCase):
    def test_decline_below_threshold_is_ignored(self):
        dips = trend.detect_major_dips(bars_from_prices([100, 99.21, 100]))
        self.assertEqual(dips, [])

    def test_exact_threshold_decline_and_rebound_are_confirmed(self):
        dips = trend.detect_major_dips(bars_from_prices([100, 99.2, 100]))

        self.assertEqual(len(dips), 1)
        self.assertEqual(dips[0]["depth"], 0.8)
        self.assertEqual(dips[0]["confirmTime"], "09:32")
        self.assertEqual(dips[0]["status"], "已确认")

    def test_open_decline_is_settled_at_close(self):
        dips = trend.detect_major_dips(bars_from_prices([100, 99.0, 99.4]))

        self.assertEqual(len(dips), 1)
        self.assertIsNone(dips[0]["confirmTime"])
        self.assertEqual(dips[0]["status"], "收盘未确认")

    def test_two_confirmed_major_dips_are_kept_separate(self):
        dips = trend.detect_major_dips(bars_from_prices([100, 99, 100, 101, 100, 101]))

        self.assertEqual(len(dips), 2)
        self.assertTrue(all(dip["status"] == "已确认" for dip in dips))

    def test_day_stats_include_independent_major_dip_summary(self):
        records = [row(bar["date"], bar["time"], bar["price"]) for bar in bars_from_prices(
            [100, 99, 100, 101, 100, 100.4]
        )]

        day = trend.build_day_stats(records)[0]

        self.assertEqual(day["majorDipCount"], 2)
        self.assertEqual(day["majorDipConfirmedCount"], 1)
        self.assertEqual(day["majorDipOpenCount"], 1)
        self.assertEqual(day["majorDipMaxDepth"], 1.0)
        self.assertEqual(day["majorDipAvgDepth"], 0.99)
        self.assertEqual(len(day["majorDips"]), 2)


class CybClassificationTests(unittest.TestCase):
    def test_classifies_five_trend_structures(self):
        higher_highs = [1, 2, 5, 2, 1, 3, 6, 3, 2]
        lower_highs = [1, 2, 6, 2, 1, 3, 5, 3, 2]
        higher_lows = [-1, -2, -5, -2, -1, -3, -4, -3, -2]
        lower_lows = [-1, -2, -4, -2, -1, -3, -5, -3, -2]

        self.assertEqual(trend.classify_trend_structure(k15_from_ranges(higher_highs, higher_lows)), "上升结构")
        self.assertEqual(trend.classify_trend_structure(k15_from_ranges(lower_highs, lower_lows)), "下降结构")
        self.assertEqual(trend.classify_trend_structure(k15_from_ranges(lower_highs, higher_lows)), "上攻乏力")
        self.assertEqual(trend.classify_trend_structure(k15_from_ranges(higher_highs, lower_lows)), "支撑转弱")
        self.assertEqual(trend.classify_trend_structure(k15_from_ranges([1, 2, 3], [-1, -2, -3])), "震荡结构")

    def test_risk_boundaries(self):
        base = {
            "dataQuality": "complete",
            "effectiveCount": 0,
            "maxDepth": 1.49,
            "avgRecoveryRate": 50,
            "closePosition": 35,
        }

        self.assertEqual(trend.classify_risk(base), "低")
        self.assertEqual(trend.classify_risk(base | {"maxDepth": 1.5}), "升温")
        self.assertEqual(
            trend.classify_risk(base | {"effectiveCount": 2, "maxDepth": 1.5, "closePosition": 34.9}),
            "高",
        )

    def test_missing_recovery_does_not_count_as_failure(self):
        metrics = {
            "dataQuality": "complete",
            "effectiveCount": 0,
            "maxDepth": 0,
            "avgRecoveryRate": None,
            "closePosition": 80,
        }
        self.assertEqual(trend.classify_risk(metrics), "低")

    def test_incomplete_day_has_no_classification(self):
        metrics = {"dataQuality": "incomplete"}
        self.assertIsNone(trend.classify_market_state(metrics))
        self.assertIsNone(trend.classify_risk(metrics))

    def test_classifies_all_market_states(self):
        base = {
            "dataQuality": "complete",
            "effectiveCount": 0,
            "maxDepth": 0.5,
            "avgRecoveryRate": 70,
            "closePosition": 70,
        }
        cases = [
            (base | {"trendStructure": "下降结构", "closePosition": 20}, "弱势下行"),
            (base | {"trendStructure": "支撑转弱", "closePosition": 20}, "转弱预警"),
            (base | {"trendStructure": "下降结构"}, "弱势修复"),
            (base | {"trendStructure": "上升结构", "effectiveCount": 2}, "高位分歧"),
            (base | {"trendStructure": "上升结构"}, "强势上行"),
            (base | {"trendStructure": "震荡结构"}, "震荡蓄势"),
        ]
        for metrics, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(trend.classify_market_state(metrics), expected)

    def test_compares_risk_and_limits_reasons(self):
        self.assertEqual(trend.compare_risk("低", "升温"), "升温")
        self.assertEqual(trend.compare_risk("高", "升温"), "缓解")
        self.assertEqual(trend.compare_risk("升温", "升温"), "持平")
        reasons = trend.build_reasons({
            "effectiveCount": 3,
            "maxDepth": 2.1,
            "avgRecoveryRate": 20,
            "closePosition": 10,
            "trendStructure": "下降结构",
        })
        self.assertLessEqual(len(reasons), 3)


class CybAggregationTests(unittest.TestCase):
    def test_complete_day_emits_strength_metrics(self):
        prices = [100 + math.sin(index / 9) * 1.2 + index * 0.002 for index in range(240)]
        records = [
            row(bar["date"], bar["time"], bar["price"])
            for bar in bars_from_prices(prices)
        ]

        day = trend.build_day_stats(records)[0]

        self.assertEqual(day["dataQuality"], "complete")
        for key in (
            "avgRecoveryRate", "medianRecovery50Minutes", "closePosition", "dayChange",
            "trendStructure", "marketState", "riskLevel", "riskChange", "reasons",
        ):
            self.assertIn(key, day)
        self.assertLessEqual(len(day["reasons"]), 3)

    def test_incomplete_day_has_no_inferred_labels(self):
        records = [row(bar["date"], bar["time"], bar["price"]) for bar in bars_from_prices([100, 99, 100])]

        day = trend.build_day_stats(records)[0]

        self.assertEqual(day["dataQuality"], "incomplete")
        self.assertIsNone(day["marketState"])
        self.assertIsNone(day["riskLevel"])

    def test_flat_day_has_neutral_close_position_and_no_recovery_average(self):
        records = [row(bar["date"], bar["time"], 100) for bar in bars_from_prices([100] * 240)]

        day = trend.build_day_stats(records)[0]

        self.assertEqual(day["closePosition"], 50.0)
        self.assertIsNone(day["avgRecoveryRate"])

    def test_summary_keeps_v1_history_without_zero_filling(self):
        old_day = {"date": "2026-08-08", "count": 1, "maxDepth": 1.1, "dips": []}
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "20260808.json"
            path.write_text(__import__("json").dumps(old_day), encoding="utf-8")
            loaded = trend.load_history(temp_dir)
            summary = trend.make_summary(list(loaded.values()))

        self.assertEqual(summary["schemaVersion"], 2)
        self.assertNotIn("avgRecoveryRate", summary["days"][0])

    def test_validator_accepts_legacy_and_rejects_invalid_v2_percent(self):
        self.assertEqual(validator.validate_cyb_strength({"days": [{"date": "2026-08-08"}]})["version"], 1)
        mixed = {
            "schemaVersion": 2,
            "days": [{"date": "2026-08-10", "count": 1, "dips": [{"depth": 1.2}]}],
        }
        self.assertEqual(validator.validate_cyb_strength(mixed)["version"], 2)
        invalid = {
            "schemaVersion": 2,
            "days": [{
                "date": "2026-08-11", "dataQuality": "complete",
                "avgRecoveryRate": 101, "reasons": [],
            }],
        }
        with self.assertRaises(ValueError):
            validator.validate_cyb_strength(invalid)


if __name__ == "__main__":
    unittest.main()
