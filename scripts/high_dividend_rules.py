from __future__ import annotations

from datetime import date, datetime
from math import floor, isfinite
from statistics import median
from typing import Any


VALID_POOLS = {"stable", "cyclical", "unclassified"}


def classify_pool(industry: str, config: dict[str, Any], code: str) -> str:
    override = (config.get("poolOverrides") or {}).get(code)
    if override in VALID_POOLS:
        return override
    if industry in config.get("stableIndustries", []):
        return "stable"
    if industry in config.get("cyclicalIndustries", []):
        return "cyclical"
    return "unclassified"


def _percentile(values: list[float], percentile: float) -> float | None:
    clean = []
    for value in values:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if isfinite(number) and number >= 0:
            clean.append(number)
    clean.sort()
    if not clean:
        return None
    index = floor((len(clean) - 1) * percentile)
    return clean[index]


def normalized_dividend(dividends: list[float], pool: str) -> float | None:
    clean = []
    for value in dividends:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if isfinite(number) and number >= 0:
            clean.append(number)
    if pool == "stable":
        recent = clean[-3:]
        if not recent:
            return None
        baseline = median(recent)
        if len(recent) >= 2 and recent[-1] < recent[-2] * 0.8:
            return recent[-1]
        return float(baseline)
    if pool == "cyclical" and len(clean) >= 4:
        return _percentile(clean[-5:], 0.25)
    return None


def target_yield(pool: str, bond_yield: float | None) -> float | None:
    if bond_yield is None:
        return None
    if pool == "stable":
        return max(0.05, float(bond_yield) + 0.025)
    if pool == "cyclical":
        return max(0.06, float(bond_yield) + 0.035)
    return None


def _parse_date(value: Any) -> date | None:
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _number(value: Any) -> float | None:
    try:
        number = float(value)
        return number if isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _check(status: str, label: str, reason: str, value: Any = None, threshold: Any = None) -> dict[str, Any]:
    return {"status": status, "label": label, "value": value, "threshold": threshold, "reason": reason}


