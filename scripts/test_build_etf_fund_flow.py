import json
import math
import tempfile
import unittest
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import requests
from openpyxl import Workbook

from scripts import build_etf_fund_flow as etf_builder
from scripts.build_etf_fund_flow import (
    _call_with_retries,
    build_row,
    build_snapshot,
    classify_flow,
    compute_net_subscription,
    fetch_market_history,
    fetch_nav,
    fetch_sse_shares,
    fetch_szse_latest_shares,
    main,
    write_json_atomic,
)


class ConfirmedFlowMathTest(unittest.TestCase):
    def test_confirmed_subscription_uses_share_delta_times_nav(self):
        self.assertEqual(compute_net_subscription(1_200_000, 1_000_000, 1.25), 250_000)

    def test_any_missing_input_returns_none(self):
        self.assertIsNone(compute_net_subscription(None, 1_000_000, 1.25))
        self.assertIsNone(compute_net_subscription(1_200_000, None, 1.25))
        self.assertIsNone(compute_net_subscription(1_200_000, 1_000_000, None))

    def test_four_flow_labels_and_pending(self):
        self.assertEqual(classify_flow(1.2, 10), "资金强化")
        self.assertEqual(classify_flow(-1.2, 10), "逆势承接")
        self.assertEqual(classify_flow(1.2, -10), "上涨兑现")
        self.assertEqual(classify_flow(-1.2, -10), "资金撤退")
        self.assertEqual(classify_flow(1.2, None), "待确认")

    def test_zero_net_subscription_is_neutral(self):
        self.assertEqual(classify_flow(1.2, 0), "无净申赎")
        self.assertEqual(classify_flow(-1.2, 0), "无净申赎")

    def test_non_finite_input_is_never_emitted_as_a_number(self):
        self.assertIsNone(compute_net_subscription(math.nan, 1_000_000, 1.25))


