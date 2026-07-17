from __future__ import annotations

import unittest
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

from build_custom_board_data import build_board, build_eastmoney_fund_flow_map, enrich_fast_intraday_stock_row, summarize_fast_intraday_board_row, sync_fast_intraday_board_latest
from eastmoney_fund_flow_history import SOURCE_NAME
from validate_web_data import validate_fund_flow_row


def price_rows(codes: list[str], dates: list[str]):
    return {
        code: [{"date": date, "changePercent": 1, "close": 10, "high": 10, "low": 10} for date in dates]
        for code in codes
    }


class EastmoneyFundFlowIntegrationTest(unittest.TestCase):
    def test_parallel_fund_flow_map_is_bounded_complete_and_isolates_errors(self) -> None:
        codes = {f"{index:06d}" for index in range(20)}
        lock = threading.Lock()
        active = 0
        peak = 0

        def fake(code, *_args, **_kwargs):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.02)
            with lock:
                active -= 1
            if code == "000019":
                raise RuntimeError("one bad stock")
            return [{"date": "2026-07-15", "code": code, "mainNetInflow": 1, "source": SOURCE_NAME}]

        with tempfile.TemporaryDirectory() as directory, patch("build_custom_board_data.load_or_fetch_eastmoney_fund_flow", side_effect=fake):
            rows, errors = build_eastmoney_fund_flow_map(codes, "20260715", Path(directory), False, 0)
        self.assertGreater(peak, 1)
        self.assertLessEqual(peak, 4)
        self.assertEqual(set(rows), codes)
        self.assertEqual(rows["000019"], [])
        self.assertEqual(len(errors), 1)
        self.assertEqual(build_eastmoney_fund_flow_map(set(), "20260715", Path("unused"), False, 0), ({}, []))

    def test_stale_fallback_is_retained_but_reported_as_missing_target_date(self) -> None:
        stale = [{"date": "2026-07-14", "code": "000001", "mainNetInflow": 1, "source": SOURCE_NAME}]
        with tempfile.TemporaryDirectory() as directory, patch(
            "build_custom_board_data.load_or_fetch_eastmoney_fund_flow", return_value=stale
        ):
            rows, errors = build_eastmoney_fund_flow_map({"000001"}, "20260715", Path(directory), False, 0)
        self.assertEqual(rows["000001"], stale)
        self.assertEqual(len(errors), 1)
        self.assertIn("missing target date 2026-07-15", errors[0])

    def test_fast_intraday_does_not_carry_previous_fund_flow(self) -> None:
        previous = {"fundFlowDate": "2026-07-14", "fundFlowSource": "ths_stock_fund_flow_individual", "mainNetInflow": 99}
        row = enrich_fast_intraday_stock_row({"code": "000001"}, {"date": "2026-07-15", "changePercent": 1}, previous)
        self.assertIsNone(row.get("fundFlowDate"))
        self.assertIsNone(row.get("mainNetInflow"))

    def test_fast_summary_accepts_same_day_eastmoney_or_ths_with_eighty_percent(self) -> None:
        def stock(source=SOURCE_NAME, flow_date="2026-07-15", value=10):
            return {"fundFlowSource": source, "fundFlowDate": flow_date, "mainNetInflow": value,
                    "superLargeNetInflow": value, "largeNetInflow": value,
                    "mediumNetInflow": value, "smallNetInflow": value}
        low = summarize_fast_intraday_board_row("2026-07-15", [stock(), stock(), stock(), stock(flow_date="2026-07-14"), stock(source="ths_stock_fund_flow_individual")])
        self.assertEqual(low["fundFlowStockCount"], 4)
        self.assertEqual(low["mainNetInflow"], 40)
        self.assertEqual(low["fundFlowSource"], "mixed")
        high = summarize_fast_intraday_board_row("2026-07-15", [stock(), stock(), stock(), stock(), stock(source="ths_stock_fund_flow_individual")])
        self.assertEqual(high["mainNetInflow"], 50)
        self.assertEqual(high["fundFlowSource"], "mixed")

    def test_coverage_requires_all_five_flow_fields_and_syncs_source(self) -> None:
        complete = {"fundFlowSource": SOURCE_NAME, "fundFlowDate": "2026-07-15", "mainNetInflow": 1,
                    "superLargeNetInflow": 1, "largeNetInflow": 1, "mediumNetInflow": 1, "smallNetInflow": 1}
        incomplete = {**complete, "smallNetInflow": None}
        summary = summarize_fast_intraday_board_row("2026-07-15", [complete, complete, complete, incomplete])
        self.assertEqual(summary["fundFlowStockCount"], 3)
        self.assertIsNone(summary["mainNetInflow"])
        board = {"stocks": []}
        sync_fast_intraday_board_latest(board, {**summary, "fundFlowSource": SOURCE_NAME})
        self.assertEqual(board["latestFundFlowSource"], SOURCE_NAME)

    def test_validator_accepts_eastmoney_and_rejects_low_coverage_amount(self) -> None:
        valid = {"date": "2026-07-15", "fundFlowLatestDate": "2026-07-15", "mainNetInflow": 10,
                 "fundFlowSource": SOURCE_NAME, "fundFlowStockCount": 4, "stocks": [{}, {}, {}, {}, {}]}
        self.assertEqual(validate_fund_flow_row(valid), [])
        invalid = {**valid, "fundFlowStockCount": 3}
        self.assertIn("fund flow amount present below 80% coverage", validate_fund_flow_row(invalid))
        for bad_source in (None, "unknown_fund_flow_source"):
            self.assertIn("fund flow source mismatch", validate_fund_flow_row({**valid, "fundFlowSource": bad_source}))

    def test_board_aggregates_each_day_with_eighty_percent_gate(self) -> None:
        codes = [f"00000{i}" for i in range(1, 6)]
        dates = ["2026-07-14", "2026-07-15"]
        board = {"code": "x", "name": "test", "stocks": [{"code": code, "name": code} for code in codes]}
        flows = {
            code: [
                {"date": "2026-07-14", "mainNetInflow": 10, "superLargeNetInflow": 1, "largeNetInflow": 1,
                 "mediumNetInflow": 1, "smallNetInflow": 1, "source": SOURCE_NAME},
                *([{"date": "2026-07-15", "mainNetInflow": 20, "superLargeNetInflow": 1, "largeNetInflow": 1,
                    "mediumNetInflow": 1, "smallNetInflow": 1, "source": SOURCE_NAME}] if index < 3 else []),
            ]
            for index, code in enumerate(codes)
        }
        result = build_board(board, price_rows(codes, dates), dates, {}, flows)
        first, second = result["trend"]
        self.assertEqual(first["mainNetInflow"], 50)
        self.assertEqual(first["fundFlowSource"], SOURCE_NAME)
        self.assertEqual(first["fundFlowStockCount"], 5)
        self.assertIsNone(second["mainNetInflow"])
        self.assertEqual(second["fundFlowStockCount"], 3)
        self.assertEqual(second["fundFlowSource"], SOURCE_NAME)


if __name__ == "__main__":
    unittest.main()
