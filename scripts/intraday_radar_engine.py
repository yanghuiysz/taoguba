"""
盘中机会雷达 Python 计算引擎
移植自 web/intraday.js
"""

from __future__ import annotations
from datetime import datetime
from pathlib import Path
from typing import Optional, Any
import json


# ── 工具函数 ────────────────────────────────────────────────────────────────

def safe_number(value: Any) -> Optional[float]:
    """安全数值转换"""
    try:
        parsed = float(value)
        return parsed if float("inf") > parsed > float("-inf") else None
    except (TypeError, ValueError):
        return None


def clamp(value: float, min_val: float, max_val: float) -> float:
    """范围限制"""
    return max(min_val, min(max_val, value))


def score_range(value: Any, min_val: float, max_val: float) -> float:
    """评分范围计算"""
    parsed = safe_number(value)
    if parsed is None:
        return 0.0
    return clamp((parsed - min_val) / (max_val - min_val) * 100, 0, 100)


def compound_return(values: list) -> Optional[float]:
    """复合收益率"""
    valid = [safe_number(v) for v in values if safe_number(v) is not None]
    if not valid:
        return None
    product = 1.0
    for v in valid:
        product *= (1 + v / 100)
    return (product - 1) * 100


def average(values: list) -> Optional[float]:
    """平均值"""
    valid = [safe_number(v) for v in values if safe_number(v) is not None]
    if not valid:
        return None
    return sum(valid) / len(valid)


def max_drawdown(changes: list) -> float:
    """最大回撤"""
    value = 1.0
    peak = 1.0
    drawdown = 0.0
    for change in changes:
        parsed = safe_number(change)
        if parsed is None:
            continue
        value *= (1 + parsed / 100)
        peak = max(peak, value)
        if peak > 0:
            drawdown = max(drawdown, (peak - value) / peak * 100)
    return drawdown


def red_rate(row: dict) -> Optional[float]:
    """红盘率"""
    stocks = row.get("stocks", [])
    valid_stocks = [s for s in stocks if safe_number(s.get("changePercent")) is not None]
    if not valid_stocks:
        return None
    up_count = sum(1 for s in valid_stocks if safe_number(s.get("changePercent", 0)) > 0)
    return up_count / len(valid_stocks) * 100


def board_change(row: dict) -> Optional[float]:
    """板块涨跌幅"""
    return safe_number(row.get("displayAverageChange") or row.get("averageChange"))


# ── 数据处理函数 ─────────────────────────────────────────────────────────────

def trend_rows(board: dict) -> list:
    """获取有效的趋势数据行"""
    return [
        row for row in (board.get("trend") or [])
        if row is not None and row.get("averageChange") is not None
    ]


def selected_rows(board: dict, days: int) -> list:
    """获取最近N天的数据"""
    rows = trend_rows(board)
    return rows[max(0, len(rows) - days):]


def selected_rows_until(board: dict, days: int, end_index: int) -> list:
    """获取截止到指定索引的N天数据"""
    rows = trend_rows(board)
    if not rows or end_index < 0:
        return []
    safe_end = min(end_index, len(rows) - 1)
    return rows[max(0, safe_end - days + 1): safe_end + 1]


def index_row_by_date(data: dict, date: str) -> Optional[dict]:
    """根据日期获取大盘数据"""
    for row in (data.get("marketIndex", {}).get("trend") or []):
        if row.get("date") == date:
            return row
    return None


def market_index_rows(data: dict) -> list[dict]:
    """获取有效指数行"""
    return [
        row for row in (data.get("marketIndex", {}).get("trend") or [])
        if safe_number(row.get("changePercent")) is not None
    ]


