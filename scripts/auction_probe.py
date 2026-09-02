"""
集合竞价探针。

在 09:15-09:25 期间采样自定义板块成分股实时行情，记录原始快照，
并按板块聚合竞价强度，记录可能超预期的板块和锚定股。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, time as dtime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_custom_board_data import (  # noqa: E402
    fetch_tencent_spot,
    normalize_stock_code,
    number_or_none,
)
from scripts.custom_board_history import load_custom_board_payload  # noqa: E402
from scripts.intraday_radar_engine import board_metric, score_range  # noqa: E402


CONFIG_PATH = ROOT / "web" / "data" / "custom_boards_config.json"
DASHBOARD_PATH = ROOT / "web" / "data" / "custom_boards.json"
SNAPSHOT_DIR = ROOT / "web" / "data" / "auction_snapshots"
RAW_SNAPSHOT_DIR = SNAPSHOT_DIR / "raw"


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_hhmm(value: str) -> dtime:
    hour, minute = value.split(":", 1)
    return dtime(hour=int(hour), minute=int(minute))


def in_time_window(now: datetime, start: dtime, end: dtime) -> bool:
    current = now.time()
    return start <= current <= end


def is_before_window(now: datetime, start: dtime) -> bool:
    return now.time() < start


def is_trading_day(now: datetime) -> bool:
    return now.weekday() < 5


def fmt_pct(value: float | None) -> str:
    if value is None:
        return "-"
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.2f}%"


def compact_quote(row: dict[str, Any], stock_name: str = "") -> dict[str, Any]:
    return {
        "code": normalize_stock_code(row.get("code")),
        "name": row.get("name") or stock_name,
        "price": number_or_none(row.get("close")),
        "open": number_or_none(row.get("open")),
        "previousClose": number_or_none(row.get("previousClose")),
        "changePercent": number_or_none(row.get("changePercent")),
        "volume": number_or_none(row.get("volume")),
        "turnover": number_or_none(row.get("turnover") or row.get("amount")),
        "turnoverRate": number_or_none(row.get("turnoverRate")),
        "timestamp": row.get("timestamp") or "",
        "source": row.get("source") or "",
    }


def config_boards(config: dict[str, Any]) -> list[dict[str, Any]]:
    return [board for board in config.get("boards", []) if board.get("stocks")]


def board_lookup(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(board.get("code", "")): board for board in data.get("boards", [])}


def collect_stock_names(config: dict[str, Any]) -> dict[str, str]:
    names: dict[str, str] = {}
    for board in config_boards(config):
        for stock in board.get("stocks", []):
            code = normalize_stock_code(stock.get("code"))
            if code:
                names.setdefault(code, str(stock.get("name") or code))
    return names


def collect_codes(config: dict[str, Any]) -> set[str]:
    return set(collect_stock_names(config).keys())


def stock_history_stats(data: dict[str, Any]) -> dict[str, dict[str, float]]:
    per_code: dict[str, list[dict[str, Any]]] = {}
    for board in data.get("boards", []):
        for trend in board.get("trend") or []:
            for stock in trend.get("stocks") or []:
                code = normalize_stock_code(stock.get("code"))
                if code:
                    per_code.setdefault(code, []).append(stock)

    stats: dict[str, dict[str, float]] = {}
    for code, rows in per_code.items():
        seen: set[str] = set()
        unique_rows: list[dict[str, Any]] = []
        for row in reversed(rows):
            key = str(row.get("date") or row.get("timestamp") or len(unique_rows))
            if key in seen:
                continue
            seen.add(key)
            unique_rows.append(row)
        recent = list(reversed(unique_rows[:5]))
        turnovers = [
            value for value in (number_or_none(row.get("turnover") or row.get("amount")) for row in recent)
            if value is not None and value > 0
        ]
        closes = [
            value for value in (number_or_none(row.get("close")) for row in recent)
            if value is not None and value > 0
        ]
        if turnovers or closes:
            stats[code] = {}
            if turnovers:
                stats[code]["avg5Turnover"] = sum(turnovers) / len(turnovers)
                stats[code]["lastTurnover"] = turnovers[-1]
            if closes:
                stats[code]["lastClose"] = closes[-1]
    return stats


def board_history_stats(data: dict[str, Any]) -> dict[str, dict[str, float]]:
    stats: dict[str, dict[str, float]] = {}
    for board in data.get("boards", []):
        code = str(board.get("code", ""))
        trend = [row for row in (board.get("trend") or []) if row.get("totalTurnover") or row.get("totalAmount")]
        recent = trend[-5:]
        turnovers = [
            value for value in (number_or_none(row.get("totalTurnover") or row.get("totalAmount")) for row in recent)
            if value is not None and value > 0
        ]
        if turnovers:
            stats[code] = {"avg5Turnover": sum(turnovers) / len(turnovers)}
    return stats


def quote_change(row: dict[str, Any], fallback_close: float | None = None) -> float | None:
    change = number_or_none(row.get("changePercent"))
    if change is not None:
        return change
    price = number_or_none(row.get("price") or row.get("close"))
    previous = number_or_none(row.get("previousClose")) or fallback_close
    if price is None or not previous:
        return None
    return (price / previous - 1) * 100


def stock_auction_score(
    quote: dict[str, Any],
    stats: dict[str, float],
) -> tuple[float, dict[str, Any]]:
    change = quote_change(quote, stats.get("lastClose"))
    turnover = number_or_none(quote.get("turnover"))
    avg_turnover = stats.get("avg5Turnover")
    turnover_ratio = turnover / avg_turnover if turnover is not None and avg_turnover else None

    score = (
        0.42 * score_range(change, 0.0, 4.0)
        + 0.30 * score_range(turnover_ratio, 0.002, 0.035)
        + 0.18 * score_range(turnover, 5_000_000, 120_000_000)
        + 0.10 * (100 if change is not None and 0.2 <= change <= 7.0 else 0)
    )
    detail = {
        "changePercent": change,
        "turnover": turnover,
        "turnoverRatio": turnover_ratio,
        "score": round(max(0, min(100, score)), 2),
    }
    return detail["score"], detail


def latest_mode_text(board_data: dict[str, Any] | None) -> str:
    if not board_data:
        return "暂无结构"
    try:
        metric = board_metric({"boards": [board_data], "marketIndex": {}}, board_data)
    except Exception:
        metric = {}
    stage = metric.get("stage") or "暂无阶段"
    status = metric.get("status") or "暂无状态"
    return f"{stage}/{status}"


def compute_alerts(
    config: dict[str, Any],
    dashboard: dict[str, Any],
    quotes: dict[str, dict[str, Any]],
    min_score: float,
    top_boards: int,
    top_stocks: int,
) -> list[dict[str, Any]]:
    names = collect_stock_names(config)
    stock_stats = stock_history_stats(dashboard)
    board_stats = board_history_stats(dashboard)
    data_boards = board_lookup(dashboard)

    alerts: list[dict[str, Any]] = []
    for board in config_boards(config):
        board_code = str(board.get("code", ""))
        stock_items: list[dict[str, Any]] = []
        for stock in board.get("stocks", []):
            code = normalize_stock_code(stock.get("code"))
            quote = quotes.get(code)
            if not quote:
                continue
            score, detail = stock_auction_score(quote, stock_stats.get(code, {}))
            if detail["changePercent"] is None:
                continue
            stock_items.append(
                {
                    "code": code,
                    "name": quote.get("name") or stock.get("name") or names.get(code, code),
                    **detail,
                }
            )

        if not stock_items:
            continue

        valid_count = len(stock_items)
        red_count = sum(1 for item in stock_items if (item.get("changePercent") or 0) > 0)
        strong_count = sum(1 for item in stock_items if (item.get("changePercent") or 0) >= 1.5)
        super_count = sum(1 for item in stock_items if item.get("score", 0) >= 70)
        avg_change = sum(item["changePercent"] for item in stock_items) / valid_count
        red_rate = red_count / valid_count * 100
        total_turnover = sum(item.get("turnover") or 0 for item in stock_items)
        board_avg_turnover = board_stats.get(board_code, {}).get("avg5Turnover")
        board_turnover_ratio = total_turnover / board_avg_turnover if board_avg_turnover else None
        top = sorted(stock_items, key=lambda item: (item["score"], item.get("turnover") or 0), reverse=True)[:top_stocks]

        board_score = (
            0.30 * score_range(avg_change, 0.0, 3.0)
            + 0.20 * score_range(red_rate, 35, 80)
            + 0.24 * score_range(board_turnover_ratio, 0.002, 0.03)
            + 0.16 * score_range(super_count, 0, 3)
            + 0.10 * score_range(total_turnover, 20_000_000, 800_000_000)
        )
        board_score = max(0, min(100, board_score))
        mode_text = latest_mode_text(data_boards.get(board_code))

        alert = {
            "boardCode": board_code,
            "boardName": board.get("name") or board_code,
            "score": round(board_score, 2),
            "mode": mode_text,
            "avgChange": round(avg_change, 4),
            "redRate": round(red_rate, 2),
            "strongCount": strong_count,
            "superCount": super_count,
            "validCount": valid_count,
            "totalTurnover": round(total_turnover, 2),
            "turnoverRatio": round(board_turnover_ratio, 5) if board_turnover_ratio is not None else None,
            "topStocks": top,
        }
        if board_score >= min_score and (super_count >= 1 or strong_count >= 2 or red_rate >= 60):
            alerts.append(alert)

    return sorted(alerts, key=lambda item: (item["score"], item["totalTurnover"]), reverse=True)[:top_boards]


def snapshot_path(date: str, snapshot_dir: Path = SNAPSHOT_DIR) -> Path:
    return snapshot_dir / f"{date}.summary.json"


def raw_snapshot_path(date: str, raw_dir: Path = RAW_SNAPSHOT_DIR) -> Path:
    return raw_dir / f"{date}.json"


def compact_sample(sample: dict[str, Any]) -> dict[str, Any]:
    return {
        "time": sample.get("time") or "",
        "alerts": sample.get("alerts") or [],
        "boardSnapshots": sample.get("boardSnapshots") or {},
    }


def build_board_snapshots(config: dict[str, Any], quotes: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    snapshots: dict[str, dict[str, Any]] = {}
    for board in config_boards(config):
        changes: list[float] = []
        turnovers: list[float] = []
        for stock in board.get("stocks", []):
            quote = quotes.get(normalize_stock_code(stock.get("code")))
            if not quote:
                continue
            change = number_or_none(quote.get("changePercent"))
            turnover = number_or_none(quote.get("turnover"))
            if change is not None:
                changes.append(change)
            if turnover is not None:
                turnovers.append(turnover)
        if not changes:
            continue
        snapshots[str(board.get("code") or "")] = {
            "stockCount": len(changes),
            "averageChange": sum(changes) / len(changes),
            "redRate": sum(1 for value in changes if value > 0) / len(changes) * 100,
            "totalTurnover": sum(turnovers) if turnovers else None,
        }
    return snapshots


def append_snapshot(
    date: str,
    sample_time: datetime,
    quotes: dict[str, dict[str, Any]],
    alerts: list[dict[str, Any]],
    snapshot_dir: Path = SNAPSHOT_DIR,
    raw_dir: Path = RAW_SNAPSHOT_DIR,
    config: dict[str, Any] | None = None,
) -> None:
    board_snapshots = build_board_snapshots(config or {"boards": []}, quotes)
    raw_path = raw_snapshot_path(date, raw_dir)
    raw_payload = load_json(raw_path, {"date": date, "samples": []})
    raw_payload.setdefault("date", date)
    raw_payload.setdefault("samples", []).append(
        {
            "time": sample_time.strftime("%Y-%m-%d %H:%M:%S"),
            "quotes": quotes,
            "alerts": alerts,
            "boardSnapshots": board_snapshots,
        }
    )
    raw_payload["latestAlerts"] = alerts
    raw_payload["updatedAt"] = sample_time.strftime("%Y-%m-%d %H:%M:%S")
    write_json(raw_path, raw_payload)

    summary_path = snapshot_path(date, snapshot_dir)
    samples = [compact_sample(sample) for sample in raw_payload.get("samples", [])]
    summary_payload = {
        "date": date,
        "updatedAt": raw_payload["updatedAt"],
        "sampleCount": len(samples),
        "samples": samples,
        "latestAlerts": alerts,
    }
    write_json(summary_path, summary_payload)


def run_once(args: argparse.Namespace) -> tuple[int, int]:
    now = datetime.now()
    config = load_json(CONFIG_PATH, {"boards": []})
    dashboard = load_custom_board_payload(DASHBOARD_PATH)
    codes = collect_codes(config)
    if not codes:
        print("No stocks configured.")
        return 0, 0

    raw_quotes = fetch_tencent_spot(codes, args.date)
    names = collect_stock_names(config)
    quotes = {
        code: compact_quote(row, names.get(code, code))
        for code, row in raw_quotes.items()
    }
    alerts = compute_alerts(
        config=config,
        dashboard=dashboard,
        quotes=quotes,
        min_score=args.min_score,
        top_boards=args.top_boards,
        top_stocks=args.top_stocks,
    )
    append_snapshot(args.date, now, quotes, alerts, config=config)
    print(f"{now:%H:%M:%S} sampled={len(quotes)} alerts={len(alerts)} snapshot={snapshot_path(args.date)} raw={raw_snapshot_path(args.date)}")

    return len(quotes), len(alerts)


def main() -> int:
    parser = argparse.ArgumentParser(description="集合竞价探针提醒")
    parser.add_argument("--date", default=datetime.now().strftime("%Y%m%d"), help="交易日期，如 20260518")
    parser.add_argument("--start", default="09:15", help="采样开始时间 HH:MM")
    parser.add_argument("--end", default="09:25", help="采样结束时间 HH:MM")
    parser.add_argument("--sample-interval", type=int, default=5, help="采样间隔秒数")
    parser.add_argument("--min-score", type=float, default=68, help="板块提醒最低分")
    parser.add_argument("--top-boards", type=int, default=8, help="最多提醒板块数")
    parser.add_argument("--top-stocks", type=int, default=3, help="每个板块展示锚定股数")
    parser.add_argument("--once", action="store_true", help="只采样一次")
    parser.add_argument("--force", action="store_true", help="忽略交易日和时间窗口，方便测试")
    args = parser.parse_args()

    start = parse_hhmm(args.start)
    end = parse_hhmm(args.end)

    if args.once:
        run_once(args)
        return 0

    print(
        f"Auction probe started: date={args.date}, window={args.start}-{args.end}, "
        f"interval={args.sample_interval}s"
    )
    while True:
        now = datetime.now()
        if not args.force and not is_trading_day(now):
            print("Not a trading day, exiting.")
            return 0
        if args.force or in_time_window(now, start, end):
            try:
                run_once(args)
            except Exception as exc:  # noqa: BLE001 - keep probe alive during the auction window.
                print(f"sample failed: {exc}", file=sys.stderr)
            time.sleep(max(1, args.sample_interval))
            continue
        if not args.force and is_before_window(now, start):
            time.sleep(min(30, max(1, args.sample_interval)))
            continue
        print("Auction window ended, exiting.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
