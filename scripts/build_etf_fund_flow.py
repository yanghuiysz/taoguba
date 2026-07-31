from __future__ import annotations

import argparse
import json
import math
import os
import socket
import tempfile
import threading
import time
from datetime import date as date_type
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "web/data/etf_fund_flow_config.json"
DEFAULT_OUTPUT = ROOT / "web/data/etf_fund_flow.json"
DEFAULT_HISTORY_DIR = ROOT / "web/data/etf_fund_flow/history"
DEFAULT_CUSTOM_BOARDS = ROOT / "web/data/custom_boards.json"
_sleep = time.sleep
_REQUEST_TIMEOUT_LOCK = threading.RLock()


def _finite_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", "").removesuffix("%")
        if not value or value in {"-", "--"}:
            return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _normal_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date_type):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    digits = "".join(character for character in text if character.isdigit())
    if len(digits) >= 8:
        try:
            return datetime.strptime(digits[:8], "%Y%m%d").date().isoformat()
        except ValueError:
            return None
    return None


def _compact_date(value: Any) -> str:
    normalized = _normal_date(value)
    if normalized is None:
        raise ValueError(f"invalid date: {value!r}")
    return normalized.replace("-", "")


def _normal_code(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.endswith(".0") and text[:-2].isdigit():
        text = text[:-2]
    digits = "".join(character for character in text if character.isdigit())
    return digits.zfill(6) if digits else None


def _records(frame: Any) -> list[dict]:
    if frame is None:
        return []
    if isinstance(frame, list):
        return [item for item in frame if isinstance(item, dict)]
    if isinstance(frame, tuple):
        return [item for item in frame if isinstance(item, dict)]
    if hasattr(frame, "to_dict"):
        records = frame.to_dict("records")
        return [item for item in records if isinstance(item, dict)]
    raise TypeError(f"unsupported tabular result: {type(frame).__name__}")


def _load_akshare():
    import akshare as ak

    return ak


def _call_with_retries(
    operation: Callable[[], Any],
    *,
    attempts: int = 3,
    timeout_seconds: float = 20.0,
) -> Any:
    import requests

    last_error: Exception | None = None
    original_timeout = socket.getdefaulttimeout()
    with _REQUEST_TIMEOUT_LOCK:
        original_request = requests.sessions.Session.request

        def request_with_timeout(session, method, url, **kwargs):
            if kwargs.get("timeout") is None:
                kwargs["timeout"] = timeout_seconds
            return original_request(session, method, url, **kwargs)

        try:
            socket.setdefaulttimeout(timeout_seconds)
            requests.sessions.Session.request = request_with_timeout
            for attempt in range(attempts):
                try:
                    return operation()
                except Exception as error:  # Network libraries expose several error families.
                    last_error = error
                    if attempt + 1 < attempts:
                        _sleep(0.5 * (2**attempt))
        finally:
            requests.sessions.Session.request = original_request
            socket.setdefaulttimeout(original_timeout)
    assert last_error is not None
    raise last_error


def fetch_sse_shares(date: str) -> dict[str, dict]:
    """Use akshare.fund_etf_scale_sse(date); return code -> {shares, sharesDate}."""
    compact = _compact_date(date)
    frame = _call_with_retries(lambda: _load_akshare().fund_etf_scale_sse(compact))
    result: dict[str, dict] = {}
    for record in _records(frame):
        code = _normal_code(record.get("基金代码"))
        shares = _finite_float(record.get("基金份额"))
        shares_date = _normal_date(record.get("统计日期"))
        if code is not None and shares is not None and shares_date is not None:
            result[code] = {"shares": shares, "sharesDate": shares_date}
    return result


def fetch_szse_latest_shares() -> dict[str, dict]:
    """Use akshare.fund_etf_scale_szse(); return code -> {shares, sharesDate}."""
    frame = _call_with_retries(lambda: _load_akshare().fund_etf_scale_szse())
    result: dict[str, dict] = {}
    for record in _records(frame):
        code = _normal_code(record.get("基金代码"))
        shares = _finite_float(record.get("基金份额"))
        if code is not None and shares is not None:
            # The SZSE workbook exposes no observation date. Fetch time is not
            # an authoritative share date, so retain the value only as a baseline.
            # Honor a date if a newer AkShare/source schema begins exposing one.
            shares_date = _normal_date(
                record.get("统计日期") or record.get("数据日期") or record.get("日期")
            )
            result[code] = {"shares": shares, "sharesDate": shares_date}
    return result


def fetch_nav(code: str, start_date: str, end_date: str) -> dict[str, dict]:
    """Use akshare.fund_etf_fund_info_em; return date -> {nav, navDate}."""
    frame = _call_with_retries(
        lambda: _load_akshare().fund_etf_fund_info_em(
            fund=code,
            start_date=_compact_date(start_date),
            end_date=_compact_date(end_date),
        )
    )
    result: dict[str, dict] = {}
    for record in _records(frame):
        nav_date = _normal_date(record.get("净值日期"))
        nav = _finite_float(record.get("单位净值"))
        if nav_date is not None and nav is not None:
            result[nav_date] = {"nav": nav, "navDate": nav_date}
    return result


def fetch_market_history(code: str, start_date: str, end_date: str) -> dict[str, dict]:
    """Use akshare.fund_etf_hist_em; return date -> {close, changePercent, turnover}."""
    frame = _call_with_retries(
        lambda: _load_akshare().fund_etf_hist_em(
            symbol=code,
            period="daily",
            start_date=_compact_date(start_date),
            end_date=_compact_date(end_date),
            adjust="",
        )
    )
    result: dict[str, dict] = {}
    for record in _records(frame):
        market_date = _normal_date(record.get("日期"))
        if market_date is None:
            continue
        result[market_date] = {
            "close": _finite_float(record.get("收盘")),
            "changePercent": _finite_float(record.get("涨跌幅")),
            "turnover": _finite_float(record.get("成交额")),
        }
    return result


def compute_net_subscription(
    current_shares: float | None,
    previous_shares: float | None,
    nav: float | None,
) -> float | None:
    current = _finite_float(current_shares)
    previous = _finite_float(previous_shares)
    current_nav = _finite_float(nav)
    if current is None or previous is None or current_nav is None:
        return None
    result = (current - previous) * current_nav
    return result if math.isfinite(result) else None


def classify_flow(change_pct: float | None, net_subscription: float | None) -> str:
    change = _finite_float(change_pct)
    flow = _finite_float(net_subscription)
    if change is None or flow is None:
        return "待确认"
    if flow >= 0:
        return "资金强化" if change >= 0 else "逆势承接"
    return "上涨兑现" if change >= 0 else "资金撤退"


def _dated_history(history: list[dict], current_date: str) -> list[dict]:
    by_date: dict[str, dict] = {}
    for row in history:
        row_date = _normal_date(row.get("date"))
        if row_date is not None and row_date < current_date:
            normalized = dict(row)
            normalized["date"] = row_date
            by_date[row_date] = normalized
    return [by_date[key] for key in sorted(by_date)]


def _complete_flow_window(
    rows: list[dict], size: int, expected_dates: list[str]
) -> tuple[int, list[float] | None]:
    window = rows[-size:]
    if expected_dates:
        expected = expected_dates[-min(len(window), size, len(expected_dates)) :]
        actual = [row["date"] for row in window[-len(expected) :]]
        if actual != expected:
            return len(window), None
    values: list[float] = []
    for row in window:
        value = _finite_float(row.get("netSubscription1d"))
        if row.get("status") != "confirmed" or value is None:
            return len(window), None
        values.append(value)
    return len(window), values


def _compound_percent(values: list[float]) -> float:
    factor = 1.0
    for value in values:
        factor *= 1.0 + value / 100.0
    return (factor - 1.0) * 100.0


def build_row(
    config: dict,
    current: dict,
    previous: dict | None,
    history: list[dict],
    benchmark_returns: dict[str, float],
) -> dict:
    requested_date = _normal_date(current.get("date"))
    if requested_date is None:
        raise ValueError("current row requires a valid date")
    expected_previous_date = _normal_date(current.get("previousDate"))
    shares = _finite_float(current.get("shares"))
    shares_date = _normal_date(current.get("sharesDate"))
    nav = _finite_float(current.get("nav"))
    nav_date = _normal_date(current.get("navDate"))
    market_date = _normal_date(current.get("marketDate"))
    close = _finite_float(current.get("close"))
    change_percent = _finite_float(current.get("changePercent"))
    turnover = _finite_float(current.get("turnover"))

    previous_shares = _finite_float(previous.get("shares")) if previous else None
    previous_shares_date = (
        _normal_date(previous.get("sharesDate") or previous.get("date")) if previous else None
    )
    previous_aligned = previous_shares_date is not None and previous_shares_date < requested_date
    if expected_previous_date is not None:
        previous_aligned = previous_shares_date == expected_previous_date

    current_values_aligned = shares_date == requested_date and nav_date == requested_date
    market_aligned = market_date == requested_date
    confirmed = (
        current_values_aligned
        and market_aligned
        and previous_aligned
        and shares is not None
        and previous_shares is not None
        and nav is not None
    )

    share_change = shares - previous_shares if confirmed else None
    net_subscription = compute_net_subscription(shares, previous_shares, nav) if confirmed else None
    scale = shares * nav if current_values_aligned and shares is not None and nav is not None else None
    if scale is not None and not math.isfinite(scale):
        scale = None

    dated_history = _dated_history(history, requested_date)
    current_window_row = {
        "date": requested_date,
        "status": "confirmed" if confirmed else "pending",
        "netSubscription1d": net_subscription,
        "changePercent": change_percent,
        "turnover": turnover,
    }
    window_rows = dated_history + [current_window_row]
    expected_dates = sorted(
        normalized
        for key in benchmark_returns
        if (normalized := _normal_date(key)) is not None and normalized <= requested_date
    )
    window_days_5d, flow_values_5d = _complete_flow_window(window_rows, 5, expected_dates)
    window_days_20d, flow_values_20d = _complete_flow_window(window_rows, 20, expected_dates)
    net_5d = sum(flow_values_5d) if flow_values_5d is not None else None
    net_20d = sum(flow_values_20d) if flow_values_20d is not None else None
    positive_days = (
        sum(value > 0 for value in flow_values_5d) if flow_values_5d is not None else None
    )

    persistence = None
    if window_days_5d == 5 and flow_values_5d is not None:
        if net_5d is not None and net_5d > 0 and positive_days is not None and positive_days >= 3:
            persistence = "持续流入"
        elif net_5d is not None and net_5d < 0 and sum(value < 0 for value in flow_values_5d) >= 3:
            persistence = "持续流出"

    market_window = window_rows[-5:]
    market_window_aligned = len(market_window) == 5
    if market_window_aligned and expected_dates:
        market_window_aligned = [row["date"] for row in market_window] == expected_dates[-5:]
    turnover_vs_5d = None
    excess_return_5d = None
    if market_window_aligned:
        turnovers = [_finite_float(row.get("turnover")) for row in market_window]
        if all(value is not None for value in turnovers) and turnover is not None:
            mean_turnover = sum(value for value in turnovers if value is not None) / 5
            if mean_turnover > 0:
                turnover_vs_5d = round(turnover / mean_turnover, 4)

        etf_returns = [_finite_float(row.get("changePercent")) for row in market_window]
        normalized_benchmark = {
            _normal_date(key): _finite_float(value) for key, value in benchmark_returns.items()
        }
        benchmark_values = [normalized_benchmark.get(row["date"]) for row in market_window]
        if all(value is not None for value in etf_returns + benchmark_values):
            etf_compound = _compound_percent([value for value in etf_returns if value is not None])
            benchmark_compound = _compound_percent(
                [value for value in benchmark_values if value is not None]
            )
            excess_return_5d = round(etf_compound - benchmark_compound, 4)

    return {
        "code": str(config["code"]),
        "name": str(config["name"]),
        "scope": str(config["scope"]),
        "category": str(config["category"]),
        "direction": str(config["direction"]),
        "exchange": str(config["exchange"]),
        "date": requested_date,
        "status": "confirmed" if confirmed else "pending",
        "shares": shares,
        "sharesDate": shares_date,
        "previousShares": previous_shares if previous_aligned else None,
        "previousSharesDate": previous_shares_date if previous_aligned else None,
        "shareChange": share_change,
        "nav": nav,
        "navDate": nav_date,
        "scale": scale,
        "close": close,
        "marketDate": market_date,
        "changePercent": change_percent,
        "turnover": turnover,
        "turnoverVs5d": turnover_vs_5d,
        "netSubscription1d": net_subscription,
        "netSubscription5d": net_5d,
        "netSubscription20d": net_20d,
        "windowDays5d": window_days_5d,
        "windowDays20d": window_days_20d,
        "excessReturn5d": excess_return_5d,
        "positiveFlowDays5d": positive_days,
        "flowLabel": classify_flow(change_percent, net_subscription),
        "persistenceLabel": persistence,
        "stockBreadth": None,
        "breadthConfirmed": False,
        "mainlineCandidate": False,
    }


def _get_provider(providers: Mapping[str, Callable] | Any | None, name: str) -> Callable:
    if providers is None:
        return globals()[name]
    if isinstance(providers, Mapping):
        return providers[name]
    return getattr(providers, name)


def _lookup_dated(mapping: Mapping[Any, dict], target_date: str) -> dict:
    for key, value in mapping.items():
        if _normal_date(key) == target_date:
            return value if isinstance(value, dict) else {}
    return {}


def _normalize_share_record(record: dict | None) -> dict:
    record = record or {}
    return {
        "shares": _finite_float(record.get("shares")),
        "sharesDate": _normal_date(record.get("sharesDate")),
    }


def _history_by_code(history: list[dict], target_date: str) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    for item in history:
        if "etfs" in item:
            rows = item.get("etfs") or []
            snapshot_date = _normal_date(item.get("date"))
        else:
            rows = [item]
            snapshot_date = _normal_date(item.get("date"))
        if snapshot_date is None or snapshot_date >= target_date:
            continue
        for row in rows:
            if not isinstance(row, dict) or row.get("code") is None:
                continue
            normalized = dict(row)
            normalized["date"] = _normal_date(row.get("date")) or snapshot_date
            code = str(row["code"])
            result.setdefault(code, []).append(normalized)
    for rows in result.values():
        rows.sort(key=lambda row: row["date"])
    return result


def _board_breadth(
    code: str,
    target_date: str,
    mappings: Mapping[str, list[str]],
    custom_boards: dict | None,
) -> tuple[float | None, bool]:
    mapped_codes = mappings.get(code) or []
    if not mapped_codes or not custom_boards:
        return None, False
    if _normal_date(custom_boards.get("date")) != target_date:
        return None, False
    board_index = {
        str(board.get("code")): board
        for board in custom_boards.get("boards", [])
        if isinstance(board, dict) and board.get("code") is not None
    }
    breadths: list[float] = []
    for board_code in mapped_codes:
        board = board_index.get(str(board_code))
        if board is None:
            continue
        changes = [
            _finite_float(stock.get("latestChangePercent"))
            for stock in board.get("stocks", [])
            if isinstance(stock, dict) and _normal_date(stock.get("latestDate")) == target_date
        ]
        available = [change for change in changes if change is not None]
        if available:
            breadths.append(sum(change > 0 for change in available) / len(available))
    if not breadths:
        return None, False
    return round(sum(breadths) / len(breadths), 4), True


def _summary(rows: list[dict]) -> dict:
    confirmed = [row for row in rows if row.get("status") == "confirmed"]
    flows = [
        value
        for row in confirmed
        if (value := _finite_float(row.get("netSubscription1d"))) is not None
    ]
    return {
        "count": len(rows),
        "confirmedCount": len(confirmed),
        "pendingCount": len(rows) - len(confirmed),
        "netSubscription1d": sum(flows) if flows else None,
    }


def build_snapshot(
    date: str,
    config: dict,
    *,
    history: list[dict] | None = None,
    custom_boards: dict | None = None,
    providers: Mapping[str, Callable] | Any | None = None,
) -> dict:
    target_date = _normal_date(date)
    if target_date is None:
        raise ValueError(f"invalid snapshot date: {date!r}")
    target_compact = target_date.replace("-", "")
    history_by_code = _history_by_code(history or [], target_date)
    errors: list[dict] = []
    etf_configs = config.get("etfs", [])
    start_compact = (datetime.strptime(target_compact, "%Y%m%d") - timedelta(days=60)).strftime(
        "%Y%m%d"
    )

    market_by_code: dict[str, dict] = {}
    for etf in etf_configs:
        code = str(etf["code"])
        try:
            market_by_code[code] = _get_provider(providers, "fetch_market_history")(
                code, start_compact, target_compact
            )
            if not _lookup_dated(market_by_code[code], target_date):
                errors.append(
                    {
                        "code": code,
                        "source": "missing",
                        "message": f"market observation missing for {target_date}",
                    }
                )
        except Exception as error:
            market_by_code[code] = {}
            errors.append({"code": code, "source": "market", "message": str(error)})

    benchmark_code = str(config.get("benchmarkCode", "510300"))
    benchmark_market = market_by_code.get(benchmark_code, {})
    benchmark_returns = {
        normalized: change
        for key, record in benchmark_market.items()
        if (normalized := _normal_date(key)) is not None
        and (change := _finite_float(record.get("changePercent"))) is not None
    }
    calendar_markets = [benchmark_market] if benchmark_market else list(market_by_code.values())
    trading_dates = sorted(
        normalized
        for market in calendar_markets
        for key in market
        if (normalized := _normal_date(key)) is not None and normalized <= target_date
    )
    prior_dates = [value for value in set(trading_dates) if value < target_date]
    previous_date = max(prior_dates) if prior_dates else None

    current_sse: dict[str, dict] = {}
    previous_sse: dict[str, dict] = {}
    current_szse: dict[str, dict] = {}
    if any(etf.get("exchange") == "SSE" for etf in etf_configs):
        try:
            current_sse = _get_provider(providers, "fetch_sse_shares")(target_compact)
        except Exception as error:
            errors.append({"code": None, "source": "sseShares", "message": str(error)})
        if previous_date is not None:
            try:
                previous_sse = _get_provider(providers, "fetch_sse_shares")(
                    previous_date.replace("-", "")
                )
            except Exception as error:
                errors.append({"code": None, "source": "ssePreviousShares", "message": str(error)})
    if any(etf.get("exchange") == "SZSE" for etf in etf_configs):
        try:
            current_szse = _get_provider(providers, "fetch_szse_latest_shares")()
        except Exception as error:
            errors.append({"code": None, "source": "szseShares", "message": str(error)})

    rows: list[dict] = []
    mappings = config.get("boardMappings", {})
    for etf in etf_configs:
        code = str(etf["code"])
        market = market_by_code.get(code, {})
        market_today = _lookup_dated(market, target_date)
        try:
            nav_history = _get_provider(providers, "fetch_nav")(
                code, start_compact, target_compact
            )
            nav_today = _lookup_dated(nav_history, target_date)
            if (
                _finite_float(nav_today.get("nav")) is None
                or _normal_date(nav_today.get("navDate")) != target_date
            ):
                errors.append(
                    {
                        "code": code,
                        "source": "missing",
                        "message": f"authoritative NAV observation missing for {target_date}",
                    }
                )
        except Exception as error:
            nav_today = {}
            errors.append({"code": code, "source": "nav", "message": str(error)})

        share_source = current_sse if etf.get("exchange") == "SSE" else current_szse
        current_share = _normalize_share_record(share_source.get(code))
        if current_share["shares"] is None:
            errors.append(
                {"code": code, "source": "missing", "message": "current shares missing"}
            )
        elif current_share["sharesDate"] != target_date:
            errors.append(
                {
                    "code": code,
                    "source": "missing",
                    "message": f"authoritative current share date missing for {target_date}",
                }
            )
        prior_rows = history_by_code.get(code, [])
        archived_previous = next(
            (row for row in reversed(prior_rows) if _normal_date(row.get("date")) == previous_date),
            None,
        )
        if etf.get("exchange") == "SSE" and previous_date is not None:
            exchange_previous = _normalize_share_record(previous_sse.get(code))
            previous = exchange_previous if exchange_previous["shares"] is not None else archived_previous
        else:
            previous = archived_previous
        normalized_previous = _normalize_share_record(previous)
        observed_previous_date = (
            _normal_date(previous.get("sharesDate") or previous.get("date"))
            if previous
            else None
        )
        if etf.get("exchange") == "SSE" and previous_date is not None:
            if (
                normalized_previous["shares"] is None
                or observed_previous_date != previous_date
            ):
                errors.append(
                    {
                        "code": code,
                        "source": "missing",
                        "message": f"previous shares missing for {previous_date}",
                    }
                )
        elif etf.get("exchange") == "SZSE" and previous_date is not None and prior_rows:
            if (
                normalized_previous["shares"] is None
                or observed_previous_date != previous_date
            ):
                errors.append(
                    {
                        "code": code,
                        "source": "missing",
                        "message": f"archived previous shares missing for {previous_date}",
                    }
                )

        current = {
            "date": target_date,
            "previousDate": previous_date,
            **current_share,
            "nav": _finite_float(nav_today.get("nav")),
            "navDate": _normal_date(nav_today.get("navDate")),
            "close": _finite_float(market_today.get("close")),
            "changePercent": _finite_float(market_today.get("changePercent")),
            "turnover": _finite_float(market_today.get("turnover")),
            "marketDate": target_date if market_today else None,
        }
        row = build_row(etf, current, previous, prior_rows, benchmark_returns)
        breadth, breadth_confirmed = _board_breadth(
            code, target_date, mappings, custom_boards
        )
        row["stockBreadth"] = breadth
        row["breadthConfirmed"] = breadth_confirmed
        row["mainlineCandidate"] = bool(
            breadth_confirmed
            and breadth is not None
            and breadth >= 0.5
            and row["windowDays5d"] == 5
            and row["netSubscription1d"] is not None
            and row["netSubscription1d"] > 0
            and row["netSubscription5d"] is not None
            and row["netSubscription5d"] > 0
            and row["excessReturn5d"] is not None
            and row["excessReturn5d"] > 0
            and row["positiveFlowDays5d"] is not None
            and row["positiveFlowDays5d"] >= 3
            and row["turnoverVs5d"] is not None
            and row["turnoverVs5d"] >= 1
        )
        rows.append(row)

    broad_rows = [row for row in rows if row.get("scope") == "broad"]
    industry_rows = [row for row in rows if row.get("scope") == "industry"]
    confirmed_count = sum(row["status"] == "confirmed" for row in rows)
    return {
        "version": int(config.get("version", 1)),
        "date": target_date,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": (
            "confirmed"
            if rows and confirmed_count == len(rows)
            else "partial"
            if confirmed_count
            else "pending"
        ),
        "benchmarkCode": benchmark_code,
        "summary": {
            "all": _summary(rows),
            "broad": _summary(broad_rows),
            "industry": _summary(industry_rows),
        },
        "etfs": rows,
        "errors": errors,
    }