def trading_progress_fraction(row: dict) -> float:
    """A 股盘中交易进度，用于把当前成交量估算为全天量。"""
    text = str(row.get("timestamp") or "")
    if len(text) != 14 or not text.isdigit():
        return 1.0

    hour = int(text[8:10])
    minute = int(text[10:12])
    minutes = hour * 60 + minute
    morning_start = 9 * 60 + 30
    morning_end = 11 * 60 + 30
    afternoon_start = 13 * 60
    close = 15 * 60

    if minutes <= morning_start:
        traded = 0
    elif minutes <= morning_end:
        traded = minutes - morning_start
    elif minutes <= afternoon_start:
        traded = 120
    elif minutes <= close:
        traded = 120 + minutes - afternoon_start
    else:
        traded = 240
    return clamp(traded / 240, 0.05, 1)


def index_volume_state(rows: list[dict], latest: dict) -> dict:
    """用盘中预估全天量比近5日均量判断放量/平量/缩量。"""
    current_volume = safe_number(latest.get("volume"))
    previous_volumes = [
        value for value in [safe_number(row.get("volume")) for row in rows[-6:-1]]
        if value is not None and value > 0
    ]
    avg_volume = average(previous_volumes)
    if current_volume is None or avg_volume is None or avg_volume <= 0:
        label = str(latest.get("label") or "")
        if "放量" in label:
            return {"state": "放量", "ratio": None, "label": "放量"}
        if "缩量" in label:
            return {"state": "缩量", "ratio": None, "label": "缩量"}
        return {"state": "平量", "ratio": None, "label": "量能暂无"}

    progress = trading_progress_fraction(latest)
    estimated_volume = current_volume / progress
    ratio = estimated_volume / avg_volume
    if ratio >= 1.05:
        return {"state": "放量", "ratio": ratio, "label": f"预估放量 {ratio:.2f}x"}
    if ratio <= 0.85:
        return {"state": "缩量", "ratio": ratio, "label": f"预估缩量 {ratio:.2f}x"}
    return {"state": "平量", "ratio": ratio, "label": f"预估平量 {ratio:.2f}x"}


def index_gate(data: dict) -> dict:
    """指数闸门：红灯禁止买入，黄灯小仓试错，绿灯正常观察转强。"""
    rows = market_index_rows(data)
    latest = rows[-1] if rows else None
    previous = rows[-2] if len(rows) >= 2 else None
    if not latest:
        return {
            "light": "yellow",
            "tone": "test",
            "label": "指数黄灯谨慎",
            "action": "数据不足，只能小仓试错",
            "score": 45,
            "reason": "缺少指数实时数据",
        }

    latest_change = safe_number(latest.get("changePercent")) or 0
    previous_change = safe_number(previous.get("changePercent")) if previous else None
    volume_state = index_volume_state(rows, latest)
    volume_expanded = volume_state.get("state") == "放量"
    recent3 = rows[-3:]
    down_days3 = sum(1 for row in recent3 if (safe_number(row.get("changePercent")) or 0) < 0)
    return3 = compound_return([row.get("changePercent") for row in recent3]) or latest_change
    fall_narrowed = previous_change is not None and latest_change < 0 and latest_change > previous_change

    score = 50
    if latest_change >= 0.5:
        score += 25
    elif latest_change >= 0:
        score += 15
    elif latest_change >= -0.5:
        score += 5
    else:
        score -= 15

    if volume_expanded and latest_change < 0:
        score -= 25
    elif not volume_expanded and latest_change < 0:
        score += 10
    elif volume_expanded and latest_change >= 0:
        score += 15

    if down_days3 >= 2:
        score -= 15
    elif down_days3 == 0:
        score += 10

    if return3 >= 0:
        score += 10
    elif return3 <= -2:
        score -= 15

    if fall_narrowed:
        score += 8
    score = clamp(score, 0, 100)

    reason = f"{latest_change:.2f}%，{volume_state.get('label')}，近3日{return3:.2f}%"
    if score >= 70:
        return {
            "light": "green",
            "tone": "strong",
            "label": "指数绿灯",
            "action": "允许正常做退潮转强",
            "score": score,
            "latest": latest,
            "reason": reason,
        }
    if score >= 40:
        constructive = score >= 55
        return {
            "light": "yellow",
            "tone": "test",
            "label": "指数黄偏绿" if constructive else "指数黄灯谨慎",
            "action": "允许模式内小仓试错" if constructive else "只允许小仓观察",
            "score": score,
            "latest": latest,
            "reason": reason,
        }
    return {
        "light": "red",
        "tone": "weak",
        "label": "指数红灯",
        "action": "禁止买入，只观察逆势强",
        "score": score,
        "latest": latest,
        "reason": reason,
    }


