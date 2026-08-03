from __future__ import annotations

import copy
import io
import json
import math
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from scripts import update_daily_data, validate_web_data


ROOT = Path(__file__).resolve().parents[1]
UPDATE_SOURCE = (ROOT / "scripts/update_daily_data.py").read_text(encoding="utf-8")
VALIDATOR_SOURCE = (ROOT / "scripts/validate_web_data.py").read_text(encoding="utf-8")


def make_config() -> dict:
    return {
        "version": 1,
        "benchmarkCode": "510000",
        "etfs": [
            {
                "code": f"{510000 + index:06d}",
                "name": f"ETF {index}",
                "scope": "broad" if index < 5 else "industry",
                "category": "test",
                "direction": "test",
                "exchange": "SSE",
            }
            for index in range(30)
        ],
    }


def make_payload(config: dict) -> dict:
    rows = []
    for etf in config["etfs"]:
        rows.append(
            {
                "code": etf["code"],
                "scope": etf["scope"],
                "date": "2026-07-31",
                "status": "confirmed",
                "shares": 1_200_000.0,
                "sharesDate": "2026-07-31",
                "previousShares": 1_000_000.0,
                "previousSharesDate": "2026-07-30",
                "nav": 1.25,
                "navDate": "2026-07-31",
                "close": 1.3,
                "marketDate": "2026-07-31",
                "changePercent": 1.0,
                "turnover": 500_000.0,
                "shareChange": 200_000.0,
                "netSubscription1d": 250_000.0,
                "netSubscription5d": None,
                "netSubscription20d": None,
                "positiveFlowDays5d": None,
            }
        )
    return {
        "version": 1,
        "date": "2026-07-31",
        "generatedAt": "2026-07-31T08:30:00+00:00",
        "etfs": rows,
    }


class EtfFundFlowValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)
        self.config = make_config()
        self.payload = make_payload(self.config)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write(self, name: str, payload: dict) -> Path:
        path = self.directory / name
        path.write_text(json.dumps(payload, allow_nan=True), encoding="utf-8")
        return path

    def validate(self, config: dict | None = None, payload: dict | None = None) -> list[str]:
        config_path = self.write("config.json", config or self.config)
        latest_path = self.write("latest.json", payload or self.payload)
        return validate_web_data.validate_etf_fund_flow(config_path, latest_path)

    def test_source_wires_etf_builder_and_validator(self) -> None:
        self.assertIn("scripts/build_etf_fund_flow.py", UPDATE_SOURCE)
        self.assertIn("etf_fund_flow.json", VALIDATOR_SOURCE)

    def test_valid_payload_has_no_errors(self) -> None:
        self.assertEqual(self.validate(), [])

    def test_duplicate_config_code_is_rejected(self) -> None:
        duplicate = copy.deepcopy(self.config)
        duplicate["etfs"][1]["code"] = duplicate["etfs"][0]["code"]
        self.assertIn("duplicate ETF code", "\n".join(self.validate(config=duplicate)))

    def test_missing_config_codes_are_invalid_and_cannot_appear_unique(self) -> None:
        invalid = copy.deepcopy(self.config)
        invalid["etfs"][0]["code"] = None
        invalid["etfs"][1].pop("code")
        self.assertIn("invalid ETF code", "\n".join(self.validate(config=invalid)))

    def test_confirmed_row_requires_nav(self) -> None:
        invalid = copy.deepcopy(self.payload)
        invalid["etfs"][0]["nav"] = None
        self.assertIn("confirmed row missing NAV", "\n".join(self.validate(payload=invalid)))

    def test_confirmed_row_rejects_missing_date_and_non_numeric_inputs(self) -> None:
        invalid = copy.deepcopy(self.payload)
        invalid["etfs"][0]["date"] = None
        invalid["etfs"][1]["nav"] = "garbage"
        invalid["etfs"][2]["turnover"] = True
        errors = "\n".join(self.validate(payload=invalid))
        self.assertIn("confirmed row missing date", errors)
        self.assertIn("confirmed row invalid NAV", errors)
        self.assertIn("confirmed row invalid turnover", errors)

    def test_requires_exact_universe_scope_split_and_matching_output_codes(self) -> None:
        short = copy.deepcopy(self.config)
        short["etfs"].pop()
        self.assertIn("exactly 30", "\n".join(self.validate(config=short)))

        wrong_split = copy.deepcopy(self.config)
        wrong_split["etfs"][4]["scope"] = "industry"
        self.assertIn("5 broad and 25 industry", "\n".join(self.validate(config=wrong_split)))

        mismatched = copy.deepcopy(self.payload)
        mismatched["etfs"][0]["code"] = "599999"
        self.assertIn("output/config ETF codes differ", "\n".join(self.validate(payload=mismatched)))

    def test_rejects_invalid_dates_and_non_finite_numbers(self) -> None:
        invalid = copy.deepcopy(self.payload)
        invalid["etfs"][0]["navDate"] = "20260731"
        invalid["etfs"][1]["turnover"] = math.nan
        errors = "\n".join(self.validate(payload=invalid))
        self.assertIn("invalid ISO date", errors)
        self.assertIn("non-finite number", errors)

    def test_pending_rows_preserve_null_derived_values(self) -> None:
        fields = (
            "shareChange",
            "netSubscription1d",
            "netSubscription5d",
            "netSubscription20d",
            "positiveFlowDays5d",
            "persistenceLabel",
        )
        for field in fields:
            with self.subTest(field=field):
                invalid = copy.deepcopy(self.payload)
                row = invalid["etfs"][0]
                row["status"] = "pending"
                for derived_field in fields:
                    row[derived_field] = None
                row[field] = "not-null"
                errors = "\n".join(self.validate(payload=invalid))
                self.assertIn(f"pending row must preserve null {field}", errors)

    def test_missing_latest_is_allowed_with_clear_warning(self) -> None:
        config_path = self.write("config.json", self.config)
        missing_path = self.directory / "not-generated-yet.json"
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            errors = validate_web_data.validate_etf_fund_flow(config_path, missing_path)
        self.assertEqual(errors, [])
        self.assertIn("WARNING", stderr.getvalue())
        self.assertIn("not generated yet", stderr.getvalue())