class SourceAdapterTest(unittest.TestCase):
    def test_dated_szse_adapter_normalizes_each_requested_baseline_date(self):
        class FakeAkshare:
            def __init__(self):
                self.calls = []

            def fund_scale_daily_szse(self, start_date, end_date, symbol):
                self.calls.append((start_date, end_date, symbol))
                return [
                    {
                        "日期": datetime.strptime(start_date, "%Y%m%d").date(),
                        "基金代码": "159915",
                        "基金份额": "2,000,000",
                    }
                ]

        fake = FakeAkshare()
        with patch("scripts.build_etf_fund_flow._load_akshare", return_value=fake):
            baseline = etf_builder.fetch_szse_shares("20260730")
            next_day = etf_builder.fetch_szse_shares("20260731")

        self.assertEqual(
            fake.calls,
            [("20260730", "20260730", "ETF"), ("20260731", "20260731", "ETF")],
        )
        self.assertEqual(
            baseline,
            {"159915": {"shares": 2_000_000.0, "sharesDate": "2026-07-30"}},
        )
        self.assertEqual(
            next_day,
            {"159915": {"shares": 2_000_000.0, "sharesDate": "2026-07-31"}},
        )

    def test_exchange_share_adapters_retry_and_normalize_authoritative_rows(self):
        class FakeAkshare:
            def __init__(self):
                self.sse_calls = 0

            def fund_etf_scale_sse(self, date):
                self.sse_calls += 1
                if self.sse_calls == 1:
                    raise TimeoutError("temporary")
                return [
                    {"基金代码": "510300", "基金份额": 1_200_000, "统计日期": "2026-07-31"},
                    {"基金代码": "bad", "基金份额": math.nan, "统计日期": "2026-07-31"},
                ]

            def fund_etf_scale_szse(self):
                return [
                    {"基金代码": "159915", "基金份额": "2,000,000"},
                    {
                        "基金代码": "159916",
                        "基金份额": "3,000,000",
                        "统计日期": "2026-07-31",
                    },
                ]

        fake = FakeAkshare()
        with (
            patch("scripts.build_etf_fund_flow._load_akshare", return_value=fake),
            patch("scripts.build_etf_fund_flow._sleep"),
        ):
            sse = fetch_sse_shares("20260731")
            szse = fetch_szse_latest_shares()

        self.assertEqual(fake.sse_calls, 2)
        self.assertEqual(sse, {"510300": {"shares": 1_200_000.0, "sharesDate": "2026-07-31"}})
        self.assertEqual(
            szse,
            {
                "159915": {"shares": 2_000_000.0, "sharesDate": None},
                "159916": {"shares": 3_000_000.0, "sharesDate": "2026-07-31"},
            },
        )

    def test_retry_boundary_injects_explicit_request_timeout(self):
        observed = []

        def fake_request(session, method, url, **kwargs):
            observed.append(kwargs.get("timeout"))
            return object()

        with patch("requests.sessions.Session.request", new=fake_request):
            _call_with_retries(
                lambda: requests.get("https://example.invalid"),
                attempts=1,
                timeout_seconds=7,
            )

        self.assertEqual(observed, [7])

    def test_nav_and_market_adapters_expose_normalized_date_keyed_values(self):
        class FakeAkshare:
            def fund_etf_fund_info_em(self, fund, start_date, end_date):
                return [{"净值日期": "2026-07-31", "单位净值": 1.25}]

            def fund_etf_hist_em(self, symbol, period, start_date, end_date, adjust):
                return [
                    {"日期": "2026-07-31", "收盘": 1.3, "涨跌幅": 1.2, "成交额": 500_000},
                ]

        with patch("scripts.build_etf_fund_flow._load_akshare", return_value=FakeAkshare()):
            nav = fetch_nav("510300", "20260701", "20260731")
            market = fetch_market_history("510300", "20260701", "20260731")

        self.assertEqual(nav, {"2026-07-31": {"nav": 1.25, "navDate": "2026-07-31"}})
        self.assertEqual(
            market,
            {
                "2026-07-31": {
                    "close": 1.3,
                    "changePercent": 1.2,
                    "turnover": 500_000.0,
                }
            },
        )

    def test_nav_adapter_parses_live_json_when_akshare_schema_breaks(self):
        class BrokenAkshare:
            def fund_etf_fund_info_em(self, fund, start_date, end_date):
                raise ValueError("Length mismatch: Expected axis has 14 elements, new values have 13 elements")

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "TotalCount": 1,
                    "Data": {
                        "LSJZList": [
                            {
                                "FSRQ": "2026-07-31",
                                "DWJZ": "4.6473",
                                "LJJZ": "2.0503",
                                "SDATE": None,
                                "ACTUALSYI": "",
                                "NAVTYPE": "1",
                                "JZZZL": "0.88",
                                "SGZT": "open",
                                "SHZT": "open",
                                "FHFCZ": "",
                                "FHFCZ10": "",
                                "FHFCBZ": "",
                                "DTYPE": None,
                                "FHSP": "",
                            }
                        ]
                    },
                }

        with (
            patch("scripts.build_etf_fund_flow._load_akshare", return_value=BrokenAkshare()),
            patch("requests.get", return_value=FakeResponse()),
            patch("scripts.build_etf_fund_flow._sleep"),
        ):
            nav = fetch_nav("510300", "20260701", "20260731")

        self.assertEqual(nav, {"2026-07-31": {"nav": 4.6473, "navDate": "2026-07-31"}})

    def test_market_adapter_falls_back_to_sina_when_eastmoney_is_unreachable(self):
        class FallbackAkshare:
            def fund_etf_hist_em(self, symbol, period, start_date, end_date, adjust):
                raise requests.exceptions.ProxyError("eastmoney unavailable")

            def fund_etf_hist_sina(self, symbol):
                self.symbol = symbol
                return [
                    {"date": "2026-07-30", "close": 4.605, "amount": 6_953_209_405},
                    {"date": "2026-07-31", "close": 4.653, "amount": 7_016_550_822},
                ]

            def tool_trade_date_hist_sina(self):
                return [
                    {"trade_date": "2026-07-30"},
                    {"trade_date": "2026-07-31"},
                ]

        fake = FallbackAkshare()
        with (
            patch("scripts.build_etf_fund_flow._load_akshare", return_value=fake),
            patch("scripts.build_etf_fund_flow._sleep"),
        ):
            market = fetch_market_history("510300", "20260701", "20260731")

        self.assertEqual(fake.symbol, "sh510300")
        self.assertAlmostEqual(market["2026-07-31"]["changePercent"], 1.0423, places=4)
        self.assertEqual(market["2026-07-31"]["turnover"], 7_016_550_822.0)

    def test_sina_fallback_never_compresses_a_missing_exchange_session(self):
        class GappedAkshare:
            def fund_etf_hist_em(self, symbol, period, start_date, end_date, adjust):
                raise requests.exceptions.ProxyError("eastmoney unavailable")

            def fund_etf_hist_sina(self, symbol):
                return [
                    {"date": "2026-07-29", "close": 4.60, "amount": 600_000},
                    {"date": "2026-07-31", "close": 4.80, "amount": 800_000},
                ]

            def tool_trade_date_hist_sina(self):
                return [
                    {"trade_date": "2026-07-29"},
                    {"trade_date": "2026-07-30"},
                    {"trade_date": "2026-07-31"},
                ]

        with patch(
            "scripts.build_etf_fund_flow._load_akshare", return_value=GappedAkshare()
        ):
            market = fetch_market_history("510300", "20260701", "20260731")

        self.assertIsNone(market["2026-07-31"]["changePercent"])

    def test_szse_adapter_parses_official_xlsx_when_akshare_requires_filelike(self):
        class BrokenAkshare:
            def fund_etf_scale_szse(self):
                raise TypeError("Expected file path name or file-like object, got <class 'bytes'> type")

        workbook = Workbook()
        sheet = workbook.active
        sheet.append([
            "\u57fa\u91d1\u4ee3\u7801",
            "\u57fa\u91d1\u7b80\u79f0",
            "\u5f53\u524d\u89c4\u6a21(\u4efd)",
            "\u51c0\u503c",
        ])
        sheet.append(["159915", "\u521b\u4e1a\u677fETF", "2,000,000", 1.25])
        content = BytesIO()
        workbook.save(content)

        class FakeResponse:
            def raise_for_status(self):
                return None

        FakeResponse.content = content.getvalue()

        with (
            patch("scripts.build_etf_fund_flow._load_akshare", return_value=BrokenAkshare()),
            patch("requests.get", return_value=FakeResponse()),
            patch("scripts.build_etf_fund_flow._sleep"),
        ):
            shares = fetch_szse_latest_shares()

        self.assertEqual(shares, {"159915": {"shares": 2_000_000.0, "sharesDate": None}})