def board_window(data: dict, board: dict, days: int, end_index: int = -1) -> dict:
    """板块窗口统计"""
    if end_index < 0:
        rows = trend_rows(board)
        end_index = len(rows) - 1 if rows else -1

    rows_data = selected_rows_until(board, days, end_index)

    if not rows_data:
        return {
            "board_return": None,
            "index_return": None,
            "red_rate": None,
            "turnover": None,
            "avg_turnover": None,
            "drawdown": 0.0,
            "up_days": 0,
            "valid_days": 0,
        }

    board_returns = [board_change(r) for r in rows_data]
    index_returns = []
    for r in rows_data:
        idx_row = index_row_by_date(data, r.get("date", ""))
        if idx_row:
            val = safe_number(idx_row.get("changePercent"))
            if val is not None:
                index_returns.append(val)

    last_row = rows_data[-1]
    turnover = safe_number(last_row.get("totalTurnover") or last_row.get("totalAmount"))
    avg_turnover = average([safe_number(r.get("totalTurnover") or r.get("totalAmount")) for r in rows_data])

    return {
        "board_return": compound_return(board_returns),
        "index_return": compound_return(index_returns) if index_returns else None,
        "red_rate": average([red_rate(r) for r in rows_data]),
        "turnover": turnover,
        "avg_turnover": avg_turnover,
        "drawdown": max_drawdown(board_returns),
        "up_days": sum(1 for v in board_returns if v is not None and v > 0),
        "valid_days": sum(1 for v in board_returns if v is not None),
    }


# ── 板块状态判断 ─────────────────────────────────────────────────────────────

def attack_quality_metric(row: dict) -> dict:
    """攻击质量指标"""
    stocks = [s for s in (row.get("stocks") or []) if safe_number(s.get("changePercent")) is not None]
    if not stocks:
        return {"score": 0, "high5_rate": None, "high3_rate": None, "red_rate": None}

    high5_count = sum(1 for s in stocks if safe_number(s.get("changePercent", 0)) >= 5)
    high3_count = sum(1 for s in stocks if safe_number(s.get("changePercent", 0)) >= 3)
    up_count = sum(1 for s in stocks if safe_number(s.get("changePercent", 0)) > 0)

    high5_rate = high5_count / len(stocks) * 100
    high3_rate = high3_count / len(stocks) * 100
    red_rate_val = up_count / len(stocks) * 100

    score = (
        0.42 * score_range(high5_rate, 0, 35)
        + 0.34 * score_range(high3_rate, 5, 55)
        + 0.24 * score_range(red_rate_val, 35, 85)
    )

    return {
        "score": clamp(score, 0, 100),
        "high5_rate": high5_rate,
        "high3_rate": high3_rate,
        "red_rate": red_rate_val,
    }


