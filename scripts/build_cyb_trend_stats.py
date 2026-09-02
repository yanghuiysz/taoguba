# -*- coding: utf-8 -*-
"""
创业板指 趋势统计 数据构建脚本
================================================
方法: 15分钟K线定位连续阴线波段(下探窗口) + 1分钟线最大回撤测深度
  1. 拉取创业板指(sz399006) 1分钟线 (westock 数据源, 单次最多5个交易日)
  2. 重采样为 15分钟K线 (A股 16 个固定桶)
  3. 识别连续阴线波段 = 下探窗口 (口径B: 连续阴线合并为一次, 插阳线重新计数)
  4. 窗口内用 1分钟线做最大回撤, 精确定位 开始/结束 时间与深度
  5. 每日复合指标: 次数 / 最大深度 / 累计深度 / 平均深度

存储结构 (对齐 full_a_turnover_top20 模式):
  web/data/cyb_trend_stats.json                     汇总(含全部交易日, 供20天趋势展示)
  web/data/cyb_trend_stats_history/{YYYYMMDD}.json  按日结果 (date/updatedAt/count/.../dips)

用法:
  python build_cyb_trend_stats.py --days 5                       # 批量拉取最近5个交易日并合并历史
  python build_cyb_trend_stats.py --date 20260807 --days 1      # 单日增量更新(盘后调用, 已存在则跳过, --force 覆盖)
  python build_cyb_trend_stats.py --file tmp/xxx.txt            # 从本地westock输出文件读取(调试)
  python build_cyb_trend_stats.py --regen                       # 仅从历史目录重建汇总
"""
import argparse
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime, timedelta

WESTOCK_INDEX_CODE = "sz399006"
INDEX_NAME = "创业板指"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DATA_DIR = os.path.join(BASE_DIR, "web", "data")
HISTORY_DIR = os.path.join(WEB_DATA_DIR, "cyb_trend_stats_history")
SUMMARY_PATH = os.path.join(WEB_DATA_DIR, "cyb_trend_stats.json")

MIN_COMPLETE_RECORDS = 200
RECOVERY_CONFIRM = 0.50
STRONG_RECOVERY = 0.80
EFFECTIVE_DIP_DEPTH = 1.00
MAJOR_DIP_DECLINE = 0.80
MAJOR_DIP_REBOUND = 0.80

WESTOCK_SOURCE = {
    "name": "东方财富1分钟线（westock备用）",
    "kind": "index minute kline",
    "maxDays": 5,
    "note": "1分钟线重采样15分钟K线定位连续阴线波段, 波段内1分钟最大回撤测深度.",
}


def compact_date(value: str) -> str:
    """2026-08-07 -> 20260807; 20260807 原样返回 (历史文件名命名, 对齐 full_a_turnover)."""
    return value.replace("-", "")


def format_date(value: str) -> str:
    """20260807 -> 2026-08-07 (对齐 full_a_turnover 的日期格式化)."""
    if len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return value


# ---------- 1. 数据拉取与解析 ----------
def parse_westock_table(text):
    """解析 westock markdown 表格输出 -> [{date,time,price}, ...]"""
    records = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("| code") or line.startswith("| ---") or line.startswith("```"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 7:
            continue
        try:
            records.append({
                "date": parts[2],
                "time": parts[3],
                "price": float(parts[4]),
                "volume": float(parts[5]),
                "amount": float(parts[6]),
            })
        except ValueError:
            continue
    return records


def parse_eastmoney_trends(payload):
    """Parse Eastmoney trend rows into the internal minute-record format."""
    records = []
    trends = (payload.get("data") or {}).get("trends") or []
    for trend_row in trends:
        parts = str(trend_row).split(",")
        if len(parts) < 7:
            continue
        try:
            stamp = datetime.strptime(parts[0], "%Y-%m-%d %H:%M")
            records.append({
                "date": stamp.strftime("%Y%m%d"),
                "time": stamp.strftime("%H%M%S"),
                "price": float(parts[2]),
                "volume": float(parts[5]),
                "amount": float(parts[6]),
            })
        except (TypeError, ValueError):
            continue
    return records


def fetch_eastmoney_minute_days(days):
    """Fetch up to five trading days of minute bars from Eastmoney."""
    query = urllib.parse.urlencode({
        "secid": "0.399006",
        "fields1": "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
        "ndays": max(1, min(int(days), 5)),
        "iscr": 0,
        "iscca": 0,
    })
    url = f"https://push2his.eastmoney.com/api/qt/stock/trends2/get?{query}"
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://quote.eastmoney.com/",
    }
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"东方财富分钟线拉取失败: {exc}") from exc
    records = parse_eastmoney_trends(payload)
    if not records:
        raise RuntimeError("东方财富分钟线返回空数据")
    return records


