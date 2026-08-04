from __future__ import annotations

import argparse
import json
import os
import tempfile
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

try:
    from high_dividend_rules import evaluate_stock
except ModuleNotFoundError:
    from scripts.high_dividend_rules import evaluate_stock


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "web/data/high_dividend_config.json"
DEFAULT_OUTPUT = ROOT / "web/data/high_dividend/latest.json"
CACHE_DIR = ROOT / "data/high_dividend_cache"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, allow_nan=False)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def build_snapshot(source: dict[str, Any], config: dict[str, Any], target_date: str) -> dict[str, Any]:
    as_of = datetime.strptime(target_date, "%Y-%m-%d").date()
    bond_yield = source.get("bondYield")
    bond_date = source.get("bondDate")
    stocks = []
    raw_stocks = list(source.get("stocks", []))
    known_codes = {str(stock.get("code")) for stock in raw_stocks}
    for watched in config.get("watchlistCatalog", []):
        code = str(watched.get("code"))
        if code and code not in known_codes:
            raw_stocks.append({
                "code": code,
                "name": watched.get("name", code),
                "industry": watched.get("industry", ""),
                "listingDate": watched.get("listingDate", ""),
                "price": None,
                "avgTurnover20": None,
                "dividends": [],
                "dividendYears": [],
                "ttmDividend": None,
                "latestProfit": None,
                "payoutRatio": None,
                "qualityScore": None,
            })
    watchlist = set(config.get("watchlist", []))
    for raw in raw_stocks:
        item = {**raw, "bondYield": raw.get("bondYield", bond_yield), "bondDate": raw.get("bondDate", bond_date)}
        evaluated = evaluate_stock(item, config, as_of)
        evaluated["watchlisted"] = str(item.get("code")) in watchlist
        stocks.append(evaluated)
    state_counts = Counter(stock["state"] for stock in stocks)
    pool_counts = Counter(stock["pool"] for stock in stocks)
    return {
        "version": 1,
        "date": target_date,
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "bond": {"yield": bond_yield, "date": bond_date, "name": "中国10年期国债"},
        "summary": {"total": len(stocks), "states": dict(state_counts), "pools": dict(pool_counts)},
        "stocks": stocks,
        "source": source.get("source", {"kind": "fixture", "financialAsOf": target_date, "dividendAsOf": target_date}),
        "errors": source.get("errors", []),
    }


def snapshot_is_usable(snapshot: dict[str, Any]) -> bool:
    stocks = snapshot.get("stocks") or []
    if not stocks:
        return False
    complete = [stock for stock in stocks if stock.get("state") != "数据不足"]
    return bool(complete) and len(complete) / len(stocks) >= 0.05


def _clean_number(value: Any, scale: float = 1.0) -> float | None:
    try:
        number = float(value)
        return None if number != number else number * scale
    except (TypeError, ValueError):
        return None


def fetch_live_source(target_date: str) -> dict[str, Any]:
    """Best-effort broad-market seed. Missing detail is explicit and never zero-filled."""
    import akshare as ak

    errors: list[str] = []
    try:
        spot = ak.stock_zh_a_spot_em()
    except Exception as exc:  # network adapters are intentionally fail-soft
        errors.append(f"东方财富全A行情不可用，改用新浪行情: {exc}")
        try:
            spot = ak.stock_zh_a_spot()
        except Exception as fallback_exc:
            errors.append(f"新浪全A行情也不可用: {fallback_exc}")
            spot = None
    dividends = ak.stock_history_dividend()
    start = (datetime.strptime(target_date, "%Y-%m-%d").date() - timedelta(days=30)).strftime("%Y%m%d")
    bonds = ak.bond_zh_us_rate(start_date=start)
    latest_bond = bonds.dropna(subset=["中国国债收益率10年"]).iloc[-1]
    bond_yield = float(latest_bond["中国国债收益率10年"]) / 100
    bond_date = str(latest_bond["日期"])
    spot_map = {}
    if spot is not None:
        spot_map = {str(row["代码"]).zfill(6): row for _, row in spot.iterrows()}
    rows = []
    for _, dividend in dividends.iterrows():
        code = str(dividend["代码"]).zfill(6)
        if not (code.startswith("60") or code.startswith("00") or code.startswith("30") or code.startswith("68")):
            continue
        quote = spot_map.get(code, {})
        price = _clean_number(quote.get("最新价"))
        average_dividend = _clean_number(dividend.get("年均股息"))
        if price and average_dividend is not None and average_dividend / price < 0.03:
            continue
        rows.append({
            "code": code, "name": str(dividend.get("名称") or quote.get("名称") or code),
            "industry": str(quote.get("行业") or ""), "price": price,
            "listingDate": str(dividend.get("上市日期") or ""), "avgTurnover20": _clean_number(quote.get("成交额")),
            "dividends": [], "dividendYears": [], "ttmDividend": None, "latestProfit": None,
            "payoutRatio": None, "qualityScore": None, "averageDividendSeed": average_dividend,
        })
    return {
        "date": target_date, "bondYield": bond_yield, "bondDate": bond_date, "stocks": rows, "errors": errors,
        "source": {"kind": "akshare-live-seed", "financialAsOf": None, "dividendAsOf": target_date,
                   "note": "全A自动初筛；缺少逐年分红或财务明细的股票明确标为数据不足"},
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build high-dividend radar snapshot")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--source-json", type=Path)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--strict", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    previous = args.output.read_bytes() if args.output.exists() else None
    try:
        config = load_json(args.config)
        source = load_json(args.source_json) if args.source_json else fetch_live_source(args.date)
        snapshot = build_snapshot(source, config, args.date)
        if not args.source_json and not snapshot_is_usable(snapshot):
            raise RuntimeError("实时数据缺少足够的逐年分红和财务明细，拒绝覆盖现有有效快照")
        atomic_write_json(args.output, snapshot)
        history = args.output.parent / "history" / f"{args.date.replace('-', '')}.json"
        atomic_write_json(history, snapshot)
        print(f"High-dividend snapshot: {len(snapshot['stocks'])} stocks -> {args.output}")
        return 0
    except Exception as exc:
        if previous is not None:
            args.output.write_bytes(previous)
        print(f"WARNING: high-dividend build failed; existing snapshot kept: {exc}")
        if args.strict:
            raise
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