def board_status(metric: dict) -> str:
    """板块状态判断"""
    latest_change = metric.get("latest_change", 0) or 0
    r3 = metric.get("return3", 0) or 0
    excess3 = metric.get("excess3", 0) or 0
    excess5 = metric.get("excess5", 0) or 0
    excess10 = metric.get("excess10", 0) or 0
    red_rate_today = metric.get("red_rate_today", 0) or 0
    drawdown3 = metric.get("drawdown3", 0) or 0
    turnover_ratio = metric.get("turnover_ratio", 0) or 0
    heat_score = metric.get("heat_score", 0) or 0

    background_ok = (excess5 >= 0) or (metric.get("return5", 0) or 0) > 0 or (excess10 > 1)

    bad_pullback = (
        latest_change < 0
        and heat_score >= 35
        and (excess3 < -1 or red_rate_today < 35 or drawdown3 > 6 or turnover_ratio > 1.25)
    )

    if heat_score < 35 or (excess3 < -2 and red_rate_today < 35) or (excess5 < -1 and excess10 < -2):
        return "热度退潮"
    if heat_score >= 65 and latest_change >= 0 and r3 > 0 and excess3 >= 0 and red_rate_today >= 50 and background_ok:
        return "主升"
    if latest_change < 0 and heat_score >= 50 and excess3 >= -0.5 and red_rate_today >= 40 and turnover_ratio <= 1.15 and background_ok:
        return "良性回踩"
    if bad_pullback:
        return "恶性回踩"
    if heat_score >= 55 and latest_change >= 0 and r3 > 0 and excess3 >= -0.5 and background_ok:
        return "启动"
    if heat_score >= 45 and drawdown3 >= 4:
        return "高位震荡"
    return "趋势走弱"


def status_tone(status: str) -> str:
    """状态色调"""
    return {
        "主升": "strong",
        "良性回踩": "test",
        "恶性回踩": "weak",
        "二波观察": "turn",
        "启动": "watch",
        "高位震荡": "mixed",
        "趋势走弱": "weak",
        "热度退潮": "divergence",
    }.get(status, "watch")


def stage_for_status(status: str) -> str:
    """状态对应的阶段"""
    if status in ["主升", "启动", "二波观察"]:
        return "进攻段"
    if status == "良性回踩":
        return "良性回踩"
    if status == "恶性回踩":
        return "恶性回踩"
    return "退潮段"


def board_metric(data: dict, board: dict, offset: int = 0) -> dict:
    """计算板块完整指标"""
    rows = trend_rows(board)
    if not rows:
        return {}

    end_index = max(0, min(len(rows) - 1 + offset, len(rows) - 1))
    latest_row = rows[end_index] if end_index >= 0 else None

    window3 = board_window(data, board, 3, end_index)
    window5 = board_window(data, board, 5, end_index)
    window10 = board_window(data, board, 10, end_index)

    latest_change = board_change(latest_row) if latest_row else None
    return3 = window3.get("board_return")
    return5 = window5.get("board_return")
    return10 = window10.get("board_return")
    index3 = window3.get("index_return")
    index5 = window5.get("index_return")
    index10 = window10.get("index_return")

    excess3 = (return3 - index3) if return3 is not None and index3 is not None else None
    excess5 = (return5 - index5) if return5 is not None and index5 is not None else None
    excess10 = (return10 - index10) if return10 is not None and index10 is not None else None

    avg_turnover = window5.get("avg_turnover")
    turnover = window5.get("turnover")
    turnover_ratio = (turnover / avg_turnover) if avg_turnover and turnover else None

    red_rate_today = red_rate(latest_row) if latest_row else None

    heat_score = (
        0.28 * score_range(latest_change, -3, 6)
        + 0.22 * score_range(return3, -3, 8)
        + 0.18 * score_range(excess3, -3, 6)
        + 0.14 * score_range(red_rate_today, 30, 80)
        + 0.10 * score_range(window3.get("red_rate"), 35, 85)
        + 0.08 * score_range(turnover_ratio, 0.75, 1.6)
    )

    attack_quality = attack_quality_metric(latest_row) if latest_row else {"score": 0}

    metric = {
        "board": board,
        "date": latest_row.get("date", "") if latest_row else "",
        "latest_row": latest_row,
        "latest_change": latest_change,
        "return3": return3,
        "return5": return5,
        "return10": return10,
        "index3": index3,
        "excess3": excess3,
        "excess5": excess5,
        "excess10": excess10,
        "red_rate_today": red_rate_today,
        "red_rate3": window3.get("red_rate"),
        "red_rate5": window5.get("red_rate"),
        "turnover_ratio": turnover_ratio,
        "drawdown3": window3.get("drawdown", 0),
        "drawdown10": window10.get("drawdown", 0),
        "heat_score": clamp(heat_score, 0, 100),
        "attack_quality": attack_quality,
    }

    metric["status"] = board_status(metric)
    metric["tone"] = status_tone(metric["status"])
    metric["stage"] = stage_for_status(metric["status"])

    return metric