def _serialize_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def write_json_atomic(payload: Any, destination: str | Path) -> None:
    destination = Path(destination)
    serialized = _serialize_json(payload)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            prefix=f".{destination.name}.",
            suffix=".tmp",
            dir=destination.parent,
            delete=False,
        ) as temporary:
            temporary.write(serialized)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)
        os.replace(temporary_path, destination)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _load_history(directory: Path, target_date: str) -> list[dict]:
    snapshots: list[dict] = []
    if not directory.exists():
        return snapshots
    target_compact = target_date.replace("-", "")
    for path in sorted(directory.glob("????????.json")):
        if path.stem >= target_compact:
            continue
        try:
            snapshots.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return snapshots[-19:]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a confirmed ETF fund-flow snapshot")
    parser.add_argument("--date", required=True, help="Trading date in YYYYMMDD form")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--history-dir", type=Path, default=DEFAULT_HISTORY_DIR)
    args = parser.parse_args(argv)

    target_date = _normal_date(args.date)
    if target_date is None:
        parser.error("--date must be YYYYMMDD")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    custom_boards = None
    if DEFAULT_CUSTOM_BOARDS.exists():
        custom_boards = json.loads(DEFAULT_CUSTOM_BOARDS.read_text(encoding="utf-8"))
    history = _load_history(args.history_dir, target_date)
    snapshot = build_snapshot(
        target_date,
        config,
        history=history,
        custom_boards=custom_boards,
    )
    if snapshot["errors"] and snapshot["summary"]["all"]["confirmedCount"] == 0:
        raise RuntimeError("ETF refresh failed: every row is pending; previous latest file preserved")

    # Validate serialization before creating either destination.
    _serialize_json(snapshot)
    history_path = args.history_dir / f"{target_date.replace('-', '')}.json"
    write_json_atomic(snapshot, history_path)
    write_json_atomic(snapshot, args.out)
    print(
        f"ETF snapshot {target_date}: "
        f"{snapshot['summary']['all']['confirmedCount']}/{snapshot['summary']['all']['count']} confirmed"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