class ConfirmedRowTest(unittest.TestCase):
    def setUp(self):
        self.config = {
            "code": "510300",
            "name": "沪深300ETF",
            "scope": "broad",
            "category": "大盘核心",
            "direction": "沪深300",
            "exchange": "SSE",
        }
        self.dates = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30"]
        self.history = [
            {
                "code": "510300",
                "date": date,
                "status": "confirmed",
                "netSubscription1d": value,
                "changePercent": 1.0,
                "turnover": 100.0,
            }
            for date, value in zip(self.dates, (10.0, 20.0, 30.0, 40.0))
        ]

    def test_strict_dates_build_confirmed_row_and_complete_windows(self):
        current = {
            "date": "2026-07-31",
            "previousDate": "2026-07-30",
            "shares": 1_200_000.0,
            "sharesDate": "2026-07-31",
            "nav": 1.25,
            "navDate": "2026-07-31",
            "close": 1.3,
            "changePercent": 1.0,
            "turnover": 150.0,
            "marketDate": "2026-07-31",
        }
        previous = {"shares": 1_000_000.0, "sharesDate": "2026-07-30"}
        benchmarks = {date: 0.5 for date in self.dates + ["2026-07-31"]}

        row = build_row(self.config, current, previous, self.history, benchmarks)

        self.assertEqual(row["status"], "confirmed")
        self.assertEqual(row["shareChange"], 200_000.0)
        self.assertEqual(row["netSubscription1d"], 250_000.0)
        self.assertEqual(row["netSubscription5d"], 250_100.0)
        self.assertEqual(row["windowDays5d"], 5)
        self.assertEqual(row["windowDays20d"], 5)
        self.assertEqual(row["positiveFlowDays5d"], 5)
        self.assertEqual(row["persistenceLabel"], "持续流入")
        self.assertEqual(row["excessReturn1d"], 0.5)
        self.assertGreater(row["excessReturn5d"], 0)
        self.assertEqual(row["turnoverVs5d"], 1.3636)

    def test_fund_flow_confirms_without_complete_market_observation(self):
        current = {
            "date": "2026-07-31",
            "previousDate": "2026-07-30",
            "shares": 1_200_000.0,
            "sharesDate": "2026-07-31",
            "nav": 1.25,
            "navDate": "2026-07-31",
            "close": None,
            "changePercent": None,
            "turnover": None,
            "marketDate": None,
        }

        row = build_row(
            self.config,
            current,
            {"shares": 1_000_000.0, "sharesDate": "2026-07-30"},
            self.history,
            {date: 0.5 for date in self.dates + ["2026-07-31"]},
        )

        self.assertEqual(row["status"], "confirmed")
        self.assertEqual(row["shareChange"], 200_000.0)
        self.assertEqual(row["netSubscription1d"], 250_000.0)
        self.assertEqual(row["scale"], 1_500_000.0)
        self.assertEqual(row["flowLabel"], "待确认")
        self.assertIsNone(row["excessReturn1d"])
        self.assertIsNone(row["excessReturn5d"])
        self.assertIsNone(row["turnoverVs5d"])

    def test_misaligned_nav_date_preserves_null_confirmed_values(self):
        current = {
            "date": "2026-07-31",
            "previousDate": "2026-07-30",
            "shares": 1_200_000.0,
            "sharesDate": "2026-07-31",
            "nav": 1.25,
            "navDate": "2026-07-30",
            "close": 1.3,
            "changePercent": 1.0,
            "turnover": 150.0,
            "marketDate": "2026-07-31",
        }

        row = build_row(
            self.config,
            current,
            {"shares": 1_000_000.0, "sharesDate": "2026-07-30"},
            self.history,
            {},
        )

        self.assertEqual(row["status"], "pending")
        self.assertIsNone(row["shareChange"])
        self.assertIsNone(row["scale"])
        self.assertIsNone(row["netSubscription1d"])
        self.assertIsNone(row["netSubscription5d"])
        self.assertEqual(row["flowLabel"], "待确认")

    def test_missing_day_inside_available_window_nulls_the_sum(self):
        current = {
            "date": "2026-07-31",
            "previousDate": "2026-07-30",
            "shares": 1_200_000.0,
            "sharesDate": "2026-07-31",
            "nav": 1.25,
            "navDate": "2026-07-31",
            "close": 1.3,
            "changePercent": 1.0,
            "turnover": 150.0,
            "marketDate": "2026-07-31",
        }
        history = [dict(row) for row in self.history]
        history[2]["netSubscription1d"] = None
        history[2]["status"] = "pending"

        row = build_row(
            self.config,
            current,
            {"shares": 1_000_000.0, "sharesDate": "2026-07-30"},
            history,
            {},
        )

        self.assertEqual(row["windowDays5d"], 5)
        self.assertIsNone(row["netSubscription5d"])
        self.assertIsNone(row["positiveFlowDays5d"])
        self.assertIsNone(row["persistenceLabel"])

    def test_omitted_archived_session_cannot_be_replaced_by_an_older_row(self):
        current = {
            "date": "2026-07-31",
            "previousDate": "2026-07-30",
            "shares": 1_200_000.0,
            "sharesDate": "2026-07-31",
            "nav": 1.25,
            "navDate": "2026-07-31",
            "close": 1.3,
            "changePercent": 1.0,
            "turnover": 150.0,
            "marketDate": "2026-07-31",
        }
        history = [
            {
                "code": "510300",
                "date": date,
                "status": "confirmed",
                "netSubscription1d": 10.0,
                "changePercent": 1.0,
                "turnover": 100.0,
            }
            for date in ("2026-07-24", "2026-07-27", "2026-07-28", "2026-07-30")
        ]
        benchmark = {
            date: 0.5
            for date in (
                "2026-07-24",
                "2026-07-27",
                "2026-07-28",
                "2026-07-29",
                "2026-07-30",
                "2026-07-31",
            )
        }

        row = build_row(
            self.config,
            current,
            {"shares": 1_000_000.0, "sharesDate": "2026-07-30"},
            history,
            benchmark,
        )

        self.assertEqual(row["windowDays5d"], 5)
        self.assertIsNone(row["netSubscription5d"])
        self.assertIsNone(row["positiveFlowDays5d"])
        self.assertIsNone(row["turnoverVs5d"])
        self.assertIsNone(row["excessReturn5d"])

    def test_sixth_session_with_only_four_records_nulls_five_day_sum(self):
        dates = [
            (datetime(2026, 1, 1) + timedelta(days=offset)).date().isoformat()
            for offset in range(6)
        ]
        history = [
            {
                "code": "510300",
                "date": date,
                "status": "confirmed",
                "netSubscription1d": 10.0,
                "changePercent": 1.0,
                "turnover": 100.0,
            }
            for date in dates[-4:-1]
        ]
        current = {
            "date": dates[-1],
            "previousDate": dates[-2],
            "shares": 1_200_000.0,
            "sharesDate": dates[-1],
            "nav": 1.25,
            "navDate": dates[-1],
            "close": 1.3,
            "changePercent": 1.0,
            "turnover": 100.0,
            "marketDate": dates[-1],
        }

        row = build_row(
            self.config,
            current,
            {"shares": 1_000_000.0, "sharesDate": dates[-2]},
            history,
            {date: 0.5 for date in dates},
        )

        self.assertEqual(row["windowDays5d"], 4)
        self.assertIsNone(row["netSubscription5d"])
        self.assertIsNone(row["positiveFlowDays5d"])

    def test_twenty_first_session_with_only_nineteen_records_nulls_twenty_day_sum(self):
        dates = [
            (datetime(2026, 1, 1) + timedelta(days=offset)).date().isoformat()
            for offset in range(21)
        ]
        history = [
            {
                "code": "510300",
                "date": date,
                "status": "confirmed",
                "netSubscription1d": 10.0,
                "changePercent": 1.0,
                "turnover": 100.0,
            }
            for date in dates[-19:-1]
        ]
        current = {
            "date": dates[-1],
            "previousDate": dates[-2],
            "shares": 1_200_000.0,
            "sharesDate": dates[-1],
            "nav": 1.25,
            "navDate": dates[-1],
            "close": 1.3,
            "changePercent": 1.0,
            "turnover": 100.0,
            "marketDate": dates[-1],
        }

        row = build_row(
            self.config,
            current,
            {"shares": 1_000_000.0, "sharesDate": dates[-2]},
            history,
            {date: 0.5 for date in dates},
        )

        self.assertEqual(row["windowDays20d"], 19)
        self.assertIsNone(row["netSubscription20d"])