# ── 阶段转换判断 ─────────────────────────────────────────────────────────────

def transition_label(metric: dict, previous_metric: dict) -> dict:
    """阶段转换标签"""
    if not previous_metric or not previous_metric.get("latest_row"):
        return {"label": "暂无对比", "tone": "watch"}

    heat_delta = metric.get("heat_score", 0) - previous_metric.get("heat_score", 0)
    quality_delta = metric.get("attack_quality", {}).get("score", 0) - previous_metric.get("attack_quality", {}).get("score", 0)

    current_stage = metric.get("stage", "")
    prev_stage = previous_metric.get("stage", "")

    if current_stage != prev_stage:
        label_map = {
            "进攻段->良性回踩": {"label": "进攻分歧", "tone": "test"},
            "进攻段->恶性回踩": {"label": "进攻转弱", "tone": "weak"},
            "进攻段->退潮段": {"label": "进攻退潮", "tone": "divergence"},
            "良性回踩->进攻段": {"label": "良性回踩转强", "tone": "strong"},
            "良性回踩->恶性回踩": {"label": "承接失败", "tone": "weak"},
            "良性回踩->退潮段": {"label": "回踩退潮", "tone": "divergence"},
            "恶性回踩->进攻段": {"label": "恶性回踩修复", "tone": "strong"},
            "恶性回踩->良性回踩": {"label": "恶性转良性", "tone": "test"},
            "恶性回踩->退潮段": {"label": "恶性退潮", "tone": "divergence"},
            "退潮段->进攻段": {"label": "退潮转强", "tone": "strong"},
            "退潮段->良性回踩": {"label": "退潮修复", "tone": "test"},
            "退潮段->恶性回踩": {"label": "退潮反抽失败", "tone": "weak"},
        }
        key = f"{prev_stage}->{current_stage}"
        result = label_map.get(key)
        if result:
            return result
        return {"label": f"{prev_stage}转{current_stage}", "tone": metric.get("tone", "watch")}

    if current_stage == "进攻段":
        if heat_delta >= 0 and quality_delta >= 0:
            return {"label": "进攻增强", "tone": "strong"}
        if quality_delta < -12 and heat_delta < -8:
            return {"label": "进攻钝化", "tone": "mixed"}
        if quality_delta < -5 or heat_delta < -5:
            return {"label": "弱分歧", "tone": "test"}
        return {"label": "进攻延续", "tone": "strong"}

    if current_stage == "良性回踩":
        if quality_delta >= -8 and (metric.get("turnover_ratio", 0) or 0) <= 1.15:
            return {"label": "承接观察", "tone": "test"}
        return {"label": "回踩走弱", "tone": "mixed"}

    if current_stage == "恶性回踩":
        return {"label": "恶化", "tone": "weak"}

    return {"label": "退潮延续", "tone": "divergence"}


def transition_rank(label: str) -> int:
    """转换优先级"""
    return {
        "良性回踩转强": 0,
        "退潮转强": 1,
        "恶性回踩修复": 2,
        "弱分歧": 3,
        "进攻分歧": 4,
        "承接观察": 5,
        "进攻增强": 6,
        "进攻延续": 7,
        "恶性转良性": 8,
        "退潮修复": 9,
        "进攻钝化": 10,
        "回踩走弱": 11,
    }.get(label, 99)


