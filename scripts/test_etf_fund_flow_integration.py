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
        "boardMappings": {},
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
                "name": etf["name"],
                "scope": etf["scope"],
                "category": etf["category"],
                "direction": etf["direction"],
                "exchange": etf["exchange"],
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
                "scale": 1_500_000.0,
                "turnoverVs5d": None,
                "netSubscription1d": 250_000.0,
                "netSubscription5d": 250_000.0,
                "netSubscription20d": 250_000.0,
                "historySessionCount": 1,
                "windowDays5d": 1,
                "windowDays20d": 1,
                "excessReturn1d": 0.0 if etf["code"] == config["benchmarkCode"] else 0.0,
                "excessReturn5d": None,
                "positiveFlowDays5d": 1,
                "flowLabel": "资金强化",
                "persistenceLabel": None,
                "stockBreadth": None,
                "breadthConfirmed": False,
                "mainlineCandidate": False,
            }
        )
    return {
        "version": 1,
        "date": "2026-07-31",
        "generatedAt": "2026-07-31T08:30:00+00:00",
        "status": "confirmed",
        "benchmarkCode": config["benchmarkCode"],
        "historySessionCount": 1,
        "summary": {
            "all": {"count": 30, "confirmedCount": 30, "pendingCount": 0},
            "broad": {
                "count": 5,
                "confirmedCount": 5,
                "pendingCount": 0,
                "netSubscription1d": 1_250_000.0,
            },
            "industry": {
                "count": 25,
                "confirmedCount": 25,
                "pendingCount": 0,
                "netSubscription1d": 6_250_000.0,
            },
        },
        "etfs": rows,
        "errors": [],
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

    def test_confirmed_fund_flow_does_not_require_market_observation(self) -> None:
        valid = copy.deepcopy(self.payload)
        row = valid["etfs"][1]
        for field in (
            "close",
            "marketDate",
            "changePercent",
            "turnover",
            "turnoverVs5d",
            "excessReturn1d",
            "excessReturn5d",
        ):
            row[field] = None
        row["flowLabel"] = "待确认"
        self.assertEqual(self.validate(payload=valid), [])

    def test_confirmed_row_requires_current_input_dates_to_match_row_date(self) -> None:
        for field in ("sharesDate", "navDate"):
            with self.subTest(field=field):
                invalid = copy.deepcopy(self.payload)
                invalid["etfs"][0][field] = "2026-07-30"
                errors = "\n".join(self.validate(payload=invalid))
                self.assertIn(f"confirmed row {field} must match row.date", errors)

    def test_market_date_matches_row_date_only_when_present(self) -> None:
        invalid = copy.deepcopy(self.payload)
        invalid["etfs"][0]["marketDate"] = "2026-07-30"
        self.assertIn(
            "marketDate must match row.date",
            "\n".join(self.validate(payload=invalid)),
        )

    def test_confirmed_row_requires_previous_shares_date_before_row_date(self) -> None:
        for previous_date in ("2026-07-31", "2026-08-01"):
            with self.subTest(previous_date=previous_date):
                invalid = copy.deepcopy(self.payload)
                invalid["etfs"][0]["previousSharesDate"] = previous_date
                errors = "\n".join(self.validate(payload=invalid))
                self.assertIn(
                    "confirmed row previousSharesDate must be earlier than row.date",
                    errors,
                )

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

    def test_stable_schema_and_config_metadata_are_required(self) -> None:
        for field in ("name", "category", "direction", "exchange", "excessReturn1d"):
            with self.subTest(field=field):
                invalid = copy.deepcopy(self.payload)
                invalid["etfs"][0].pop(field)
                self.assertIn("stable schema", "\n".join(self.validate(payload=invalid)))

        invalid = copy.deepcopy(self.payload)
        invalid["etfs"][0]["name"] = "wrong ETF"
        self.assertIn("metadata differs from config", "\n".join(self.validate(payload=invalid)))

        invalid = copy.deepcopy(self.payload)
        invalid["benchmarkCode"] = "599999"
        self.assertIn("benchmarkCode must match config", "\n".join(self.validate(payload=invalid)))

    def test_formulas_reject_turnover_or_other_values_copied_into_subscription(self) -> None:
        invalid = copy.deepcopy(self.payload)
        row = invalid["etfs"][0]
        row["shareChange"] = 123.0
        row["netSubscription1d"] = row["turnover"]
        row["scale"] = 456.0
        errors = "\n".join(self.validate(payload=invalid))
        self.assertIn("shareChange formula", errors)
        self.assertIn("netSubscription1d formula", errors)
        self.assertIn("scale formula", errors)

    def test_window_summary_and_payload_status_invariants_are_enforced(self) -> None:
        invalid = copy.deepcopy(self.payload)
        invalid["etfs"][0]["windowDays5d"] = 6
        invalid["etfs"][1]["positiveFlowDays5d"] = 2
        invalid["summary"]["all"]["netSubscription1d"] = 7_500_000.0
        invalid["summary"]["broad"]["confirmedCount"] = 4
        invalid["summary"]["industry"]["netSubscription1d"] = 500_000.0
        invalid["status"] = "partial"
        errors = "\n".join(self.validate(payload=invalid))
        self.assertIn("windowDays5d", errors)
        self.assertIn("positiveFlowDays5d", errors)
        self.assertIn("summary.all must contain counts only", errors)
        self.assertIn("summary.broad", errors)
        self.assertIn("summary.industry", errors)
        self.assertIn("payload.status", errors)

    def test_excess_return_flow_label_and_mainline_conditions_are_verified(self) -> None:
        invalid = copy.deepcopy(self.payload)
        invalid["etfs"][0]["excessReturn1d"] = 9.0
        invalid["etfs"][1]["flowLabel"] = "资金撤退"
        invalid["etfs"][2]["mainlineCandidate"] = True
        errors = "\n".join(self.validate(payload=invalid))
        self.assertIn("excessReturn1d formula", errors)
        self.assertIn("flowLabel", errors)
        self.assertIn("mainlineCandidate", errors)

    def test_error_summary_schema_is_validated(self) -> None:
        invalid = copy.deepcopy(self.payload)
        invalid["errors"] = [{"code": "missing", "source": "", "message": ""}]
        errors = "\n".join(self.validate(payload=invalid))
        self.assertIn("errors[0].code", errors)
        self.assertIn("errors[0].source", errors)
        self.assertIn("errors[0].message", errors)


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

    def test_old_latest_plus_failed_etf_build_runs_validation_but_fails_completion(self) -> None:
        calls: list[list[str]] = []

        def optional(args: list[str], output_path: Path | None = None) -> bool:
            calls.append(args)
            if args[0] == "scripts/build_etf_fund_flow.py":
                raise subprocess.CalledProcessError(1, args)
            return True

        with tempfile.TemporaryDirectory() as directory:
            stale_latest = Path(directory) / "etf.json"
            stale_latest.write_text(
                json.dumps(
                    {
                        "date": "2026-07-30",
                        "status": "partial",
                        "summary": {"all": {"count": 30, "confirmedCount": 22, "pendingCount": 8}},
                    }
                ),
                encoding="utf-8",
            )
            with (
                patch.object(
                    sys,
                    "argv",
                    ["update_daily_data.py", "--date", "20260731", "--skip-custom"],
                ),
                patch.object(update_daily_data, "ETF_FUND_FLOW", stale_latest),
                patch.object(update_daily_data, "is_today", return_value=True),
                patch.object(update_daily_data, "is_trading_time", return_value=False),
                patch.object(update_daily_data, "run_optional", side_effect=optional),
                patch.object(update_daily_data, "run_script", side_effect=lambda args: calls.append(args)),
            ):
                with self.assertRaisesRegex(RuntimeError, "not publishable for 2026-07-31"):
                    update_daily_data.main()

        self.assertIn(["scripts/validate_web_data.py"], calls)

    def test_target_date_partial_latest_satisfies_publication_policy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            latest = Path(directory) / "etf.json"
            latest.write_text(
                json.dumps(
                    {
                        "date": "2026-07-31",
                        "status": "partial",
                        "summary": {"all": {"count": 30, "confirmedCount": 22, "pendingCount": 8}},
                    }
                ),
                encoding="utf-8",
            )
            self.assertTrue(
                update_daily_data.etf_latest_satisfies_publication_policy(
                    latest, "20260731"
                )
            )


if __name__ == "__main__":
    unittest.main()