def fetch_westock_minute_days(days):
    """调用 westock (npx westock-data-clawhub) 拉取创业板指分钟线 (单次最多5天).
    days=1 时输出无 date 列, 故至少拉 2 天保证日期信息可用."""
    if days < 2:
        days = 2
    npx = os.environ.get("NPX") or shutil.which("npx.cmd" if os.name == "nt" else "npx") or "npx"
    cmd = [
        npx,
        "--registry", "https://registry.npmjs.org",
        "-y", "westock-data-clawhub@1.0.4",
        "minute", WESTOCK_INDEX_CODE,
        "--days", str(days),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", shell=False)
    if result.returncode != 0:
        raise RuntimeError(f"westock 拉取失败: {result.stderr[:400]}")
    records = parse_westock_table(result.stdout)
    if not records:
        message = result.stdout.strip() or "返回空数据"
        raise RuntimeError(f"westock 拉取失败: {message[:400]}")
    return records


def fetch_minute_days(days):
    """Use westock first and fall back to Eastmoney when necessary."""
    try:
        return fetch_westock_minute_days(days)
    except RuntimeError as westock_error:
        try:
            return fetch_eastmoney_minute_days(days)
        except RuntimeError as eastmoney_error:
            raise RuntimeError(f"{eastmoney_error}; {westock_error}") from westock_error


def read_local_minute_file(path):
    """从本地文件读取 westock 格式输出"""
    with open(path, "r", encoding="utf-8") as f:
        return parse_westock_table(f.read())


def _is_trading_minute(value):
    """Return whether a datetime belongs to the continuous A-share sessions."""
    minute = value.hour * 60 + value.minute
    return (9 * 60 + 30 <= minute < 11 * 60 + 30) or (13 * 60 <= minute < 15 * 60)


def prepare_minute_bars(records):
    """Validate, normalize, sort and deduplicate raw minute records."""
    by_minute = {}
    for record in records:
        try:
            date = str(record["date"])
            time = str(record["time"]).replace(":", "")
            time = time[:6].ljust(6, "0")
            value = float(record["price"])
            value_dt = datetime.strptime(date + time, "%Y%m%d%H%M%S")
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(value) or value <= 0 or not _is_trading_minute(value_dt):
            continue
        normalized = dict(record)
        normalized.update({"date": date, "time": time, "price": value, "dt": value_dt})
        by_minute[(date, time[:4])] = normalized
    return sorted(by_minute.values(), key=lambda bar: bar["dt"])


def trading_minutes_between(start, end):
    """Count elapsed trading minutes, excluding the lunch break and closed hours."""
    if end <= start:
        return 0
    count = 0
    cursor = start.replace(second=0, microsecond=0)
    limit = end.replace(second=0, microsecond=0)
    while cursor < limit:
        if _is_trading_minute(cursor):
            count += 1
        cursor += timedelta(minutes=1)
    return count


# ---------- 2. K线重采样 (15/30 分钟通用) ----------
# 支持的多粒度 K 线 (分钟). 主口径为 15min (看板图表/表格/衍生指标沿用), 30min 用于误差对比.
INTERVALS = (15, 30)
BUCKET_ANCHORS = [(9, 30), (13, 0)]  # 上午 09:30 起 / 下午 13:00 起, 各 120 分钟


def bucket_label(dt, interval):
    """把分钟线归入固定桶, 返回 'YYYY-MM-DD HH:MM' 标签.
    A股两时段(09:30-11:30 / 13:00-15:00)各自独立对齐桶起点,
    保证 15min→16桶, 30min→8桶."""
    h, m = dt.hour, dt.minute
    mins = h * 60 + m
    for base_h, base_m in BUCKET_ANCHORS:
        base = base_h * 60 + base_m
        if base <= mins < base + 120:
            b = base + (mins - base) // interval * interval
            return f"{dt.strftime('%Y-%m-%d')} {b // 60:02d}:{b % 60:02d}"
    return None


def resample_kline(bars, interval=15):
    """把准备好的分钟线重采样为 interval 分钟固定桶 OHLC."""
    buckets = OrderedDict()
    for bar in bars:
        label = bucket_label(bar["dt"], interval)
        if label:
            buckets.setdefault(label, []).append(bar)
    result = []
    for label, group in buckets.items():
        result.append({
            "label": label,
            "O": group[0]["price"],
            "H": max(item["price"] for item in group),
            "L": min(item["price"] for item in group),
            "C": group[-1]["price"],
            "bars": group,
        })
    return result


def resample_15min(bars):
    """兼容别名: 15分钟K线 (主口径)."""
    return resample_kline(bars, 15)


def detect_dips(bars, interval=15):
    """Merge consecutive bearish kline bars, then measure depth and recovery.
    interval 可选 15/30 (分钟粒度), 用于多粒度误差对比."""
    if len(bars) < 2:
        return []
    bars = sorted(bars, key=lambda bar: bar["dt"])
    kline = resample_kline(bars, interval)
    waves = []
    current = []
    for candle in kline:
        if candle["C"] < candle["O"]:
            current.append(candle)
        elif current:
            waves.append(current)
            current = []
    if current:
        waves.append(current)

    dips = []
    for index, wave in enumerate(waves):
        wave_start = wave[0]["bars"][0]["dt"]
        wave_end = wave[-1]["bars"][-1]["dt"]
        wave_bars = [bar for bar in bars if wave_start <= bar["dt"] <= wave_end]
        peak_bar = wave_bars[0]
        trough_bar = wave_bars[0]
        running_peak = wave_bars[0]
        max_depth = 0.0
        for bar in wave_bars:
            if bar["price"] > running_peak["price"]:
                running_peak = bar
            depth = (running_peak["price"] - bar["price"]) / running_peak["price"] * 100
            if depth > max_depth:
                max_depth = depth
                peak_bar = running_peak
                trough_bar = bar

        next_start = waves[index + 1][0]["bars"][0]["dt"] if index + 1 < len(waves) else None
        recovery_window = [
            bar for bar in bars
            if bar["dt"] >= trough_bar["dt"] and (next_start is None or bar["dt"] < next_start)
        ]
        drop = peak_bar["price"] - trough_bar["price"]
        best_recovery = max(bar["price"] for bar in recovery_window) - trough_bar["price"]
        recovery_rate = min(100.0, max(0.0, best_recovery / drop * 100)) if drop else 0.0
        recovery50_minutes = None
        for bar in recovery_window:
            if bar["price"] - trough_bar["price"] >= drop * RECOVERY_CONFIRM:
                recovery50_minutes = trading_minutes_between(trough_bar["dt"], bar["dt"])
                break
        duration = max(1, trading_minutes_between(peak_bar["dt"], trough_bar["dt"]))
        n_bars = len(wave)
        dips.append({
            "wave": index + 1,
            "type": f"{n_bars}连阴" if n_bars >= 2 else "单阴",
            "range": f"{wave[0]['label'][11:]}→{wave[-1]['label'][11:]}",
            "start": peak_bar["dt"].strftime("%H:%M"),
            "end": trough_bar["dt"].strftime("%H:%M"),
            "depth": round(max_depth, 2),
            "duration": duration,
            "peak": round(peak_bar["price"], 2),
            "trough": round(trough_bar["price"], 2),
            "recoveryRate": round(recovery_rate, 2),
            "recovery50Minutes": recovery50_minutes,
            "fullyRecovered": recovery_rate >= STRONG_RECOVERY * 100,
        })
    return dips


def detect_major_dips(bars, decline_threshold=MAJOR_DIP_DECLINE, rebound_threshold=MAJOR_DIP_REBOUND):
    """Detect independent major peak-to-trough moves using symmetric reversal thresholds."""
    if len(bars) < 2:
        return []
    bars = sorted(bars, key=lambda bar: bar["dt"])
    peak = bars[0]
    trough = None
    active = False
    dips = []

    def finish(status, confirmation=None):
        depth = (peak["price"] - trough["price"]) / peak["price"] * 100
        dips.append({
            "wave": len(dips) + 1,
            "start": peak["dt"].strftime("%H:%M"),
            "end": trough["dt"].strftime("%H:%M"),
            "peak": round(peak["price"], 2),
            "trough": round(trough["price"], 2),
            "depth": round(depth, 2),
            "duration": max(1, trading_minutes_between(peak["dt"], trough["dt"])),
            "confirmTime": confirmation["dt"].strftime("%H:%M") if confirmation else None,
            "status": status,
        })

    for bar in bars[1:]:
        if not active:
            if bar["price"] >= peak["price"]:
                peak = bar
                continue
            decline = (peak["price"] - bar["price"]) / peak["price"] * 100
            if decline + 1e-9 >= decline_threshold:
                active = True
                trough = bar
            continue

        if bar["price"] < trough["price"]:
            trough = bar
            continue
        rebound = (bar["price"] - trough["price"]) / trough["price"] * 100
        if rebound + 1e-9 >= rebound_threshold:
            finish("已确认", bar)
            active = False
            peak = bar
            trough = None

    if active:
        finish("收盘未确认")
    return dips


def classify_trend_structure(k15):
    """Classify the latest two confirmed 15-minute swing highs and lows."""
    swing_highs = []
    swing_lows = []
    for index in range(2, len(k15) - 2):
        neighbors = [offset for offset in (-2, -1, 1, 2)]
        high = k15[index]["H"]
        low = k15[index]["L"]
        if all(high > k15[index + offset]["H"] for offset in neighbors):
            swing_highs.append(high)
        if all(low < k15[index + offset]["L"] for offset in neighbors):
            swing_lows.append(low)
    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return "震荡结构"
    highs_up = swing_highs[-1] > swing_highs[-2]
    highs_down = swing_highs[-1] < swing_highs[-2]
    lows_up = swing_lows[-1] > swing_lows[-2]
    lows_down = swing_lows[-1] < swing_lows[-2]
    if highs_up and lows_up:
        return "上升结构"
    if highs_down and lows_down:
        return "下降结构"
    if highs_down and not lows_down:
        return "上攻乏力"
    if lows_down and not highs_down:
        return "支撑转弱"
    return "震荡结构"


def classify_market_state(metrics):
    """Return the explainable market-state label in documented priority order."""
    if metrics.get("dataQuality") == "incomplete":
        return None
    structure = metrics.get("trendStructure")
    close_position = metrics.get("closePosition")
    recovery = metrics.get("avgRecoveryRate")
    effective_count = metrics.get("effectiveCount", 0)
    max_depth = metrics.get("maxDepth", 0)
    if structure == "下降结构" and close_position is not None and close_position < 35:
        return "弱势下行"
    if structure == "支撑转弱" or (
        structure == "上攻乏力" and close_position is not None and close_position < 35
    ):
        return "转弱预警"
    if structure in {"下降结构", "支撑转弱"} and (
        close_position is not None and close_position >= 65
        and recovery is not None and recovery >= 60
    ):
        return "弱势修复"
    if structure == "上升结构" and (effective_count >= 2 or max_depth >= 1.5):
        return "高位分歧"
    if structure == "上升结构" and (
        close_position is not None and close_position >= 65
        and recovery is not None and recovery >= 60
    ):
        return "强势上行"
    return "震荡蓄势"


def classify_risk(metrics):
    """Classify pullback risk from four independently explainable conditions."""
    if metrics.get("dataQuality") == "incomplete":
        return None
    recovery = metrics.get("avgRecoveryRate")
    close_position = metrics.get("closePosition")
    conditions = [
        metrics.get("effectiveCount", 0) >= 2,
        metrics.get("maxDepth", 0) >= 1.5,
        recovery is not None and recovery < 50,
        close_position is not None and close_position < 35,
    ]
    count = sum(conditions)
    if count == 0:
        return "低"
    if count <= 2:
        return "升温"
    return "高"


def compare_risk(previous, current):
    if previous is None or current is None:
        return None
    order = {"低": 0, "升温": 1, "高": 2}
    if order[current] > order[previous]:
        return "升温"
    if order[current] < order[previous]:
        return "缓解"
    return "持平"


def build_reasons(metrics):
    """Build at most three short facts supporting the latest classifications."""
    reasons = []
    if metrics.get("effectiveCount", 0):
        reasons.append(f"有效下探{metrics['effectiveCount']}次")
    if metrics.get("maxDepth") is not None:
        reasons.append(f"最大回撤{metrics['maxDepth']:.2f}%")
    if metrics.get("avgRecoveryRate") is not None:
        reasons.append(f"平均收复{metrics['avgRecoveryRate']:.0f}%")
    if metrics.get("closePosition") is not None:
        reasons.append(f"收盘位置{metrics['closePosition']:.0f}%")
    if metrics.get("trendStructure"):
        reasons.append(metrics["trendStructure"])
    return reasons[:3]


# ---------- 3. 每日分析 ----------
def analyze_day(records):
    """Analyze one trading day's validated minute pullbacks."""
    return detect_dips(prepare_minute_bars(records))


def intraday_drawdown(bars):
    """全天 1分钟线 running-peak 最大回撤 (不依赖K线切段, 即肉眼可见的真实盘中回撤).
    作为双粒度切段深度的"真实值"参照: 粒度越粗 深度越接近它."""
    if len(bars) < 2:
        return None
    running_peak = bars[0]
    peak_bar = bars[0]
    trough_bar = bars[0]
    max_dd = 0.0
    for bar in bars:
        if bar["price"] > running_peak["price"]:
            running_peak = bar
        dd = (running_peak["price"] - bar["price"]) / running_peak["price"] * 100
        if dd > max_dd:
            max_dd = dd
            peak_bar = running_peak
            trough_bar = bar
    return {
        "drawdown": round(max_dd, 2),
        "peak": round(peak_bar["price"], 2),
        "peakTime": peak_bar["dt"].strftime("%H:%M"),
        "trough": round(trough_bar["price"], 2),
        "troughTime": trough_bar["dt"].strftime("%H:%M"),
    }


def build_day_stats(records):
    """Group minute records by day and emit schema-v2 strength metrics."""
    by_date = {}
    for r in records:
        by_date.setdefault(r["date"], []).append(r)

    days = []
    previous_k15 = []
    previous_risk = None
    for date_key, day_records in sorted(by_date.items()):
        bars = prepare_minute_bars(day_records)
        dips = detect_dips(bars)
        major_dips = detect_major_dips(bars)
        count = len(dips)
        total = round(sum(d["depth"] for d in dips), 2)
        max_d = round(max((d["depth"] for d in dips), default=0.0), 2)
        avg = round(total / count, 2) if count else 0.0
        effective = [d for d in dips if d["depth"] >= EFFECTIVE_DIP_DEPTH]
        recoveries = [d["recoveryRate"] for d in dips]
        recovery_times = [d["recovery50Minutes"] for d in dips if d["recovery50Minutes"] is not None]
        prices = [bar["price"] for bar in bars]
        day_high = max(prices) if prices else None
        day_low = min(prices) if prices else None
        if day_high is None or day_low is None:
            close_position = None
        elif day_high == day_low:
            close_position = 50.0
        else:
            close_position = round((prices[-1] - day_low) / (day_high - day_low) * 100, 2)
        day_change = round((prices[-1] - prices[0]) / prices[0] * 100, 2) if prices else None
        current_k15 = resample_15min(bars)
        trend_structure = classify_trend_structure(current_k15)
        if trend_structure == "震荡结构" and previous_k15:
            trend_structure = classify_trend_structure(previous_k15 + current_k15)
        quality = "complete" if len(bars) >= MIN_COMPLETE_RECORDS else "incomplete"
        # 多粒度对比: 同一 1分钟数据分别按 15/30 重采样检测,
        # 粒度越粗 切段越少(小阳线被吞), 深度越接近肉眼观察的全天回撤.
        intervals = {}
        for iv in INTERVALS:
            d = detect_dips(bars, interval=iv)
            iv_count = len(d)
            iv_total = round(sum(x["depth"] for x in d), 2)
            iv_recoveries = [x["recoveryRate"] for x in d]
            intervals[str(iv)] = {
                "count": iv_count,
                "maxDepth": round(max((x["depth"] for x in d), default=0.0), 2),
                "totalDepth": iv_total,
                "avgDepth": round(iv_total / iv_count, 2) if iv_count else 0.0,
                "effectiveCount": len([x for x in d if x["depth"] >= EFFECTIVE_DIP_DEPTH]),
                "avgRecoveryRate": round(statistics.mean(iv_recoveries), 2) if iv_recoveries else None,
                "dips": d,
            }
        day = {
            "date": format_date(date_key),
            "count": count,
            "maxDepth": max_d,
            "totalDepth": total,
            "avgDepth": avg,
            "effectiveCount": len(effective),
            "effectiveTotal": round(sum(d["depth"] for d in effective), 2),
            "avgRecoveryRate": round(statistics.mean(recoveries), 2) if recoveries else None,
            "medianRecovery50Minutes": statistics.median(recovery_times) if recovery_times else None,
            "closePosition": close_position,
            "dayChange": day_change,
            "trendStructure": trend_structure,
            "dataQuality": quality,
            "intradayDrawdown": intraday_drawdown(bars),
            "dips": dips,
            "majorDipCount": len(major_dips),
            "majorDipMaxDepth": round(max((d["depth"] for d in major_dips), default=0.0), 2),
            "majorDipAvgDepth": round(
                statistics.mean(d["depth"] for d in major_dips), 2
            ) if major_dips else 0.0,
            "majorDipConfirmedCount": sum(d["status"] == "已确认" for d in major_dips),
            "majorDipOpenCount": sum(d["status"] == "收盘未确认" for d in major_dips),
            "majorDips": major_dips,
            "intervals": intervals,
        }
        day["marketState"] = classify_market_state(day)
        day["riskLevel"] = classify_risk(day)
        day["riskChange"] = compare_risk(previous_risk, day["riskLevel"])
        day["reasons"] = build_reasons(day) if quality == "complete" else []
        days.append(day)
        if day["riskLevel"] is not None:
            previous_risk = day["riskLevel"]
        previous_k15 = current_k15
    return days


# ---------- 4. 输出 ----------
def load_history(history_dir=HISTORY_DIR):
    """读取已有历史(按日JSON), 返回 {dateKey: dayStats}"""
    result = {}
    if not os.path.isdir(history_dir):
        return result
    for name in os.listdir(history_dir):
        if not name.endswith(".json"):
            continue
        date_key = name[:-5]
        if not re.fullmatch(r"\d{8}", date_key):
            continue
        try:
            with open(os.path.join(history_dir, name), "r", encoding="utf-8") as f:
                result[date_key] = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
    return result


def write_history(days, history_dir=HISTORY_DIR):
    """按日写入 {YYYYMMDD}.json (幂等, 已存在的日期会以新分析覆盖)."""
    os.makedirs(history_dir, exist_ok=True)
    for day in days:
        date_key = compact_date(day["date"])
        payload = dict(day)
        payload.setdefault("updatedAt", datetime.now().isoformat(timespec="seconds"))
        # 剥离旧格式遗留字段 (dateKey 由文件名承担, weekday 用户已确认无意义)
        payload.pop("dateKey", None)
        payload.pop("weekday", None)
        path = os.path.join(history_dir, f"{date_key}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)


def make_summary(days):
    """Build the schema-v2 summary without mutating legacy day rows."""
    return {
        "schemaVersion": 2,
        "index": INDEX_NAME,
        "code": WESTOCK_INDEX_CODE,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": WESTOCK_SOURCE,
        "method": "15/30分钟双粒度连续阴线合并为下探波段，1分钟线测量深度与后续收复；主口径15分钟驱动图表与衍生指标，30分钟用于误差对比",
        "threshold": "有效下探 >= 1.0%",
        "days": sorted(days, key=lambda day: day.get("date", "")),
    }


def write_summary(days, summary_path=SUMMARY_PATH):
    """汇总文件: 索引信息 + 全部交易日 (供20天趋势展示)."""
    summary = make_summary(days)
    os.makedirs(os.path.dirname(summary_path), exist_ok=True)
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    return summary_path


# ---------- 5. 主流程 ----------
def main():
    parser = argparse.ArgumentParser(description="创业板指 趋势统计 数据构建 (对齐 full_a_turnover_top20 存储模式)")
    parser.add_argument("--date", default=None, help="目标交易日 YYYYMMDD (单日增量更新; 默认取拉取结果中的全部交易日)")
    parser.add_argument("--days", type=int, default=5, help="拉取最近N个交易日 (westock单次最多5)")
    parser.add_argument("--file", default=None, help="从本地westock输出文件读取 (替代拉取, 调试用)")
    parser.add_argument("--out", default=SUMMARY_PATH, help="汇总文件路径")
    parser.add_argument("--history-dir", default=HISTORY_DIR, help="按日历史目录")
    parser.add_argument("--force", action="store_true", help="单日更新时强制覆盖历史已有结果")
    parser.add_argument("--regen", action="store_true", help="仅从历史目录重建汇总, 不拉取")
    args = parser.parse_args()

    if args.regen:
        history = load_history(args.history_dir)
        days = sorted(history.values(), key=lambda d: d["date"])
        path = write_summary(days, args.out)
        print(f"已从历史重建汇总: {path} ({len(days)}个交易日)")
        for d in days:
            print(f"  {d['date']}: {d['count']}次 最大{d['maxDepth']}% 累计{d['totalDepth']}%")
        return

    if args.file:
        records = read_local_minute_file(args.file)
        print(f"本地文件解析 {len(records)} 条分钟线")
    else:
        records = fetch_minute_days(args.days)
        print(f"westock 拉取 {len(records)} 条分钟线")

    if not records:
        print("无数据, 退出", file=sys.stderr)
        sys.exit(1)

    new_days = build_day_stats(records)
    print(f"分析完成: {len(new_days)} 个交易日: {', '.join(d['date'] for d in new_days)}")

    # 单日增量更新: 目标日不在拉取范围内 -> 报错退出; 已有且非force -> 跳过(保留旧数据)
    if args.date:
        target = args.date
        matching = [d for d in new_days if compact_date(d["date"]) == target]
        if not matching:
            print(f"目标交易日 {target} 不在本次拉取范围内 (已获取: {', '.join(compact_date(d['date']) for d in new_days)}), 退出", file=sys.stderr)
            sys.exit(1)
        history = load_history(args.history_dir)
        if target in history and not args.force:
            print(f"{target} 历史已存在, 跳过 (如需覆盖请加 --force; 保留旧数据)")
            return
        new_days = matching

    merged = load_history(args.history_dir)
    for d in new_days:
        merged[compact_date(d["date"])] = d
    days = sorted(merged.values(), key=lambda d: d["date"])

    write_history(days, args.history_dir)
    path = write_summary(days, args.out)
    print(f"已写入: {path} ({len(days)}个交易日)")
    print(f"{'日期':<12}{'粒度':<8}{'次数':<6}{'最大深度':<9}{'累计深度':<9}{'平均深度':<9}{'有效(≥1%)':<9}")
    for d in days:
        for iv in ("15", "30"):
            ivs = d.get("intervals", {}).get(iv)
            if ivs is None:
                print(f"{d['date']:<12}{iv + 'min':<8}{'-':<6}{'-':<9}{'-':<9}{'-':<9}{'-':<9}")
                continue
            print(f"{d['date']:<12}{iv + 'min':<8}{ivs['count']:<6}{ivs['maxDepth']:<9.2f}{ivs['totalDepth']:<9.2f}{ivs['avgDepth']:<9.2f}{ivs['effectiveCount']}")


if __name__ == "__main__":
    main()