# ── 个股计算 ─────────────────────────────────────────────────────────────────

def stock_rows(board: dict, stock_code: str, days: int = 10) -> list:
    """获取个股历史数据"""
    rows = selected_rows(board, days)
    result = []
    for row in rows:
        for stock in (row.get("stocks") or []):
            if str(stock.get("code", "")) == str(stock_code):
                result.append({"row": row, "stock": stock})
                break
    return result


def stock_return(items: list, days: int) -> Optional[float]:
    """个股收益率"""
    if not items:
        return None
    changes = [safe_number(item.get("stock", {}).get("changePercent")) for item in items]
    changes = [c for c in changes if c is not None]
    if not changes:
        return None
    return compound_return(changes[-days:] if len(changes) > days else changes)


def board_return_for_items(data: dict, items: list, days: int) -> Optional[float]:
    """个股对应板块收益率"""
    if not items:
        return None
    changes = [board_change(item.get("row", {})) for item in items]
    changes = [c for c in changes if c is not None]
    if not changes:
        return None
    return compound_return(changes[-days:] if len(changes) > days else changes)


def stock_turnover_value(stock: dict) -> Optional[float]:
    """个股成交额"""
    return safe_number(stock.get("turnover") or stock.get("amount"))


def stock_defense_score(items: list) -> float:
    """个股防御评分"""
    down_days = [
        item for item in items
        if board_change(item.get("row", {})) is not None
        and board_change(item.get("row", {})) < 0
        and safe_number(item.get("stock", {}).get("changePercent")) is not None
    ]
    if not down_days:
        return 60.0

    defenses = []
    for item in down_days:
        board_pct = board_change(item.get("row", {}))
        stock_pct = safe_number(item.get("stock", {}).get("changePercent"))
        if board_pct is not None and stock_pct is not None:
            defenses.append(board_pct - stock_pct)

    if not defenses:
        return 60.0

    return 100 - score_range(average(defenses), -3, 3)


def stock_rebound_score(items: list) -> float:
    """个股反弹评分"""
    rebound_days = []
    for i in range(1, len(items)):
        prev_board = board_change(items[i - 1].get("row", {}))
        current_board = board_change(items[i].get("row", {}))
        if prev_board is not None and prev_board < 0 and current_board is not None and current_board > 0:
            rebound_days.append(items[i])

    if not rebound_days:
        return 55.0

    diffs = []
    for item in rebound_days:
        stock_pct = safe_number(item.get("stock", {}).get("changePercent"))
        board_pct = board_change(item.get("row", {}))
        if stock_pct is not None and board_pct is not None:
            diffs.append(stock_pct - board_pct)

    if not diffs:
        return 55.0

    return score_range(average(diffs), -2, 5)


