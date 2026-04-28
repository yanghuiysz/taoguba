from __future__ import annotations

import argparse
import json
import math
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import urlopen

import akshare as ak


CONFIG_PATH = Path("web/data/custom_boards_config.json")
OUT_PATH = Path("web/data/custom_boards.json")
CACHE_DIR = Path("data/custom_stock_history")
HIGH100_WINDOW = 100
MARKET_INDEX_SYMBOL = "sh000001"
MARKET_INDEX_NAME = "上证指数"


def compact_date(value: str) -> str:
    return value.replace("-", "")


def format_date(value: str) -> str:
    text = str(value)
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return text


def normalize_stock_code(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) > 6:
        digits = digits[-6:]
    return digits.zfill(6) if digits else ""


def number_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def sanitize_json_value(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, list):
        return [sanitize_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_json_value(item) for key, item in value.items()}
    return value


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"boards": []}
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_stock_history(code: str, end_date: str, lookback_days: int) -> list[dict[str, Any]]:
    start_date = (datetime.strptime(end_date, "%Y%m%d") - timedelta(days=lookback_days)).strftime("%Y%m%d")
    try:
        df = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start_date, end_date=end_date, adjust="")
        return normalize_eastmoney_history(code, df)
    except Exception:
        prefixed = f"sh{code}" if code.startswith(("6", "9")) else f"sz{code}"
        df = ak.stock_zh_a_hist_tx(symbol=prefixed, start_date=start_date, end_date=end_date, adjust="")
        return normalize_price_history(code, df)


def cache_path(cache_dir: Path, code: str, end_date: str, lookback_days: int) -> Path:
    return cache_dir / f"{end_date}_{lookback_days}" / f"{code}.json"


def load_cached_history(cache_dir: Path, code: str, end_date: str, lookback_days: int) -> list[dict[str, Any]] | None:
    path = cache_path(cache_dir, code, end_date, lookback_days)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, list) else None


