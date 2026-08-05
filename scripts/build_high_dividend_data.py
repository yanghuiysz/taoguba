from __future__ import annotations

import argparse
import json
import os
import re
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
        stocks.append(add_fit_score(evaluated))
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


def parse_dividend_history(frame: Any, start_year: int, end_year: int) -> tuple[list[float], list[int]]:
    cash_by_year: dict[int, float] = {}
    if frame is None or getattr(frame, "empty", True):
        return [], []
    for _, row in frame.iterrows():
        match = re.search(r"(20\d{2})", str(row.get("报告时间", "")))
        cash = _clean_number(row.get("派息比例"))
        if not match or cash is None:
            continue
        year = int(match.group(1))
        if start_year <= year <= end_year:
            cash_by_year[year] = cash_by_year.get(year, 0.0) + cash / 10
    years = sorted(cash_by_year)
    return [round(cash_by_year[year], 6) for year in years], years


def parse_financial_quality(frame: Any) -> dict[str, float | None]:
    if frame is None or getattr(frame, "empty", True):
        return {"latestProfit": None, "payoutRatio": None, "qualityScore": None}
    annual = frame.copy()
    annual["_date"] = annual["日期"].astype(str)
    annual = annual[annual["_date"].str.endswith("12-31")].sort_values("_date", ascending=False)
    if annual.empty:
        return {"latestProfit": None, "payoutRatio": None, "qualityScore": None}
    row = annual.iloc[0]
    profit = _clean_number(row.get("每股收益_调整后(元)"))
    roe = _clean_number(row.get("净资产收益率(%)"))
    payout_percent = _clean_number(row.get("股息发放率(%)"))
    payout = payout_percent / 100 if payout_percent is not None else None
    score = None
    if profit is not None and roe is not None:
        score = min(100.0, 60.0 + min(max(roe, 0), 20.0) + (10.0 if payout is not None and 0.2 <= payout <= 0.8 else 0.0))
    return {"latestProfit": profit, "payoutRatio": payout, "qualityScore": score}


def retry_fetch(operation: Any, attempts: int = 3) -> Any:
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            return operation()
        except Exception as exc:
            last_error = exc
    assert last_error is not None
    raise last_error


def parse_valuation(frame: Any) -> dict[str, Any]:
    if frame is None or getattr(frame, "empty", True):
        return {"value": None, "date": None}
    clean = frame.dropna(subset=["value"])
    if clean.empty:
        return {"value": None, "date": None}
    row = clean.sort_values("date").iloc[-1]
    return {"value": _clean_number(row.get("value")), "date": str(row.get("date"))[:10]}


def calculate_technical_guide(frame: Any) -> dict[str, Any]:
    if frame is None or getattr(frame, "empty", True) or len(frame) < 20:
        return {"signal": "数据不足", "asOf": None}
    data = frame.sort_values("date").copy()
    close = data["close"].astype(float)
    high = data["high"].astype(float)
    low = data["low"].astype(float)
    recent = data.tail(20)
    delta = close.diff()
    gains = delta.clip(lower=0).tail(14).mean()
    losses = -delta.clip(upper=0).tail(14).mean()
    rsi = 100.0 if losses == 0 else 100.0 - 100.0 / (1.0 + gains / losses)
    last_close = float(close.iloc[-1])
    support = float(recent["low"].min())
    resistance = float(recent["high"].max())
    ma20 = float(close.tail(20).mean())
    ma60 = float(close.tail(60).mean()) if len(close) >= 60 else None
    volatility = float(((high - low) / close).tail(20).mean())
    if last_close <= support * 1.03 and rsi <= 45:
        signal = "低吸观察"
    elif last_close >= resistance * 0.97 or rsi >= 68:
        signal = "高抛观察"
    else:
        signal = "持有等待"
    return {
        "signal": signal,
        "asOf": str(data.iloc[-1]["date"])[:10],
        "close": last_close,
        "support20": support,
        "resistance20": resistance,
        "ma20": ma20,
        "ma60": ma60,
        "rsi14": float(rsi),
        "volatility20": volatility,
        "avgTurnover20": _clean_number(recent["amount"].mean()) if "amount" in recent else None,
    }


def add_fit_score(stock: dict[str, Any]) -> dict[str, Any]:
    quality = _clean_number(stock.get("qualityScore")) or 0
    current_yield = _clean_number(stock.get("currentYield")) or 0
    target = _clean_number(stock.get("targetYield")) or 0.05
    pe = _clean_number(stock.get("peTtm"))
    yield_score = min(30.0, max(0.0, current_yield / target * 30.0))
    if pe is None or pe <= 0:
        valuation_score = 6.0
    elif pe <= 12:
        valuation_score = 20.0
    elif pe <= 20:
        valuation_score = 15.0
    elif pe <= 30:
        valuation_score = 8.0
    else:
        valuation_score = 2.0
    technical_score = {"低吸观察": 10.0, "持有等待": 6.0, "高抛观察": 3.0}.get((stock.get("technicalGuide") or {}).get("signal"), 0.0)
    score = round(min(100.0, quality * 0.4 + yield_score + valuation_score + technical_score), 1)
    label = "优先研究" if score >= 75 and stock.get("state") != "偏贵" else "耐心等待" if score >= 60 else "谨慎观察"
    return {**stock, "fitScore": score, "fitLabel": label}