def stock_resilience_rows(data: dict, board: dict) -> list:
    """个股韧性数据"""
    result = []

    for stock in (board.get("stocks") or []):
        items = stock_rows(board, stock.get("code", ""), 10)

        if not items:
            continue

        ret5 = stock_return(items, 5)
        ret3 = stock_return(items, 3)
        ret10 = stock_return(items, 10)

        amount3 = sum(
            v for v in [
                stock_turnover_value(item.get("stock", {}))
                for item in items[-3:]
            ]
            if v is not None
        )
        amount5 = sum(
            v for v in [
                stock_turnover_value(item.get("stock", {}))
                for item in items[-5:]
            ]
            if v is not None
        )

        board_ret3 = board_return_for_items(data, items, 3)
        board_ret5 = board_return_for_items(data, items, 5)
        board_ret10 = board_return_for_items(data, items, 10)

        rel3 = (ret3 - board_ret3) if ret3 is not None and board_ret3 is not None else None
        rel5 = (ret5 - board_ret5) if ret5 is not None and board_ret5 is not None else None
        rel10 = (ret10 - board_ret10) if ret10 is not None and board_ret10 is not None else None

        latest = items[-1].get("stock", {}) if items else {}
        latest_change = safe_number(latest.get("changePercent"))
        macd_score = safe_number(latest.get("macdScore")) or 50

        rel_score = score_range(average([rel5, rel10]), -5, 10)

        stock_changes = [safe_number(item.get("stock", {}).get("changePercent")) for item in items]
        stock_changes = [c for c in stock_changes if c is not None]
        drawdown_score = 100 - score_range(max_drawdown(stock_changes), 4, 18)

        trend_score = (
            0.55 * score_range(ret5, -3, 8)
            + 0.25 * score_range(ret10, -5, 15)
            + 0.20 * score_range(latest_change, -3, 5)
        )

        score = (
            0.34 * rel_score
            + 0.22 * drawdown_score
            + 0.16 * stock_defense_score(items)
            + 0.09 * stock_rebound_score(items)
            + 0.09 * trend_score
            + 0.10 * macd_score
        )

        sort_score = (
            0.58 * score_range(amount5, 0, 5_000_000_000)
            + 0.42 * score_range(ret5, -5, 18)
        )

        result.append({
            "code": stock.get("code", ""),
            "name": stock.get("name") or stock.get("code", ""),
            "latest": latest,
            "ret3": ret3,
            "ret5": ret5,
            "ret10": ret10,
            "amount3": amount3,
            "amount5": amount5,
            "rel3": rel3,
            "rel5": rel5,
            "rel10": rel10,
            "latest_change": latest_change,
            "macd_label": latest.get("macdLabel") or "MACD暂无",
            "macd_score": macd_score,
            "high_status": latest.get("highStatus") or stock.get("latestHighStatus") or "",
            "score": clamp(score, 0, 100),
            "sort_score": clamp(sort_score, 0, 100),
        })

    result.sort(key=lambda x: (-x["sort_score"], -x.get("amount5", 0), -(x.get("ret5") or -999)))
    return result


# ── 盘中状态和信号 ───────────────────────────────────────────────────────────

INTRADAY_WATCH_TRANSITIONS = {
    "良性回踩转强", "退潮转强", "恶性回踩修复", "弱分歧",
    "进攻分歧", "承接观察", "进攻增强", "进攻延续",
    "恶性转良性", "退潮修复", "进攻钝化", "回踩走弱",
}


def intraday_state(metric: dict) -> dict:
    """盘中状态"""
    latest_change = metric.get("latest_change", 0) or 0
    excess3 = metric.get("excess3", 0) or 0
    red_rate_today = metric.get("red_rate_today", 0) or 0
    drawdown3 = metric.get("drawdown3", 0) or 0
    turnover_ratio = metric.get("turnover_ratio", 0) or 0
    stage = metric.get("stage", "")
    status = metric.get("status", "")

    bad_pullback = (
        latest_change < 0
        and (
            excess3 < -1
            or red_rate_today < 35
            or drawdown3 > 6
            or turnover_ratio > 1.25
            or status == "恶性回踩"
        )
    )

    if bad_pullback:
        return {"label": "恶性回踩", "tone": "weak"}
    if latest_change < 0 and stage != "退潮段":
        return {"label": "良性回踩", "tone": "test"}
    if latest_change >= 0 and stage == "进攻段":
        return {"label": "盘中转强", "tone": "strong"}
    if stage == "退潮段":
        return {"label": "退潮走弱", "tone": "divergence"}
    return {"label": "观察", "tone": "watch"}