def evaluate_stock(stock: dict[str, Any], config: dict[str, Any], as_of: date) -> dict[str, Any]:
    code = str(stock.get("code") or "")
    pool = classify_pool(str(stock.get("industry") or ""), config, code)
    checks: list[dict[str, Any]] = []
    missing: list[str] = []

    price = _number(stock.get("price"))
    bond_yield = _number(stock.get("bondYield"))
    bond_date = _parse_date(stock.get("bondDate"))
    raw_dividends = stock.get("dividends") if isinstance(stock.get("dividends"), list) else []
    dividends = [number for value in raw_dividends if (number := _number(value)) is not None and number >= 0]
    raw_years = stock.get("dividendYears") if isinstance(stock.get("dividendYears"), list) else []
    ttm_dividend = _number(stock.get("ttmDividend"))
    required = [
        (price if price is not None and price > 0 else None, "缺少有效价格"),
        (bond_yield if bond_yield is not None and bond_yield >= 0 else None, "缺少10年期国债收益率"),
        (bond_date, "缺少国债数据日期"),
        (_number(stock.get("avgTurnover20")), "缺少近20日平均成交额"),
        (_parse_date(stock.get("listingDate")), "缺少上市日期"),
        (_number(stock.get("latestProfit")), "缺少最近完整财年归母净利润"),
        (ttm_dividend if ttm_dividend is not None and ttm_dividend >= 0 else None, "缺少近12个月每股分红"),
        (_number(stock.get("qualityScore")), "缺少质量评分"),
    ]
    missing.extend(reason for value, reason in required if value is None)
    if bond_date and (as_of - bond_date).days > 7:
        missing.append("10年期国债数据已超过7日")
    if pool == "unclassified":
        missing.append("行业尚未分入稳定或周期池")
    listing_date_for_history = _parse_date(stock.get("listingDate"))
    required_cyclical_years = min(5, max(3, as_of.year - listing_date_for_history.year)) if listing_date_for_history else 5
    if pool == "cyclical" and len(dividends) < required_cyclical_years:
        missing.append("周期池需要至少5年分红记录")
    if len(dividends) < 3:
        missing.append("缺少至少3年分红记录")
    if len(raw_years) < 3:
        missing.append("缺少至少3个有效分红年度")
    if missing:
        checks.extend(_check("missing", "数据完整性", reason) for reason in missing)
        return {**stock, "pool": pool, "state": "数据不足", "reasons": missing[:5], "checks": checks}

    hard_failures: list[str] = []
    name = str(stock.get("name") or "")
    if "ST" in name.upper() or stock.get("isDelisting"):
        hard_failures.append("属于ST或退市风险股票")
    if _number(stock.get("avgTurnover20")) < 50_000_000:
        hard_failures.append("近20日平均成交额低于5000万元")
    listing_date = _parse_date(stock.get("listingDate"))
    if not listing_date or (as_of - listing_date).days < 365 * 3:
        hard_failures.append("上市不足3年或上市日期缺失")
    if _number(stock.get("latestProfit")) <= 0:
        hard_failures.append("最近完整财年归母净利润不为正")
    years = sorted(set(int(year) for year in raw_years if str(year).isdigit()))
    if len(years) < 3 or any(b - a != 1 for a, b in zip(years[-3:], years[-2:])):
        hard_failures.append("最近3年现金分红不连续")
    if hard_failures:
        checks.extend(_check("fail", "质量门槛", reason) for reason in hard_failures)
        return {**stock, "pool": pool, "state": "风险观察", "reasons": hard_failures[:5], "checks": checks}

    baseline = normalized_dividend(dividends, pool)
    goal_yield = target_yield(pool, float(bond_yield))
    if baseline is None or goal_yield is None or price <= 0:
        reason = "无法计算正常化分红或目标股息率"
        return {**stock, "pool": pool, "state": "数据不足", "reasons": [reason], "checks": [_check("missing", "估值", reason)]}

    attention_price = baseline / goal_yield
    current_yield = ttm_dividend / price
    quality_score = _number(stock.get("qualityScore"))
    warnings: list[str] = []
    if len(dividends) >= 2 and float(dividends[-1]) < float(dividends[-2]) * 0.8:
        warnings.append("最近一年分红下降超过20%")
    if pool == "cyclical" and float(dividends[-1]) > median(dividends[-5:]) * 1.5:
        warnings.append("最近分红显著高于五年中位数，存在周期高位风险")

    expensive_reasons = []
    if current_yield < goal_yield * 0.8:
        expensive_reasons.append("当前股息率明显低于双锚目标")
    if price > attention_price * 1.25:
        expensive_reasons.append("价格高于目标关注价")
    if expensive_reasons:
        state, reasons = "偏贵", expensive_reasons
    elif quality_score >= 70 and current_yield >= goal_yield and price <= attention_price and not warnings:
        state, reasons = "可关注", ["质量等级达到A/B", "当前股息率达到双锚目标", "价格不高于目标关注价"]
    else:
        state, reasons = "等待", warnings or ["质量未触发否决", "当前价格尚未进入关注区"]

    checks.extend([
        _check("pass" if quality_score >= 70 else "warning", "质量分", f"质量分为{quality_score:.0f}", quality_score, 70),
        _check("pass" if current_yield >= goal_yield else "warning", "双锚股息率", f"当前{current_yield:.2%}，目标{goal_yield:.2%}", current_yield, goal_yield),
    ])
    ladder = [{"yield": goal_yield + step, "price": baseline / (goal_yield + step)} for step in (0, 0.005, 0.01, 0.015)]
    return {
        **stock, "pool": pool, "state": state, "reasons": reasons[:5], "checks": checks,
        "normalizedDividend": baseline, "currentYield": current_yield, "targetYield": goal_yield,
        "attentionPrice": attention_price, "distanceToAttention": price / attention_price - 1,
        "yieldLadder": ladder,
    }