class EtfFundFlowUpdateTest(unittest.TestCase):
    def run_update(self, *arguments: str, trading_time: bool) -> list[list[str]]:
        calls: list[list[str]] = []

        def record_script(args: list[str]) -> None:
            calls.append(args)

        def record_optional(args: list[str], output_path: Path | None = None) -> bool:
            calls.append(args)
            return True

        with (
            patch.object(sys, "argv", ["update_daily_data.py", *arguments]),
            patch.object(update_daily_data, "is_today", return_value=True),
            patch.object(update_daily_data, "is_trading_time", return_value=trading_time),
            patch.object(update_daily_data, "skip_optional_for_missing_modules", return_value=False),
            patch.object(update_daily_data, "run_script", side_effect=record_script),
            patch.object(update_daily_data, "run_optional", side_effect=record_optional),
        ):
            update_daily_data.main()
        return calls

    def test_intraday_radar_only_never_runs_etf_builder(self) -> None:
        calls = self.run_update("--date", "20260731", "--intraday-radar-only", trading_time=True)
        self.assertFalse(
            any(call and call[0] == "scripts/build_etf_fund_flow.py" for call in calls),
            calls,
        )

    def test_full_update_runs_optional_etf_builder_before_validation(self) -> None:
        calls = self.run_update("--date", "20260731", "--skip-custom", trading_time=False)
        builder = ["scripts/build_etf_fund_flow.py", "--date", "20260731"]
        validator = ["scripts/validate_web_data.py"]
        self.assertIn(builder, calls)
        self.assertLess(calls.index(builder), calls.index(validator))

    def test_first_etf_build_failure_still_runs_final_validation(self) -> None:
        calls: list[list[str]] = []

        def optional(args: list[str], output_path: Path | None = None) -> bool:
            calls.append(args)
            if args[0] == "scripts/build_etf_fund_flow.py":
                raise subprocess.CalledProcessError(1, args)
            return True

        with (
            patch.object(
                sys,
                "argv",
                ["update_daily_data.py", "--date", "20260731", "--skip-custom"],
            ),
            patch.object(update_daily_data, "is_today", return_value=True),
            patch.object(update_daily_data, "is_trading_time", return_value=False),
            patch.object(update_daily_data, "run_optional", side_effect=optional),
            patch.object(update_daily_data, "run_script", side_effect=lambda args: calls.append(args)),
        ):
            update_daily_data.main()

        self.assertIn(["scripts/validate_web_data.py"], calls)


if __name__ == "__main__":
    unittest.main()