def signal_tone(signal: str) -> str:
    """信号色调"""
    if "红灯" in str(signal):
        return "weak"
    if "黄偏绿" in str(signal):
        return "test"
    if "黄灯" in str(signal):
        return "test"
    if signal in ["良性回踩转强", "退潮转强", "恶性回踩修复", "进攻增强"]:
        return "strong"
    if signal in ["弱分歧", "进攻分歧", "承接观察", "恶性转良性", "退潮修复", "进攻延续"]:
        return "test"
    if signal in ["进攻钝化", "回踩走弱"]:
        return "mixed"
    return "watch"


def build_trade_signal(current_state: dict, metric: dict, gate: dict | None = None) -> dict:
    """构建交易信号"""
    if current_state.get("label") not in INTRADAY_WATCH_TRANSITIONS:
        return {"signal": "观察", "priority": 0}
    base_priority = max(2, 12 - transition_rank(current_state.get("label", "")))
    if gate and gate.get("light") == "red":
        return {"signal": f"{current_state.get('label', '观察')}｜指数红灯观察", "priority": 2}
    if gate and gate.get("light") == "yellow":
        gate_label = "指数黄偏绿试错" if gate.get("label") == "指数黄偏绿" else "指数黄灯谨慎"
        return {"signal": f"{current_state.get('label', '观察')}｜{gate_label}", "priority": min(base_priority, 6)}
    return {
        "signal": current_state.get("label", "观察"),
        "priority": base_priority,
    }


# ── 机会数据 ─────────────────────────────────────────────────────────────────

def opportunity_rows(data: dict, limit: int = 80) -> list:
    """计算机会数据"""
    boards = data.get("boards", [])
    result = []
    gate = index_gate(data)

    for board in boards:
        background_metric = board_metric(data, board, offset=-1)
        current_metric_full = board_metric(data, board, offset=0)

        if not current_metric_full:
            continue

        # 计算带转换标签的完整指标
        current_metric = {
            **current_metric_full,
            "previous": background_metric,
            "transition": transition_label(current_metric_full, background_metric),
        }

        if current_metric.get("transition", {}).get("label") not in INTRADAY_WATCH_TRANSITIONS:
            continue

        # 获取板块前3个韧性个股
        resilience_stocks = stock_resilience_rows(data, board)[:3]

        for stock in resilience_stocks:
            latest_change = safe_number(stock.get("latest_change")) or 0
            rel5 = safe_number(stock.get("rel5")) or 0
            rel10 = safe_number(stock.get("rel10")) or 0
            current_state = current_metric.get("transition", {})
            trade_signal = build_trade_signal(current_state, current_metric, gate)
            macd_label = stock.get("macd_label", "")

            # 计算机会分
            opportunity_score = clamp(
                0.38 * (safe_number(stock.get("score")) or 0)
                + 0.20 * score_range(rel5, -2, 6)
                + 0.14 * score_range(rel10, -4, 10)
                + 0.12 * score_range(latest_change, -2, 6)
                + 0.10 * (safe_number(stock.get("macd_score")) or 50)
                + 0.06 * (background_metric.get("heat_score") or 0),
                0,
                100,
            )

            # 过滤条件
            if trade_signal.get("priority", 0) < 2:
                continue
            if opportunity_score < 58:
                continue
            if not (stock.get("score", 0) >= 65 or latest_change >= 1 or rel5 >= 0):
                continue
            if "死叉" in str(macd_label):
                continue

            result.append({
                "board": board,
                "background_metric": background_metric,
                "current_metric": current_metric_full,
                "current_state": current_state,
                "stock": stock,
                "signal": trade_signal.get("signal", "观察"),
                "signal_priority": trade_signal.get("priority", 0),
                "index_gate": gate,
                "opportunity_score": opportunity_score,
            })

    # 排序
    result.sort(key=lambda x: (-x["signal_priority"], -x["opportunity_score"]))
    return result[:limit]


# ── 数据加载 ─────────────────────────────────────────────────────────────────

def load_radar_data(json_path: Path) -> dict:
    """加载雷达数据"""
    if not json_path.exists():
        return {}
    try:
        with open(json_path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}