def write_cached_history(cache_dir: Path, code: str, end_date: str, lookback_days: int, rows: list[dict[str, Any]]) -> None:
    path = cache_path(cache_dir, code, end_date, lookback_days)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_eastmoney_history(code: str, df: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        volume = number_or_none(row.get("成交量"))
        turnover = number_or_none(row.get("成交额"))
        rows.append(
            {
                "date": format_date(str(row.get("日期", ""))),
                "code": normalize_stock_code(row.get("股票代码", code)),
                "open": number_or_none(row.get("开盘")),
                "close": number_or_none(row.get("收盘")),
                "high": number_or_none(row.get("最高")),
                "low": number_or_none(row.get("最低")),
                "changePercent": number_or_none(row.get("涨跌幅")),
                "volume": volume,
                "turnover": turnover,
                "amount": turnover,
                "turnoverRate": number_or_none(row.get("换手率")),
            }
        )
    return rows


def normalize_price_history(code: str, df: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    previous_close: float | None = None
    for _, row in df.iterrows():
        close = number_or_none(row.get("close"))
        volume_lots = number_or_none(row.get("amount"))
        volume = round(volume_lots * 100, 2) if volume_lots is not None else None
        turnover = round(volume_lots * close * 100, 2) if volume_lots is not None and close is not None else None
        change_percent = None
        if close is not None and previous_close not in (None, 0):
            change_percent = round((close - previous_close) / previous_close * 100, 4)
        rows.append(
            {
                "date": format_date(str(row.get("date", ""))),
                "code": code,
                "open": number_or_none(row.get("open")),
                "close": close,
                "high": number_or_none(row.get("high")),
                "low": number_or_none(row.get("low")),
                "changePercent": change_percent,
                "volume": volume,
                "turnover": turnover,
                "amount": turnover,
                "turnoverRate": None,
            }
        )
        if close is not None:
            previous_close = close
    return rows


def first_present(row: Any, names: tuple[str, ...], index: int | None = None) -> Any:
    for name in names:
        if name in row:
            return row.get(name)
    if index is not None:
        try:
            return row.iloc[index]
        except (AttributeError, IndexError):
            return None
    return None


def normalize_spot_rows(df: Any, codes: set[str], date: str) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        code = normalize_stock_code(first_present(row, ("代码", "code", "f12"), 1))
        if code not in codes:
            continue
        close = number_or_none(first_present(row, ("最新价", "最新", "latest", "latestPrice", "f2"), 2))
        change_percent = number_or_none(first_present(row, ("涨跌幅", "changePercent", "f3"), 3))
        open_price = number_or_none(first_present(row, ("今开", "open", "f17"), 11))
        previous_close = number_or_none(first_present(row, ("昨收", "previousClose", "f18"), 12))
        if change_percent is None and close is not None and previous_close not in (None, 0):
            change_percent = round((close - previous_close) / previous_close * 100, 4)
        volume = number_or_none(first_present(row, ("成交量", "volume", "f5"), 6))
        turnover = number_or_none(first_present(row, ("成交额", "amount", "f6"), 7))
        rows[code] = {
            "date": format_date(date),
            "code": code,
            "open": open_price,
            "close": close,
            "high": number_or_none(first_present(row, ("最高", "high", "f15"), 9)),
            "low": number_or_none(first_present(row, ("最低", "low", "f16"), 10)),
            "changePercent": change_percent,
            "volume": volume,
            "turnover": turnover,
            "amount": turnover,
            "turnoverRate": number_or_none(first_present(row, ("换手率", "turnoverRate", "f8"), 14)),
            "source": "intraday_spot",
        }
    return rows


def normalize_sina_spot_rows(df: Any, codes: set[str], date: str) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        code = normalize_stock_code(row.iloc[0])
        if code not in codes:
            continue
        volume = number_or_none(row.iloc[11]) if len(row) > 11 else None
        turnover = number_or_none(row.iloc[12]) if len(row) > 12 else None
        rows[code] = {
            "date": format_date(date),
            "code": code,
            "name": str(row.iloc[1]) if len(row) > 1 else code,
            "open": number_or_none(row.iloc[8]) if len(row) > 8 else None,
            "close": number_or_none(row.iloc[2]) if len(row) > 2 else None,
            "high": number_or_none(row.iloc[9]) if len(row) > 9 else None,
            "low": number_or_none(row.iloc[10]) if len(row) > 10 else None,
            "changePercent": number_or_none(row.iloc[4]) if len(row) > 4 else None,
            "volume": volume,
            "turnover": turnover,
            "amount": turnover,
            "turnoverRate": None,
            "source": "intraday_spot_sina",
            "timestamp": str(row.iloc[13]) if len(row) > 13 else "",
        }
    return rows


def normalize_tencent_spot_payload(text: str, codes: set[str], date: str) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for raw_line in text.split(";"):
        line = raw_line.strip()
        if not line or "=" not in line:
            continue
        _, payload = line.split("=", 1)
        payload = payload.strip().strip('"')
        if not payload:
            continue
        parts = payload.split("~")
        code = normalize_stock_code(parts[2] if len(parts) > 2 else "")
        if code not in codes:
            continue
        close = number_or_none(parts[3] if len(parts) > 3 else None)
        prev_close = number_or_none(parts[4] if len(parts) > 4 else None)
        open_price = number_or_none(parts[5] if len(parts) > 5 else None)
        change_percent = number_or_none(parts[32] if len(parts) > 32 else None)
        high = number_or_none(parts[33] if len(parts) > 33 else None)
        low = number_or_none(parts[34] if len(parts) > 34 else None)
        volume = None
        turnover = None
        if len(parts) > 35 and parts[35]:
            snapshot = parts[35].split("/")
            if len(snapshot) >= 2:
                lots = number_or_none(snapshot[1])
                volume = round(lots * 100, 2) if lots is not None else None
            if len(snapshot) >= 3:
                turnover = number_or_none(snapshot[2])
        if turnover is None and len(parts) > 57:
            amount_wan = number_or_none(parts[57])
            turnover = round(amount_wan * 10000, 2) if amount_wan is not None else None
        rows[code] = {
            "date": format_date(date),
            "code": code,
            "name": parts[1] if len(parts) > 1 else code,
            "open": open_price,
            "close": close,
            "high": high,
            "low": low,
            "changePercent": change_percent,
            "volume": volume,
            "turnover": turnover,
            "amount": turnover,
            "turnoverRate": number_or_none(parts[38] if len(parts) > 38 else None),
            "source": "intraday_spot_tencent",
            "previousClose": prev_close,
            "timestamp": parts[30] if len(parts) > 30 else "",
        }
    return rows


def fetch_tencent_spot(codes: set[str], date: str, batch_size: int = 60) -> dict[str, dict[str, Any]]:
    prefixed = [
        ("sh" if code.startswith(("6", "9")) else "sz") + code
        for code in sorted(codes)
    ]
    rows: dict[str, dict[str, Any]] = {}
    for start in range(0, len(prefixed), batch_size):
        batch = prefixed[start:start + batch_size]
        url = f"https://qt.gtimg.cn/q={quote(','.join(batch))}"
        with urlopen(url, timeout=15) as response:
            payload = response.read().decode("gbk", errors="replace")
        rows.update(normalize_tencent_spot_payload(payload, codes, date))
    return rows


def fetch_intraday_spot(codes: set[str], date: str) -> dict[str, dict[str, Any]]:
    try:
        df = ak.stock_zh_a_spot_em()
        rows = normalize_spot_rows(df, codes, date)
        if rows:
            return rows
    except Exception as exc:  # noqa: BLE001 - fall back to Sina realtime quotes.
        print(f"Eastmoney spot failed, falling back to Sina spot: {exc}")
    try:
        df = ak.stock_zh_a_spot()
        rows = normalize_sina_spot_rows(df, codes, date)
        if rows:
            return rows
    except Exception as exc:  # noqa: BLE001 - use Tencent batched quotes as a final fallback.
        print(f"Sina spot failed, falling back to Tencent spot: {exc}")
    return fetch_tencent_spot(codes, date)


def merge_intraday_rows(
    stock_histories: dict[str, list[dict[str, Any]]],
    spot_rows: dict[str, dict[str, Any]],
    date: str,
) -> None:
    formatted_date = format_date(date)
    for code, spot_row in spot_rows.items():
        rows = stock_histories.setdefault(code, [])
        rows[:] = [row for row in rows if row.get("date") != formatted_date]
        rows.append(spot_row)
        rows.sort(key=lambda row: str(row.get("date") or ""))


def normalize_market_index_spot_row(row: Any, symbol: str, date: str) -> dict[str, Any] | None:
    code = str(first_present(row, ("代码", "code", "f12"), 0) or "").lower()
    if code != symbol.lower():
        return None
    turnover = number_or_none(first_present(row, ("成交额", "amount", "f6"), 10))
    return {
        "date": format_date(date),
        "open": number_or_none(first_present(row, ("今开", "open", "f17"), 6)),
        "close": number_or_none(first_present(row, ("最新价", "最新", "latest", "f2"), 2)),
        "high": number_or_none(first_present(row, ("最高", "high", "f15"), 7)),
        "low": number_or_none(first_present(row, ("最低", "low", "f16"), 8)),
        "changePercent": number_or_none(first_present(row, ("涨跌幅", "changePercent", "f3"), 4)),
        "volume": number_or_none(first_present(row, ("成交量", "volume", "f5"), 9)),
        "turnover": turnover,
        "amount": turnover,
        "source": "intraday_index_spot",
    }


def normalize_tencent_market_index_payload(text: str, symbol: str, date: str) -> dict[str, Any] | None:
    payload = text.strip()
    if "=" not in payload:
        return None
    _, raw_value = payload.split("=", 1)
    parts = raw_value.strip().strip('";').split("~")
    code = f"sh{parts[2]}" if len(parts) > 2 else ""
    if code.lower() != symbol.lower():
        return None
    turnover = None
    volume = None
    if len(parts) > 35 and parts[35]:
        snapshot = parts[35].split("/")
        if len(snapshot) >= 2:
            volume = number_or_none(snapshot[1])
        if len(snapshot) >= 3:
            turnover = number_or_none(snapshot[2])
    return {
        "date": format_date(date),
        "open": number_or_none(parts[5] if len(parts) > 5 else None),
        "close": number_or_none(parts[3] if len(parts) > 3 else None),
        "high": number_or_none(parts[33] if len(parts) > 33 else None),
        "low": number_or_none(parts[34] if len(parts) > 34 else None),
        "changePercent": number_or_none(parts[32] if len(parts) > 32 else None),
        "volume": volume,
        "turnover": turnover,
        "amount": turnover,
        "source": "intraday_index_spot_tencent",
        "timestamp": parts[30] if len(parts) > 30 else "",
    }


def fetch_market_index_intraday(symbol: str, date: str) -> dict[str, Any] | None:
    for source_name in ("stock_zh_index_spot_em", "stock_zh_index_spot_sina"):
        try:
            df = getattr(ak, source_name)()
            for _, row in df.iterrows():
                item = normalize_market_index_spot_row(row, symbol, date)
                if item:
                    item["source"] = f"intraday_index_{source_name}"
                    return item
        except Exception as exc:  # noqa: BLE001 - fall through to the next public quote source.
            print(f"{source_name} failed for market index overlay: {exc}")
    url = f"https://qt.gtimg.cn/q={quote(symbol)}"
    with urlopen(url, timeout=15) as response:
        payload = response.read().decode("gbk", errors="replace")
    return normalize_tencent_market_index_payload(payload, symbol, date)


def merge_market_index_intraday(rows: list[dict[str, Any]], spot_row: dict[str, Any] | None, date: str) -> None:
    if not spot_row:
        return
    formatted_date = format_date(date)
    rows[:] = [row for row in rows if row.get("date") != formatted_date]
    rows.append(spot_row)
    rows.sort(key=lambda row: str(row.get("date") or ""))


def latest_trading_dates(stock_histories: dict[str, list[dict[str, Any]]], days: int) -> list[str]:
    dates = {
        row["date"]
        for rows in stock_histories.values()
        for row in rows
        if row.get("date") and row.get("changePercent") is not None
    }
    return sorted(dates)[-days:]


def sort_change_value(value: Any) -> float:
    number = number_or_none(value)
    return number if number is not None else -999999.0


def round_or_none(value: float | None, digits: int = 4) -> float | None:
    return round(value, digits) if value is not None else None


def enrich_high100_metrics(rows: list[dict[str, Any]], window: int = HIGH100_WINDOW) -> None:
    ordered = sorted(rows, key=lambda row: str(row.get("date") or ""))
    valid_rows: list[dict[str, Any]] = []
    for row in ordered:
        close = number_or_none(row.get("close"))
        high = number_or_none(row.get("high"))
        low = number_or_none(row.get("low"))
        if close is None or high is None or low is None:
            continue
        valid_rows.append(row)
        recent = valid_rows[-window:]
        if len(recent) < window:
            row["high100"] = None
            row["low100"] = None
            row["isHigh100"] = None
            row["distanceToHigh100"] = None
            row["isNearHigh100"] = None
            row["position100"] = None
            row["highStatus"] = None
            continue
        high100 = max(float(item["high"]) for item in recent)
        low100 = min(float(item["low"]) for item in recent)
        distance = (close - high100) / high100 * 100 if high100 else None
        position = 1.0 if high100 == low100 else (close - low100) / (high100 - low100)
        is_high = close >= high100
        is_near = close >= high100 * 0.97
        row["high100"] = round(high100, 4)
        row["low100"] = round(low100, 4)
        row["isHigh100"] = is_high
        row["distanceToHigh100"] = round_or_none(distance, 4)
        row["isNearHigh100"] = is_near
        row["position100"] = round(position, 4)
        if is_high:
            row["highStatus"] = "百日新高"
        elif is_near:
            row["highStatus"] = "近高位"
        elif distance is not None and distance >= -8:
            row["highStatus"] = "高位震荡"
        else:
            row["highStatus"] = "距离较远"


def row_volume(row: dict[str, Any] | None) -> float | None:
    if not row:
        return None
    volume = number_or_none(row.get("volume"))
    if volume is not None:
        return volume
    legacy_amount = number_or_none(row.get("amount"))
    if legacy_amount is None:
        return None
    return round(legacy_amount * 100, 2)


def row_turnover(row: dict[str, Any] | None) -> float | None:
    if not row:
        return None
    turnover = number_or_none(row.get("turnover"))
    if turnover is not None:
        return turnover
    close = number_or_none(row.get("close"))
    legacy_amount = number_or_none(row.get("amount"))
    if legacy_amount is not None and close is not None:
        return round(legacy_amount * close * 100, 2)
    return legacy_amount


def volume_price_state(change: Any, current_turnover: Any, previous_turnover: Any) -> dict[str, Any]:
    parsed_change = number_or_none(change)
    current = number_or_none(current_turnover)
    previous = number_or_none(previous_turnover)
    if parsed_change is None or current is None or previous in (None, 0):
        return {
            "label": None,
            "priceDirection": None,
            "amountDirection": None,
        }
    price_direction = "rise" if parsed_change >= 0 else "fall"
    amount_direction = "expand" if current >= previous else "contract"
    labels = {
        ("rise", "expand"): "放量上涨",
        ("rise", "contract"): "缩量上涨",
        ("fall", "expand"): "放量下跌",
        ("fall", "contract"): "缩量下跌",
    }
    return {
        "label": labels[(price_direction, amount_direction)],
        "priceDirection": price_direction,
        "amountDirection": amount_direction,
    }


def fetch_market_index_history(symbol: str, end_date: str, lookback_days: int) -> list[dict[str, Any]]:
    start_date = (datetime.strptime(end_date, "%Y%m%d") - timedelta(days=lookback_days + 20)).strftime("%Y%m%d")
    df = ak.stock_zh_index_daily(symbol=symbol)
    rows: list[dict[str, Any]] = []
    previous_close: float | None = None
    for _, row in df.iterrows():
        date = format_date(str(row.get("date", "")))
        compact = compact_date(date)
        close = number_or_none(row.get("close"))
        change_percent = None
        if close is not None and previous_close not in (None, 0):
            change_percent = round((close - previous_close) / previous_close * 100, 4)
        item = {
            "date": date,
            "open": number_or_none(row.get("open")),
            "close": close,
            "high": number_or_none(row.get("high")),
            "low": number_or_none(row.get("low")),
            "changePercent": change_percent,
            "volume": number_or_none(row.get("volume")),
            "turnover": None,
            "amount": None,
        }
        if start_date <= compact <= end_date:
            rows.append(item)
        if close is not None:
            previous_close = close
    return rows


def build_market_index(rows: list[dict[str, Any]], dates: list[str]) -> dict[str, Any]:
    rows_by_date = {str(row.get("date")): row for row in rows if row.get("date")}
    trend: list[dict[str, Any]] = []
    previous_volume: float | None = None
    for date in dates:
        row = rows_by_date.get(date)
        if not row:
            continue
        item = {
            "date": date,
            "open": row.get("open"),
            "close": row.get("close"),
            "high": row.get("high"),
            "low": row.get("low"),
            "changePercent": row.get("changePercent"),
            "volume": row.get("volume"),
            "turnover": row.get("turnover"),
            "amount": row.get("amount"),
        }
        item.update(volume_price_state(item.get("changePercent"), item.get("volume"), previous_volume))
        trend.append(item)
        volume = number_or_none(item.get("volume"))
        if volume is not None:
            previous_volume = volume

    latest = trend[-1] if trend else None
    return {
        "code": MARKET_INDEX_SYMBOL,
        "name": MARKET_INDEX_NAME,
        "trend": trend,
        "latestDate": latest.get("date") if latest else None,
        "latestClose": latest.get("close") if latest else None,
        "latestChangePercent": latest.get("changePercent") if latest else None,
        "latestVolume": latest.get("volume") if latest else None,
        "latestState": latest.get("label") if latest else None,
    }


def build_board(board: dict[str, Any], stock_histories: dict[str, list[dict[str, Any]]], dates: list[str]) -> dict[str, Any]:
    stocks = []
    stock_rows_by_code: dict[str, dict[str, dict[str, Any]]] = {}
    for item in board.get("stocks", []):
        code = normalize_stock_code(item.get("code"))
        if not code:
            continue
        rows = stock_histories.get(code, [])
        enrich_high100_metrics(rows)
        stock_rows_by_code[code] = {row["date"]: row for row in rows}
        latest = next((row for row in reversed(rows) if row.get("changePercent") is not None), None)
        stocks.append(
            {
                "code": code,
                "name": item.get("name") or code,
                "latestDate": latest.get("date") if latest else None,
                "latestClose": latest.get("close") if latest else None,
                "latestChangePercent": latest.get("changePercent") if latest else None,
                "latestVolume": row_volume(latest),
                "latestTurnover": row_turnover(latest),
                "latestAmount": row_turnover(latest),
                "latestHigh100": latest.get("high100") if latest else None,
                "latestLow100": latest.get("low100") if latest else None,
                "latestIsHigh100": latest.get("isHigh100") if latest else None,
                "latestDistanceToHigh100": latest.get("distanceToHigh100") if latest else None,
                "latestIsNearHigh100": latest.get("isNearHigh100") if latest else None,
                "latestPosition100": latest.get("position100") if latest else None,
                "latestHighStatus": latest.get("highStatus") if latest else None,
                "availableDays": sum(1 for row in rows if row.get("date") in dates and row.get("changePercent") is not None),
            }
        )

    trend = []
    for date in dates:
        daily_stocks = []
        values = []
        volumes = []
        turnovers = []
        high_metrics = []
        for stock in stocks:
            row = stock_rows_by_code.get(stock["code"], {}).get(date)
            change = row.get("changePercent") if row else None
            if change is not None:
                values.append(float(change))
            volume = row_volume(row)
            turnover = row_turnover(row)
            if volume is not None:
                volumes.append(float(volume))
            if turnover is not None:
                turnovers.append(float(turnover))
            if row and row.get("high100") is not None and row.get("distanceToHigh100") is not None and row.get("position100") is not None:
                high_metrics.append(row)
            daily_stocks.append(
                {
                    "code": stock["code"],
                    "name": stock["name"],
                    "changePercent": change,
                    "close": row.get("close") if row else None,
                    "volume": volume,
                    "turnover": turnover,
                    "amount": turnover,
                    "high100": row.get("high100") if row else None,
                    "low100": row.get("low100") if row else None,
                    "isHigh100": row.get("isHigh100") if row else None,
                    "distanceToHigh100": row.get("distanceToHigh100") if row else None,
                    "isNearHigh100": row.get("isNearHigh100") if row else None,
                    "position100": row.get("position100") if row else None,
                    "highStatus": row.get("highStatus") if row else None,
                }
            )
        daily_stocks = sorted(daily_stocks, key=lambda row: sort_change_value(row.get("changePercent")), reverse=True)
        high_stock_count = len(high_metrics)
        high100_count = sum(1 for row in high_metrics if row.get("isHigh100") is True)
        near_high100_count = sum(1 for row in high_metrics if row.get("isNearHigh100") is True)
        trend.append(
            {
                "date": date,
                "averageChange": round(sum(values) / len(values), 4) if values else None,
                "totalVolume": round(sum(volumes), 2) if volumes else None,
                "totalTurnover": round(sum(turnovers), 2) if turnovers else None,
                "totalAmount": round(sum(turnovers), 2) if turnovers else None,
                "stockCount": len(values),
                "volumeStockCount": len(volumes),
                "turnoverStockCount": len(turnovers),
                "amountStockCount": len(turnovers),
                "high100StockCount": high_stock_count,
                "high100Count": high100_count,
                "nearHigh100Count": near_high100_count,
                "high100Rate": round(high100_count / high_stock_count * 100, 4) if high_stock_count else None,
                "nearHigh100Rate": round(near_high100_count / high_stock_count * 100, 4) if high_stock_count else None,
                "avgDistanceToHigh100": round(sum(float(row["distanceToHigh100"]) for row in high_metrics) / high_stock_count, 4) if high_stock_count else None,
                "avgPosition100": round(sum(float(row["position100"]) for row in high_metrics) / high_stock_count, 4) if high_stock_count else None,
                "stocks": daily_stocks,
            }
        )

    latest_trend = next((item for item in reversed(trend) if item.get("averageChange") is not None), None)
    board_new_high_trend = [
        {
            "date": item.get("date"),
            "stockCount": item.get("high100StockCount", 0),
            "high100Count": item.get("high100Count", 0),
            "nearHigh100Count": item.get("nearHigh100Count", 0),
            "high100Rate": item.get("high100Rate"),
            "nearHigh100Rate": item.get("nearHigh100Rate"),
            "avgDistanceToHigh100": item.get("avgDistanceToHigh100"),
            "avgPosition100": item.get("avgPosition100"),
            "averageChange": item.get("averageChange"),
        }
        for item in trend
    ]
    return {
        "code": board.get("code") or re.sub(r"\s+", "-", str(board.get("name") or "custom")).lower(),
        "name": board.get("name") or "自定义板块",
        "stockCount": len(stocks),
        "availableStockCount": latest_trend.get("stockCount") if latest_trend else 0,
        "latestHigh100StockCount": latest_trend.get("high100StockCount") if latest_trend else 0,
        "latestHigh100Count": latest_trend.get("high100Count") if latest_trend else 0,
        "latestNearHigh100Count": latest_trend.get("nearHigh100Count") if latest_trend else 0,
        "latestHigh100Rate": latest_trend.get("high100Rate") if latest_trend else None,
        "latestNearHigh100Rate": latest_trend.get("nearHigh100Rate") if latest_trend else None,
        "latestAvgDistanceToHigh100": latest_trend.get("avgDistanceToHigh100") if latest_trend else None,
        "latestAvgPosition100": latest_trend.get("avgPosition100") if latest_trend else None,
        "latestAverageChange": latest_trend.get("averageChange") if latest_trend else None,
        "latestTotalVolume": latest_trend.get("totalVolume") if latest_trend else None,
        "latestTotalTurnover": latest_trend.get("totalTurnover") if latest_trend else None,
        "latestTotalAmount": latest_trend.get("totalAmount") if latest_trend else None,
        "stocks": sorted(stocks, key=lambda row: sort_change_value(row.get("latestChangePercent")), reverse=True),
        "trend": trend,
        "boardNewHighTrend": board_new_high_trend,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build custom board average-change history for the web dashboard.")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--date", default=datetime.now().strftime("%Y%m%d"), help="End date such as 20260417.")
    parser.add_argument("--days", type=int, default=15)
    parser.add_argument("--lookback-days", type=int, default=220)
    parser.add_argument("--sleep", type=float, default=0.2)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--refresh", action="store_true", help="Ignore cached stock histories and fetch all codes again.")
    parser.add_argument("--intraday", action="store_true", help="Overlay today's realtime spot quotes into the latest custom board row.")
    args = parser.parse_args()

    config = load_config(args.config)
    boards = config.get("boards", [])
    codes = sorted(
        {
            normalize_stock_code(stock.get("code"))
            for board in boards
            for stock in board.get("stocks", [])
            if normalize_stock_code(stock.get("code"))
        }
    )

    stock_histories: dict[str, list[dict[str, Any]]] = {}
    errors: list[dict[str, str]] = []
    for index, code in enumerate(codes, start=1):
        try:
            cached = None if args.refresh else load_cached_history(args.cache_dir, code, args.date, args.lookback_days)
            if cached is None:
                stock_histories[code] = fetch_stock_history(code, args.date, args.lookback_days)
                write_cached_history(args.cache_dir, code, args.date, args.lookback_days, stock_histories[code])
                print(f"Fetched {code} ({index}/{len(codes)})")
            else:
                stock_histories[code] = cached
                print(f"Cached {code} ({index}/{len(codes)})")
        except Exception as exc:  # noqa: BLE001 - keep one bad code from blocking other custom boards.
            stock_histories[code] = []
            errors.append({"code": code, "error": str(exc)})
            print(f"Failed {code}: {exc}")
        if args.sleep and index < len(codes):
            time.sleep(args.sleep)

    intraday_rows: dict[str, dict[str, Any]] = {}
    if args.intraday:
        try:
            intraday_rows = fetch_intraday_spot(set(codes), args.date)
            merge_intraday_rows(stock_histories, intraday_rows, args.date)
            print(f"Intraday rows: {len(intraday_rows)}/{len(codes)} for {format_date(args.date)}")
        except Exception as exc:  # noqa: BLE001 - keep historical build available when realtime source is unavailable.
            errors.append({"code": "intraday", "error": str(exc)})
            print(f"Failed intraday spot overlay: {exc}")

    dates = latest_trading_dates(stock_histories, args.days)
    built_boards = [build_board(board, stock_histories, dates) for board in boards]
    built_boards = sorted(built_boards, key=lambda board: sort_change_value(board.get("latestAverageChange")), reverse=True)
    market_index = None
    try:
        market_rows = fetch_market_index_history(MARKET_INDEX_SYMBOL, args.date, args.lookback_days)
        if args.intraday:
            market_spot = fetch_market_index_intraday(MARKET_INDEX_SYMBOL, args.date)
            merge_market_index_intraday(market_rows, market_spot, args.date)
            if market_spot:
                print(f"Intraday market index row: {MARKET_INDEX_SYMBOL} for {format_date(args.date)}")
        market_index = build_market_index(market_rows, dates)
    except Exception as exc:  # noqa: BLE001 - keep custom board build available even when index source is unavailable.
        errors.append({"code": "market_index", "error": str(exc)})
        print(f"Failed market index fetch: {exc}")
    payload = {
        "date": format_date(args.date),
        "days": args.days,
        "source": {
            "name": "AkShare stock_zh_a_hist" + (" + stock_zh_a_spot_em" if args.intraday else ""),
            "kind": "A-share daily price history" + (" with realtime spot overlay" if args.intraday else ""),
            "note": "Custom board lines use member stock change percent; --intraday overlays today's realtime spot quote row when available.",
            "amountUnit": "turnover_yuan",
            "amountNote": "amount is kept for compatibility and equals turnover. Use volume for share volume and turnover for turnover amount in yuan.",
        },
        "marketIndex": market_index,
        "boards": built_boards,
        "errors": errors,
    }

    payload = sanitize_json_value(payload)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Wrote {args.out}")
    print(f"Boards: {len(payload['boards'])}, stocks: {len(codes)}, dates: {len(dates)}, errors: {len(errors)}")


if __name__ == "__main__":
    main()
