from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import akshare as ak


CONFIG_PATH = Path("web/data/custom_boards_config.json")
OUT_PATH = Path("web/data/custom_boards.json")
CACHE_DIR = Path("data/custom_stock_history")


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
        return float(value)
    except (TypeError, ValueError):
        return None


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
        rows.append(
            {
                "date": format_date(str(row.get("日期", ""))),
                "code": normalize_stock_code(row.get("股票代码", code)),
                "open": number_or_none(row.get("开盘")),
                "close": number_or_none(row.get("收盘")),
                "high": number_or_none(row.get("最高")),
                "low": number_or_none(row.get("最低")),
                "changePercent": number_or_none(row.get("涨跌幅")),
                "amount": number_or_none(row.get("成交额")),
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
                "amount": round(volume_lots * close * 100, 2) if volume_lots is not None and close is not None else None,
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
        rows[code] = {
            "date": format_date(date),
            "code": code,
            "open": open_price,
            "close": close,
            "high": number_or_none(first_present(row, ("最高", "high", "f15"), 9)),
            "low": number_or_none(first_present(row, ("最低", "low", "f16"), 10)),
            "changePercent": change_percent,
            "amount": number_or_none(first_present(row, ("成交额", "amount", "f6"), 7)),
            "turnoverRate": number_or_none(first_present(row, ("换手率", "turnoverRate", "f8"), 14)),
            "source": "intraday_spot",
        }
    return rows


def fetch_intraday_spot(codes: set[str], date: str) -> dict[str, dict[str, Any]]:
    df = ak.stock_zh_a_spot_em()
    return normalize_spot_rows(df, codes, date)


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


def build_board(board: dict[str, Any], stock_histories: dict[str, list[dict[str, Any]]], dates: list[str]) -> dict[str, Any]:
    stocks = []
    stock_rows_by_code: dict[str, dict[str, dict[str, Any]]] = {}
    for item in board.get("stocks", []):
        code = normalize_stock_code(item.get("code"))
        if not code:
            continue
        rows = stock_histories.get(code, [])
        stock_rows_by_code[code] = {row["date"]: row for row in rows}
        latest = next((row for row in reversed(rows) if row.get("changePercent") is not None), None)
        stocks.append(
            {
                "code": code,
                "name": item.get("name") or code,
                "latestDate": latest.get("date") if latest else None,
                "latestClose": latest.get("close") if latest else None,
                "latestChangePercent": latest.get("changePercent") if latest else None,
                "latestAmount": latest.get("amount") if latest else None,
                "availableDays": sum(1 for row in rows if row.get("date") in dates and row.get("changePercent") is not None),
            }
        )

    trend = []
    for date in dates:
        daily_stocks = []
        values = []
        amounts = []
        for stock in stocks:
            row = stock_rows_by_code.get(stock["code"], {}).get(date)
            change = row.get("changePercent") if row else None
            if change is not None:
                values.append(float(change))
            amount = row.get("amount") if row else None
            if amount is not None:
                amounts.append(float(amount))
            daily_stocks.append(
                {
                    "code": stock["code"],
                    "name": stock["name"],
                    "changePercent": change,
                    "close": row.get("close") if row else None,
                    "amount": amount,
                }
            )
        daily_stocks = sorted(daily_stocks, key=lambda row: sort_change_value(row.get("changePercent")), reverse=True)
        trend.append(
            {
                "date": date,
                "averageChange": round(sum(values) / len(values), 4) if values else None,
                "totalAmount": round(sum(amounts), 2) if amounts else None,
                "stockCount": len(values),
                "amountStockCount": len(amounts),
                "stocks": daily_stocks,
            }
        )

    latest_trend = next((item for item in reversed(trend) if item.get("averageChange") is not None), None)
    return {
        "code": board.get("code") or re.sub(r"\s+", "-", str(board.get("name") or "custom")).lower(),
        "name": board.get("name") or "自定义板块",
        "stockCount": len(stocks),
        "availableStockCount": latest_trend.get("stockCount") if latest_trend else 0,
        "latestAverageChange": latest_trend.get("averageChange") if latest_trend else None,
        "latestTotalAmount": latest_trend.get("totalAmount") if latest_trend else None,
        "stocks": sorted(stocks, key=lambda row: sort_change_value(row.get("latestChangePercent")), reverse=True),
        "trend": trend,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build custom board average-change history for the web dashboard.")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--date", default=datetime.now().strftime("%Y%m%d"), help="End date such as 20260417.")
    parser.add_argument("--days", type=int, default=15)
    parser.add_argument("--lookback-days", type=int, default=45)
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
    payload = {
        "date": format_date(args.date),
        "days": args.days,
        "source": {
            "name": "AkShare stock_zh_a_hist" + (" + stock_zh_a_spot_em" if args.intraday else ""),
            "kind": "A-share daily price history" + (" with realtime spot overlay" if args.intraday else ""),
            "note": "Custom board lines use member stock change percent; --intraday overlays today's realtime spot quote row when available.",
        },
        "boards": built_boards,
        "errors": errors,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}")
    print(f"Boards: {len(payload['boards'])}, stocks: {len(codes)}, dates: {len(dates)}, errors: {len(errors)}")


if __name__ == "__main__":
    main()