def _fetch_legacy_broad_market_source(target_date: str) -> dict[str, Any]:
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


def fetch_live_source(target_date: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch only the curated production watchlist; fixtures never enter this path."""
    import akshare as ak

    config = config or load_json(DEFAULT_CONFIG)
    catalog = config.get("watchlistCatalog", [])
    errors: list[str] = []
    try:
        spot = ak.stock_zh_a_spot()
    except Exception as exc:
        errors.append(f"新浪全A实时行情不可用: {exc}")
        try:
            spot = ak.stock_zh_a_spot_em()
        except Exception as fallback_exc:
            errors.append(f"东方财富全A实时行情也不可用: {fallback_exc}")
            spot = None

    start = (datetime.strptime(target_date, "%Y-%m-%d").date() - timedelta(days=30)).strftime("%Y%m%d")
    bonds = ak.bond_zh_us_rate(start_date=start)
    latest_bond = bonds.dropna(subset=["中国国债收益率10年"]).iloc[-1]
    bond_yield = float(latest_bond["中国国债收益率10年"]) / 100
    bond_date = str(latest_bond["日期"])
    spot_map: dict[str, Any] = {}
    if spot is not None:
        for _, quote in spot.iterrows():
            code_match = re.search(r"(\d{6})$", str(quote.iloc[0]))
            if code_match:
                spot_map[code_match.group(1)] = quote

    rows: list[dict[str, Any]] = []
    as_of = datetime.strptime(target_date, "%Y-%m-%d").date()
    for watched in catalog:
        code = str(watched["code"])
        quote = spot_map.get(code)
        price = _clean_number(quote.iloc[2]) if quote is not None and len(quote) > 2 else None
        turnover = _clean_number(quote.iloc[12]) if quote is not None and len(quote) > 12 else None
        try:
            dividend_frame = retry_fetch(lambda: ak.stock_dividend_cninfo(code))
            dividends, dividend_years = parse_dividend_history(dividend_frame, as_of.year - 5, as_of.year - 1)
        except Exception as exc:
            errors.append(f"{code} 分红数据不可用: {exc}")
            dividends, dividend_years = [], []
        try:
            financial = parse_financial_quality(retry_fetch(lambda: ak.stock_financial_analysis_indicator(code, str(as_of.year - 5))))
        except Exception as exc:
            errors.append(f"{code} 财务数据不可用: {exc}")
            financial = {"latestProfit": None, "payoutRatio": None, "qualityScore": None}
        try:
            pe_result = parse_valuation(retry_fetch(lambda: ak.stock_zh_valuation_baidu(code, "市盈率(TTM)", "近一年")))
            pb_result = parse_valuation(retry_fetch(lambda: ak.stock_zh_valuation_baidu(code, "市净率", "近一年")))
        except Exception as exc:
            errors.append(f"{code} 估值数据不可用: {exc}")
            pe_result, pb_result = {"value": None, "date": None}, {"value": None, "date": None}
        try:
            market_code = ("sh" if code.startswith("6") else "sz") + code
            history = retry_fetch(lambda: ak.stock_zh_a_daily(
                symbol=market_code,
                start_date=(as_of - timedelta(days=130)).strftime("%Y%m%d"),
                end_date=as_of.strftime("%Y%m%d"),
                adjust="qfq",
            ))
            technical = calculate_technical_guide(history)
            if price is None and technical.get("close") is not None:
                price = technical["close"]
            if technical.get("avgTurnover20") is not None:
                turnover = technical["avgTurnover20"]
        except Exception as exc:
            errors.append(f"{code} 技术数据不可用: {exc}")
            technical = {"signal": "数据不足", "asOf": None}
        rows.append({
            "code": code,
            "name": watched["name"],
            "industry": watched["industry"],
            "price": price,
            "listingDate": watched.get("listingDate", ""),
            "avgTurnover20": turnover,
            "dividends": dividends,
            "dividendYears": dividend_years,
            "ttmDividend": dividends[-1] if dividends else None,
            "peTtm": pe_result["value"],
            "pb": pb_result["value"],
            "valuationDate": pe_result["date"] or pb_result["date"],
            "technicalGuide": technical,
            **financial,
        })
    return {
        "date": target_date,
        "bondYield": bond_yield,
        "bondDate": bond_date,
        "stocks": rows,
        "errors": errors,
        "source": {
            "kind": "akshare-live",
            "quoteAsOf": target_date,
            "financialAsOf": target_date,
            "dividendAsOf": target_date,
            "note": "实时行情：新浪/东方财富；分红：巨潮资讯；财务：新浪财经",
        },
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
        source = load_json(args.source_json) if args.source_json else fetch_live_source(args.date, config)
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