class SnapshotBuilderTest(unittest.TestCase):
    def setUp(self):
        self.dates = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"]
        self.config = {
            "version": 1,
            "benchmarkCode": "510300",
            "boardMappings": {"159999": ["demo"]},
            "etfs": [
                {
                    "code": "510300",
                    "name": "沪深300ETF",
                    "scope": "broad",
                    "category": "大盘核心",
                    "direction": "沪深300",
                    "exchange": "SSE",
                },
                {
                    "code": "159999",
                    "name": "行业ETF",
                    "scope": "industry",
                    "category": "测试",
                    "direction": "测试行业",
                    "exchange": "SZSE",
                },
            ],
        }
        self.history = []
        for index, date in enumerate(self.dates[:-1]):
            self.history.append(
                {
                    "date": date,
                    "etfs": [
                        {
                            "code": "510300",
                            "date": date,
                            "status": "confirmed",
                            "shares": 1_000_000.0,
                            "netSubscription1d": 10.0 + index,
                            "changePercent": 1.0,
                            "turnover": 100.0,
                        }
                    ],
                }
            )

    def _providers(self):
        market = {
            date: {"close": 1.0 + index / 100, "changePercent": 1.0, "turnover": 100.0}
            for index, date in enumerate(self.dates)
        }

        def sse_shares(date):
            normalized = date.replace("-", "")
            shares = 1_200_000.0 if normalized == "20260731" else 1_000_000.0
            return {"510300": {"shares": shares, "sharesDate": date}}

        return {
            "fetch_sse_shares": sse_shares,
            "fetch_szse_shares": lambda date: {
                "159999": {"shares": 2_000_000.0, "sharesDate": "2026-07-31"}
            },
            "fetch_nav": lambda code, start, end: {
                "2026-07-31": {"nav": 1.25, "navDate": "2026-07-31"}
            },
            "fetch_market_history": lambda code, start, end: dict(market),
        }

    def test_fakes_build_confirmed_sse_and_pending_szse_baseline_offline(self):
        custom_boards = {
            "date": "2026-07-31",
            "boards": [
                {
                    "code": "demo",
                    "stocks": [
                        {"code": "1", "latestDate": "2026-07-31", "latestChangePercent": 2.0},
                        {"code": "2", "latestDate": "2026-07-31", "latestChangePercent": -1.0},
                    ],
                }
            ],
        }

        snapshot = build_snapshot(
            "20260731",
            self.config,
            history=self.history,
            custom_boards=custom_boards,
            providers=self._providers(),
        )

        self.assertEqual(snapshot["historySessionCount"], 5)
        self.assertEqual(snapshot["etfs"][0]["historySessionCount"], 5)
        self.assertIsNone(snapshot["etfs"][1]["netSubscription1d"])
        self.assertEqual(snapshot["etfs"][1]["flowLabel"], "待确认")
        self.assertEqual(snapshot["summary"]["broad"]["confirmedCount"], 1)
        self.assertEqual(snapshot["summary"]["industry"]["confirmedCount"], 0)
        self.assertNotIn("netSubscription1d", snapshot["summary"]["all"])
        self.assertEqual(snapshot["summary"]["broad"]["netSubscription1d"], 250_000.0)
        self.assertFalse(math.isnan(snapshot["etfs"][0]["netSubscription1d"]))
        self.assertEqual(snapshot["etfs"][1]["shares"], 2_000_000.0)
        self.assertIsNone(snapshot["etfs"][1]["previousShares"])
        self.assertEqual(snapshot["etfs"][1]["stockBreadth"], 0.5)
        self.assertTrue(snapshot["etfs"][1]["breadthConfirmed"])
        self.assertFalse(snapshot["etfs"][1]["mainlineCandidate"])

    def test_szse_confirms_after_a_dated_archived_baseline_when_provider_is_authoritative(self):
        history = json.loads(json.dumps(self.history))
        history[-1]["etfs"].append(
            {
                "code": "159999",
                "date": "2026-07-30",
                "status": "pending",
                "shares": 1_900_000.0,
                "netSubscription1d": None,
                "changePercent": 0.5,
                "turnover": 80.0,
            }
        )

        snapshot = build_snapshot(
            "20260731",
            self.config,
            history=history,
            custom_boards=None,
            providers=self._providers(),
        )

        industry = snapshot["etfs"][1]
        self.assertEqual(industry["status"], "confirmed")
        self.assertEqual(industry["previousShares"], 1_900_000.0)
        self.assertEqual(industry["netSubscription1d"], 125_000.0)
        self.assertEqual([error for error in snapshot["errors"] if error["code"] == "159999"], [])

    def test_stale_custom_board_date_never_confirms_breadth(self):
        snapshot = build_snapshot(
            "20260731",
            self.config,
            history=self.history,
            custom_boards={"date": "2026-07-30", "boards": [{"code": "demo", "stocks": []}]},
            providers=self._providers(),
        )

        industry = snapshot["etfs"][1]
        self.assertIsNone(industry["stockBreadth"])
        self.assertFalse(industry["breadthConfirmed"])
        self.assertFalse(industry["mainlineCandidate"])

    def test_mainline_candidate_requires_and_accepts_all_confirmed_evidence(self):
        config = json.loads(json.dumps(self.config))
        config["etfs"][1]["exchange"] = "SSE"
        history = []
        for date in self.dates[:-1]:
            history.append(
                {
                    "date": date,
                    "etfs": [
                        {
                            "code": "510300",
                            "date": date,
                            "status": "confirmed",
                            "shares": 1_000_000.0,
                            "netSubscription1d": 1.0,
                            "changePercent": 0.0,
                            "turnover": 100.0,
                        },
                        {
                            "code": "159999",
                            "date": date,
                            "status": "confirmed",
                            "shares": 1_000_000.0,
                            "netSubscription1d": 10.0,
                            "changePercent": 1.0,
                            "turnover": 100.0,
                        },
                    ],
                }
            )

        def market(code, start, end):
            return {
                date: {
                    "close": 1.0,
                    "changePercent": 0.0 if code == "510300" else (2.0 if date == "2026-07-31" else 1.0),
                    "turnover": 200.0 if code == "159999" and date == "2026-07-31" else 100.0,
                }
                for date in self.dates
            }

        def shares(date):
            current = date.replace("-", "") == "20260731"
            return {
                "510300": {"shares": 1_100_000.0 if current else 1_000_000.0, "sharesDate": date},
                "159999": {"shares": 1_200_000.0 if current else 1_000_000.0, "sharesDate": date},
            }

        snapshot = build_snapshot(
            "20260731",
            config,
            history=history,
            custom_boards={
                "date": "2026-07-31",
                "boards": [
                    {
                        "code": "demo",
                        "stocks": [
                            {"latestDate": "2026-07-31", "latestChangePercent": 1.0},
                            {"latestDate": "2026-07-31", "latestChangePercent": -1.0},
                        ],
                    }
                ],
            },
            providers={
                "fetch_sse_shares": shares,
                "fetch_szse_shares": lambda date: {},
                "fetch_nav": lambda code, start, end: {
                    "2026-07-31": {"nav": 1.0, "navDate": "2026-07-31"}
                },
                "fetch_market_history": market,
            },
        )

        industry = snapshot["etfs"][1]
        self.assertEqual(industry["positiveFlowDays5d"], 5)
        self.assertGreater(industry["excessReturn5d"], 0)
        self.assertGreaterEqual(industry["turnoverVs5d"], 1)
        self.assertTrue(industry["mainlineCandidate"])

    def test_one_code_failure_is_recorded_without_aborting_confirmed_peer(self):
        providers = self._providers()
        original_nav = providers["fetch_nav"]

        def selective_nav(code, start, end):
            if code == "159999":
                raise TimeoutError("nav unavailable")
            return original_nav(code, start, end)

        providers["fetch_nav"] = selective_nav
        snapshot = build_snapshot(
            "20260731",
            self.config,
            history=self.history,
            custom_boards=None,
            providers=providers,
        )

        self.assertEqual(snapshot["etfs"][0]["status"], "confirmed")
        self.assertEqual(snapshot["etfs"][1]["status"], "pending")
        self.assertEqual(snapshot["errors"][0]["code"], "159999")
        self.assertEqual(snapshot["errors"][0]["source"], "nav")

    def test_dated_incomplete_market_row_keeps_flow_confirmed_and_records_market_error(self):
        for missing_field in ("close", "changePercent", "turnover"):
            with self.subTest(missing_field=missing_field):
                providers = self._providers()
                original_market = providers["fetch_market_history"]

                def incomplete_market(code, start, end):
                    market = original_market(code, start, end)
                    if code == "510300":
                        market["2026-07-31"][missing_field] = None
                    return market

                providers["fetch_market_history"] = incomplete_market
                snapshot = build_snapshot(
                    "20260731",
                    self.config,
                    history=self.history,
                    custom_boards=None,
                    providers=providers,
                )

                broad = snapshot["etfs"][0]
                self.assertEqual(broad["status"], "confirmed")
                self.assertEqual(broad["shareChange"], 200_000.0)
                self.assertEqual(broad["netSubscription1d"], 250_000.0)
                self.assertFalse(broad["mainlineCandidate"])
                self.assertTrue(
                    any(
                        error["code"] == "510300" and error["source"] == "missing"
                        for error in snapshot["errors"]
                    )
                )

    def test_independent_calendar_prevents_compressed_share_delta_across_market_gap(self):
        providers = self._providers()
        original_market = providers["fetch_market_history"]

        def gapped_market(code, start, end):
            market = original_market(code, start, end)
            market.pop("2026-07-30")
            market["2026-07-31"]["changePercent"] = None
            return market

        def shares(date):
            if date == "20260731":
                return {"510300": {"shares": 1_200_000.0, "sharesDate": "2026-07-31"}}
            if date == "20260729":
                return {"510300": {"shares": 1_000_000.0, "sharesDate": "2026-07-29"}}
            return {}

        providers["fetch_market_history"] = gapped_market
        providers["fetch_sse_shares"] = shares
        providers["fetch_trading_sessions"] = lambda start, end: list(self.dates)

        snapshot = build_snapshot(
            "20260731",
            {**self.config, "etfs": [self.config["etfs"][0]]},
            history=[item for item in self.history if item["date"] != "2026-07-30"],
            custom_boards=None,
            providers=providers,
        )

        row = snapshot["etfs"][0]
        self.assertEqual(row["status"], "pending")
        self.assertIsNone(row["previousShares"])
        self.assertIsNone(row["netSubscription1d"])
        self.assertTrue(
            any("previous shares missing for 2026-07-30" in error["message"] for error in snapshot["errors"])
        )

    def test_empty_provider_results_are_recorded_as_missing_source_errors(self):
        empty = {
            "fetch_sse_shares": lambda date: {},
            "fetch_szse_shares": lambda date: {},
            "fetch_nav": lambda code, start, end: {},
            "fetch_market_history": lambda code, start, end: {},
        }

        snapshot = build_snapshot(
            "20260731",
            self.config,
            history=self.history,
            custom_boards=None,
            providers=empty,
        )

        self.assertEqual(snapshot["summary"]["all"]["confirmedCount"], 0)
        self.assertTrue(snapshot["errors"])
        self.assertIn("missing", {error["source"] for error in snapshot["errors"]})

    def test_stale_nav_date_is_recorded_and_cannot_silently_replace_latest(self):
        providers = self._providers()
        providers["fetch_nav"] = lambda code, start, end: {
            "2026-07-31": {"nav": 1.25, "navDate": "2026-07-30"}
        }

        snapshot = build_snapshot(
            "20260731",
            self.config,
            history=self.history,
            custom_boards=None,
            providers=providers,
        )

        self.assertEqual(snapshot["summary"]["all"]["confirmedCount"], 0)
        self.assertEqual(
            {error["code"] for error in snapshot["errors"] if error["source"] == "missing"},
            {"510300", "159999"},
        )


