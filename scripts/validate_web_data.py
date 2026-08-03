from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

try:
    from custom_board_history import load_custom_board_payload
except ModuleNotFoundError:
    from scripts.custom_board_history import load_custom_board_payload


ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "web/data"
FULL_A_TURNOVER = WEB_DATA / "full_a_turnover_top20.json"
ETF_FUND_FLOW_CONFIG = WEB_DATA / "etf_fund_flow_config.json"
ETF_FUND_FLOW = WEB_DATA / "etf_fund_flow.json"


def load_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Missing required data file: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {path}: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def number_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        return number
    except (TypeError, ValueError):
        return None


def _is_iso_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def _is_iso_datetime(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return "T" in value
    except ValueError:
        return False


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _non_finite_paths(value: Any, path: str = "payload") -> list[str]:
    errors: list[str] = []
    if isinstance(value, float) and not math.isfinite(value):
        errors.append(f"{path} contains non-finite number")
    elif isinstance(value, dict):
        for key, item in value.items():
            errors.extend(_non_finite_paths(item, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            errors.extend(_non_finite_paths(item, f"{path}[{index}]"))
    return errors


ETF_PAYLOAD_KEYS = {
    "version",
    "date",
    "generatedAt",
    "status",
    "benchmarkCode",
    "historySessionCount",
    "summary",
    "etfs",
    "errors",
}
ETF_ROW_KEYS = {
    "code",
    "name",
    "scope",
    "category",
    "direction",
    "exchange",
    "date",
    "status",
    "shares",
    "sharesDate",
    "previousShares",
    "previousSharesDate",
    "shareChange",
    "nav",
    "navDate",
    "scale",
    "close",
    "marketDate",
    "changePercent",
    "turnover",
    "turnoverVs5d",
    "netSubscription1d",
    "netSubscription5d",
    "netSubscription20d",
    "historySessionCount",
    "windowDays5d",
    "windowDays20d",
    "excessReturn1d",
    "excessReturn5d",
    "positiveFlowDays5d",
    "flowLabel",
    "persistenceLabel",
    "stockBreadth",
    "breadthConfirmed",
    "mainlineCandidate",
}
ETF_NUMERIC_FIELDS = {
    "shares",
    "previousShares",
    "shareChange",
    "nav",
    "scale",
    "close",
    "changePercent",
    "turnover",
    "turnoverVs5d",
    "netSubscription1d",
    "netSubscription5d",
    "netSubscription20d",
    "historySessionCount",
    "windowDays5d",
    "windowDays20d",
    "excessReturn1d",
    "excessReturn5d",
    "positiveFlowDays5d",
    "stockBreadth",
}


def _numbers_close(actual: Any, expected: float) -> bool:
    return _is_finite_number(actual) and math.isclose(
        float(actual), float(expected), rel_tol=1e-9, abs_tol=1e-6
    )


def _expected_flow_label(change: Any, flow: Any) -> str:
    if not _is_finite_number(flow):
        return "待确认"
    if flow == 0:
        return "无净申赎"
    if not _is_finite_number(change):
        return "待确认"
    if flow > 0:
        return "资金强化" if change >= 0 else "逆势承接"
    return "上涨兑现" if change >= 0 else "资金撤退"


def validate_etf_fund_flow(config_path: Path, latest_path: Path) -> list[str]:
    errors: list[str] = []
    try:
        config = load_json(config_path)
    except (FileNotFoundError, ValueError) as exc:
        return [str(exc)]

    configured_rows = config.get("etfs") if isinstance(config, dict) else None
    if not isinstance(configured_rows, list):
        return [f"{config_path} must contain etfs[]"]
    if len(configured_rows) != 30:
        errors.append(f"ETF config must contain exactly 30 rows; found {len(configured_rows)}")

    configured_codes = [
        str(row.get("code") or "") if isinstance(row, dict) else ""
        for row in configured_rows
    ]
    invalid_config_codes = sorted(
        {code or "<missing>" for code in configured_codes if len(code) != 6 or not code.isdigit()}
    )
    if invalid_config_codes:
        errors.append("invalid ETF code in config: " + ", ".join(invalid_config_codes))
    duplicate_config_codes = sorted(
        {code or "<missing>" for code in configured_codes if configured_codes.count(code) > 1}
    )
    if duplicate_config_codes:
        errors.append("duplicate ETF code in config: " + ", ".join(duplicate_config_codes))

    broad_count = sum(
        isinstance(row, dict) and row.get("scope") == "broad" for row in configured_rows
    )
    industry_count = sum(
        isinstance(row, dict) and row.get("scope") == "industry" for row in configured_rows
    )
    if (broad_count, industry_count) != (5, 25):
        errors.append(
            "ETF config must contain 5 broad and 25 industry rows; "
            f"found {broad_count} broad and {industry_count} industry"
        )

    config_version = config.get("version")
    if isinstance(config_version, bool) or not isinstance(config_version, int):
        errors.append("ETF config version must be an integer")
    benchmark_code = str(config.get("benchmarkCode") or "")
    if benchmark_code not in configured_codes:
        errors.append("ETF config benchmarkCode must identify a configured ETF")
    config_by_code = {
        str(row.get("code")): row
        for row in configured_rows
        if isinstance(row, dict) and row.get("code") is not None
    }
    for index, row in enumerate(configured_rows):
        if not isinstance(row, dict):
            errors.append(f"config.etfs[{index}] must be an object")
            continue
        for field in ("code", "name", "scope", "category", "direction", "exchange"):
            if not isinstance(row.get(field), str) or not row[field]:
                errors.append(f"config.etfs[{index}].{field} must be a non-empty string")
        if row.get("exchange") not in {"SSE", "SZSE"}:
            errors.append(f"config.etfs[{index}].exchange is invalid")

    if not latest_path.exists():
        print(
            f"WARNING: ETF fund-flow latest file not generated yet: {latest_path}",
            file=sys.stderr,
            flush=True,
        )
        return errors

    try:
        latest = load_json(latest_path)
    except (FileNotFoundError, ValueError) as exc:
        return errors + [str(exc)]
    if not isinstance(latest, dict):
        return errors + [f"{latest_path} must contain a JSON object"]
    if set(latest) != ETF_PAYLOAD_KEYS:
        errors.append("ETF payload does not match stable schema")
    if latest.get("version") != config_version:
        errors.append("payload.version must match config")
    if latest.get("benchmarkCode") != benchmark_code:
        errors.append("payload.benchmarkCode must match config")

    rows = latest.get("etfs")
    if not isinstance(rows, list):
        return errors + [f"{latest_path} must contain etfs[]"]
    if len(rows) != 30:
        errors.append(f"ETF output must contain exactly 30 rows; found {len(rows)}")

    output_codes = [
        str(row.get("code") or "") if isinstance(row, dict) else "" for row in rows
    ]
    invalid_output_codes = sorted(
        {code or "<missing>" for code in output_codes if len(code) != 6 or not code.isdigit()}
    )
    if invalid_output_codes:
        errors.append("invalid ETF code in output: " + ", ".join(invalid_output_codes))
    duplicate_output_codes = sorted(
        {code or "<missing>" for code in output_codes if output_codes.count(code) > 1}
    )
    if duplicate_output_codes:
        errors.append("duplicate ETF code in output: " + ", ".join(duplicate_output_codes))
    if set(output_codes) != set(configured_codes):
        errors.append("output/config ETF codes differ")

    if not _is_iso_date(latest.get("date")):
        errors.append("payload.date has invalid ISO date")
    if not _is_iso_datetime(latest.get("generatedAt")):
        errors.append("payload.generatedAt has invalid ISO datetime")
    errors.extend(_non_finite_paths(latest))
    payload_session_count = latest.get("historySessionCount")
    if (
        isinstance(payload_session_count, bool)
        or not isinstance(payload_session_count, int)
        or payload_session_count < 1
    ):
        errors.append("payload.historySessionCount must be a positive integer")

    pending_null_fields = (
        "shareChange",
        "netSubscription1d",
        "netSubscription5d",
        "netSubscription20d",
        "positiveFlowDays5d",
        "persistenceLabel",
    )
    date_fields = ("date", "sharesDate", "previousSharesDate", "navDate", "marketDate")
    rows_by_code = {
        str(row.get("code")): row
        for row in rows
        if isinstance(row, dict) and row.get("code") is not None
    }
    benchmark_row = rows_by_code.get(benchmark_code, {})
    benchmark_change = benchmark_row.get("changePercent")
    for index, row in enumerate(rows):
        row_path = f"etfs[{index}]"
        if not isinstance(row, dict):
            errors.append(f"{row_path} must be an object")
            continue
        if set(row) != ETF_ROW_KEYS:
            errors.append(f"{row_path} does not match stable schema")
        config_row = config_by_code.get(str(row.get("code")))
        if config_row is not None and any(
            row.get(field) != config_row.get(field)
            for field in ("name", "scope", "category", "direction", "exchange")
        ):
            errors.append(f"{row_path} metadata differs from config")
        if row.get("date") != latest.get("date"):
            errors.append(f"{row_path}.date must match payload.date")
        for field in date_fields:
            value = row.get(field)
            if value is not None and not _is_iso_date(value):
                errors.append(f"{row_path}.{field} has invalid ISO date")
        for field in ETF_NUMERIC_FIELDS:
            value = row.get(field)
            if value is not None and not _is_finite_number(value):
                errors.append(f"{row_path}.{field} must be a finite number")
        for field in ("breadthConfirmed", "mainlineCandidate"):
            if not isinstance(row.get(field), bool):
                errors.append(f"{row_path}.{field} must be boolean")

        status = row.get("status")
        if status == "confirmed":
            confirmed_fields = {
                "date": "date",
                "shares": "shares",
                "sharesDate": "shares date",
                "previousShares": "previous shares",
                "previousSharesDate": "previous shares date",
                "nav": "NAV",
                "navDate": "NAV date",
                "shareChange": "share change",
                "scale": "scale",
                "netSubscription1d": "net subscription",
            }
            for field, label in confirmed_fields.items():
                value = row.get(field)
                if value is None:
                    errors.append(f"{row_path} confirmed row missing {label}")
                elif field in ETF_NUMERIC_FIELDS and not _is_finite_number(value):
                    errors.append(f"{row_path} confirmed row invalid {label}")
            optional_market_labels = {
                "close": "close",
                "changePercent": "change percent",
                "turnover": "turnover",
            }
            for field, label in optional_market_labels.items():
                if row.get(field) is not None and not _is_finite_number(row.get(field)):
                    errors.append(f"{row_path} confirmed row invalid {label}")
            row_date = row.get("date")
            if _is_iso_date(row_date):
                for field in ("sharesDate", "navDate"):
                    value = row.get(field)
                    if _is_iso_date(value) and value != row_date:
                        errors.append(f"{row_path} confirmed row {field} must match row.date")
                previous_shares_date = row.get("previousSharesDate")
                if (
                    _is_iso_date(previous_shares_date)
                    and previous_shares_date >= row_date
                ):
                    errors.append(
                        f"{row_path} confirmed row previousSharesDate must be earlier than row.date"
                    )
        elif status == "pending":
            for field in pending_null_fields:
                if row.get(field) is not None:
                    errors.append(f"{row_path} pending row must preserve null {field}")
        else:
            errors.append(f"{row_path} has invalid status: {status!r}")

        row_date = row.get("date")
        market_date = row.get("marketDate")
        if _is_iso_date(market_date) and _is_iso_date(row_date) and market_date != row_date:
            errors.append(f"{row_path}.marketDate must match row.date")
        if any(row.get(field) is not None for field in ("close", "changePercent", "turnover")):
            if market_date is None:
                errors.append(f"{row_path}.marketDate is required for market values")

        shares = row.get("shares")
        previous_shares = row.get("previousShares")
        nav = row.get("nav")
        current_aligned = (
            _is_finite_number(shares)
            and _is_finite_number(nav)
            and row.get("sharesDate") == row_date
            and row.get("navDate") == row_date
        )
        previous_aligned = (
            _is_finite_number(previous_shares)
            and _is_iso_date(row.get("previousSharesDate"))
            and _is_iso_date(row_date)
            and row["previousSharesDate"] < row_date
        )
        expected_scale = shares * nav if current_aligned else None
        if expected_scale is None:
            if row.get("scale") is not None:
                errors.append(f"{row_path}.scale formula requires aligned shares and NAV")
        elif not _numbers_close(row.get("scale"), expected_scale):
            errors.append(f"{row_path}.scale formula mismatch")

        if status == "confirmed" and current_aligned and previous_aligned:
            expected_change = shares - previous_shares
            if not _numbers_close(row.get("shareChange"), expected_change):
                errors.append(f"{row_path}.shareChange formula mismatch")
            expected_subscription = expected_change * nav
            if not _numbers_close(row.get("netSubscription1d"), expected_subscription):
                errors.append(f"{row_path}.netSubscription1d formula mismatch")

        expected_excess_1d = None
        if _is_finite_number(row.get("changePercent")) and _is_finite_number(benchmark_change):
            expected_excess_1d = row["changePercent"] - benchmark_change
        if expected_excess_1d is None:
            if row.get("excessReturn1d") is not None:
                errors.append(f"{row_path}.excessReturn1d formula requires both returns")
        elif not _numbers_close(row.get("excessReturn1d"), expected_excess_1d):
            errors.append(f"{row_path}.excessReturn1d formula mismatch")

        expected_label = _expected_flow_label(
            row.get("changePercent"), row.get("netSubscription1d")
        )
        if row.get("flowLabel") != expected_label:
            errors.append(f"{row_path}.flowLabel must be {expected_label}")

        row_session_count = row.get("historySessionCount")
        if row_session_count != payload_session_count:
            errors.append(f"{row_path}.historySessionCount must match payload")
        for field, maximum in (("windowDays5d", 5), ("windowDays20d", 20)):
            value = row.get(field)
            allowed = min(maximum, payload_session_count) if isinstance(payload_session_count, int) else 0
            if (
                isinstance(value, bool)
                or not isinstance(value, int)
                or value < 1
                or value > allowed
            ):
                errors.append(f"{row_path}.{field} is outside the available window")
        window_5d = row.get("windowDays5d")
        positive_days = row.get("positiveFlowDays5d")
        if positive_days is not None and (
            isinstance(positive_days, bool)
            or not isinstance(positive_days, int)
            or not isinstance(window_5d, int)
            or not (0 <= positive_days <= window_5d)
        ):
            errors.append(f"{row_path}.positiveFlowDays5d exceeds its window")
        if (row.get("netSubscription5d") is None) != (positive_days is None):
            errors.append(f"{row_path} 5-day flow and positiveFlowDays5d must share availability")
        if payload_session_count == 1 and status == "confirmed":
            if not _numbers_close(row.get("netSubscription5d"), row["netSubscription1d"]):
                errors.append(f"{row_path}.netSubscription5d first-session invariant failed")
            if not _numbers_close(row.get("netSubscription20d"), row["netSubscription1d"]):
                errors.append(f"{row_path}.netSubscription20d first-session invariant failed")
        if isinstance(window_5d, int) and window_5d < 5:
            if row.get("turnoverVs5d") is not None or row.get("excessReturn5d") is not None:
                errors.append(f"{row_path} incomplete 5-day market window must stay null")
            if row.get("persistenceLabel") is not None:
                errors.append(f"{row_path} incomplete 5-day persistence must stay null")
        if row.get("persistenceLabel") not in {None, "持续流入", "持续流出"}:
            errors.append(f"{row_path}.persistenceLabel is invalid")

        breadth = row.get("stockBreadth")
        breadth_confirmed = row.get("breadthConfirmed")
        if breadth is not None and (
            not _is_finite_number(breadth) or not 0 <= breadth <= 1
        ):
            errors.append(f"{row_path}.stockBreadth must be between 0 and 1")
        if breadth_confirmed is True and not _is_finite_number(breadth):
            errors.append(f"{row_path}.breadthConfirmed requires stockBreadth")
        if breadth_confirmed is False and breadth is not None:
            errors.append(f"{row_path}.stockBreadth must be null when breadth is unconfirmed")

        if row.get("mainlineCandidate") is True:
            mainline_conditions = (
                row.get("scope") == "industry"
                and status == "confirmed"
                and window_5d == 5
                and _is_finite_number(row.get("netSubscription1d"))
                and row["netSubscription1d"] > 0
                and _is_finite_number(row.get("netSubscription5d"))
                and row["netSubscription5d"] > 0
                and _is_finite_number(row.get("excessReturn5d"))
                and row["excessReturn5d"] > 0
                and isinstance(positive_days, int)
                and positive_days >= 3
                and _is_finite_number(row.get("turnoverVs5d"))
                and row["turnoverVs5d"] >= 1
                and breadth_confirmed is True
                and _is_finite_number(breadth)
                and breadth >= 0.5
            )
            if not mainline_conditions:
                errors.append(f"{row_path}.mainlineCandidate lacks required evidence")

    summary = latest.get("summary")
    if not isinstance(summary, dict) or set(summary) != {"all", "broad", "industry"}:
        errors.append("payload.summary does not match stable schema")
    else:
        confirmed_count = sum(
            isinstance(row, dict) and row.get("status") == "confirmed" for row in rows
        )
        expected_status = (
            "confirmed"
            if rows and confirmed_count == len(rows)
            else "partial"
            if confirmed_count
            else "pending"
        )
        if latest.get("status") != expected_status:
            errors.append("payload.status does not match confirmed counts")
        for scope, scoped_rows in (
            ("all", rows),
            ("broad", [row for row in rows if isinstance(row, dict) and row.get("scope") == "broad"]),
            ("industry", [row for row in rows if isinstance(row, dict) and row.get("scope") == "industry"]),
        ):
            actual = summary.get(scope)
            expected_counts = {
                "count": len(scoped_rows),
                "confirmedCount": sum(row.get("status") == "confirmed" for row in scoped_rows),
                "pendingCount": sum(row.get("status") != "confirmed" for row in scoped_rows),
            }
            expected_keys = set(expected_counts) if scope == "all" else set(expected_counts) | {"netSubscription1d"}
            if not isinstance(actual, dict) or set(actual) != expected_keys:
                if scope == "all":
                    errors.append("summary.all must contain counts only")
                else:
                    errors.append(f"summary.{scope} does not match stable schema")
                continue
            if any(actual.get(key) != value for key, value in expected_counts.items()):
                errors.append(f"summary.{scope} counts do not match rows")
            if scope != "all":
                flows = [
                    row.get("netSubscription1d")
                    for row in scoped_rows
                    if row.get("status") == "confirmed"
                    and _is_finite_number(row.get("netSubscription1d"))
                ]
                expected_flow = sum(flows) if flows else None
                if expected_flow is None:
                    if actual.get("netSubscription1d") is not None:
                        errors.append(f"summary.{scope} netSubscription1d must be null")
                elif not _numbers_close(actual.get("netSubscription1d"), expected_flow):
                    errors.append(f"summary.{scope} netSubscription1d does not match rows")

    error_rows = latest.get("errors")
    if not isinstance(error_rows, list):
        errors.append("payload.errors must be a list")
    else:
        for index, item in enumerate(error_rows):
            path = f"errors[{index}]"
            if not isinstance(item, dict) or set(item) != {"code", "source", "message"}:
                errors.append(f"{path} does not match stable schema")
                continue
            code = item.get("code")
            if code is not None and code not in configured_codes:
                errors.append(f"{path}.code must be null or a configured ETF code")
            if not isinstance(item.get("source"), str) or not item["source"].strip():
                errors.append(f"{path}.source must be non-empty")
            if not isinstance(item.get("message"), str) or not item["message"].strip():
                errors.append(f"{path}.message must be non-empty")
    return errors


def validate_fund_flow_row(row: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    amount = row.get("mainNetInflow")
    flow_date = row.get("fundFlowLatestDate")
    if amount is not None and flow_date != row.get("date"):
        errors.append("fund flow date mismatch")
    source = row.get("fundFlowSource")
    if amount is not None and source not in {
        "eastmoney_stock_individual_fund_flow",
        "ths_stock_fund_flow_individual",
        "mixed",
    }:
        errors.append("fund flow source mismatch")
    count = number_or_none(row.get("fundFlowStockCount"))
    stocks = row.get("stocks")
    total = float(len(stocks)) if isinstance(stocks, list) else number_or_none(row.get("stockCount"))
    if count is not None and total is not None and count > total:
        errors.append("fund flow coverage exceeds stock count")
    if amount is not None and count is not None and total is not None and total > 0 and count / total < 0.8:
        errors.append("fund flow amount present below 80% coverage")
    return errors


def validate_custom(web_data: Path) -> dict[str, Any]:
    data_path = web_data / "custom_boards.json"
    config_path = web_data / "custom_boards_config.json"
    membership_path = web_data / "custom_board_membership.json"

    latest_payload = load_json(data_path)
    display_days = int(number_or_none(latest_payload.get("days")) or 15) if isinstance(latest_payload, dict) else 15
    data = load_custom_board_payload(data_path, days=display_days)
    config = load_json(config_path)
    membership = load_json(membership_path)

    require(isinstance(data.get("boards"), list), f"{data_path} must contain boards[]")
    require(data.get("boards"), f"{data_path} boards[] is empty")
    require(data.get("date"), f"{data_path} must contain date")
    require(isinstance(config.get("boards"), list), f"{config_path} must contain boards[]")
    require(isinstance(membership.get("overrides"), list), f"{membership_path} must contain overrides[]")

    boards_without_trend = [
        str(board.get("name") or board.get("code") or "<unnamed>")
        for board in data.get("boards", [])
        if not isinstance(board.get("trend"), list) or not board.get("trend")
    ]
    require(not boards_without_trend, "Custom boards missing trend data: " + ", ".join(boards_without_trend))

    fund_flow_errors = []
    for board in data.get("boards", []):
        for row in board.get("trend") or []:
            for error in validate_fund_flow_row(row):
                fund_flow_errors.append(
                    f"{board.get('name') or board.get('code')} {row.get('date')}: {error}"
                )
    require(not fund_flow_errors, "Invalid custom-board fund flow data: " + "; ".join(fund_flow_errors[:10]))

    market_trend = data.get("marketIndex", {}).get("trend", [])
    require(isinstance(market_trend, list), f"{data_path} marketIndex.trend must be a list")
    for previous, current in zip(market_trend, market_trend[1:]):
        current_volume = number_or_none(current.get("volume"))
        previous_volume = number_or_none(previous.get("volume"))
        if current.get("source") == "intraday_index_spot_tencent" and current_volume is not None and previous_volume:
            ratio = current_volume / previous_volume
            require(
                ratio <= 5,
                "Suspicious market index volume ratio; realtime volume may use a different unit: "
                f"{current.get('date')} volume={current_volume}, previous={previous_volume}, ratio={ratio:.4f}",
            )
    return {
        "date": data.get("date"),
        "boards": len(data.get("boards", [])),
        "configBoards": len(config.get("boards", [])),
        "membershipOverrides": len(membership.get("overrides", [])),
    }


def validate_full_a_turnover(web_data: Path) -> dict[str, Any]:
    data_path = web_data / "full_a_turnover_top20.json"
    if not data_path.exists():
        return {"date": "missing", "stocks": 0, "missing": True}
    data = load_json(data_path)
    stocks = data.get("stocks")
    require(isinstance(stocks, list), f"{data_path} must contain stocks[]")
    require(len(stocks) >= 20, f"{data_path} must contain at least 20 rows")

    previous_turnover: float | None = None
    for index, stock in enumerate(stocks[:20], start=1):
        code = str(stock.get("code") or "")
        turnover = number_or_none(stock.get("turnover") or stock.get("amount"))
        change = number_or_none(stock.get("changePercent"))
        require(code.isdigit() and len(code) == 6, f"{data_path} row {index} has invalid code: {code!r}")
        require(turnover is not None and turnover > 0, f"{data_path} row {index} missing positive turnover")
        require(change is not None, f"{data_path} row {index} missing changePercent")
        if previous_turnover is not None:
            require(turnover <= previous_turnover, f"{data_path} stocks[] must be sorted by turnover desc")
        previous_turnover = turnover

    return {
        "date": data.get("date"),
        "stocks": len(stocks),
        "missing": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate web dashboard JSON files required by the frontend.")
    parser.add_argument("--web-data", type=Path, default=WEB_DATA)
    args = parser.parse_args()

    custom = validate_custom(args.web_data)
    full_a = validate_full_a_turnover(args.web_data)
    etf_errors = validate_etf_fund_flow(
        args.web_data / ETF_FUND_FLOW_CONFIG.name,
        args.web_data / ETF_FUND_FLOW.name,
    )
    require(not etf_errors, "Invalid ETF fund-flow data: " + "; ".join(etf_errors[:20]))
    print(
        "Custom board data OK: date={date}, boards={boards}, configBoards={configBoards}, membershipOverrides={membershipOverrides}".format(
            **custom
        )
    )
    if full_a["missing"]:
        print("Full-A turnover data skipped: web/data/full_a_turnover_top20.json not generated yet")
    else:
        print("Full-A turnover data OK: date={date}, stocks={stocks}".format(**full_a))
    if (args.web_data / ETF_FUND_FLOW.name).exists():
        print("ETF fund-flow data OK")


if __name__ == "__main__":
    main()