class AtomicOutputTest(unittest.TestCase):
    def test_successful_write_replaces_destination_without_leaving_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "latest.json"
            destination.write_text('{"old": true}', encoding="utf-8")

            write_json_atomic({"new": True}, destination)

            self.assertEqual(json.loads(destination.read_text(encoding="utf-8")), {"new": True})
            self.assertEqual(list(destination.parent.glob(f".{destination.name}.*.tmp")), [])

    def test_nan_serialization_failure_preserves_previous_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "latest.json"
            destination.write_text('{"old": true}', encoding="utf-8")

            with self.assertRaises(ValueError):
                write_json_atomic({"bad": math.nan}, destination)

            self.assertEqual(json.loads(destination.read_text(encoding="utf-8")), {"old": True})
            self.assertEqual(list(destination.parent.glob(f".{destination.name}.*.tmp")), [])

    def test_failed_cli_refresh_preserves_previous_latest_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            output = root / "latest.json"
            history = root / "history"
            config.write_text('{"version": 1, "etfs": []}', encoding="utf-8")
            output.write_text('{"old": true}', encoding="utf-8")
            failed_snapshot = {
                "errors": [{"source": "missing"}],
                "summary": {"all": {"confirmedCount": 0}},
            }

            with (
                patch("scripts.build_etf_fund_flow.build_snapshot", return_value=failed_snapshot),
                self.assertRaises(RuntimeError),
            ):
                main(
                    [
                        "--date",
                        "20260731",
                        "--config",
                        str(config),
                        "--out",
                        str(output),
                        "--history-dir",
                        str(history),
                    ]
                )

            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), {"old": True})
            self.assertFalse(history.exists())


if __name__ == "__main__":
    unittest.main()
