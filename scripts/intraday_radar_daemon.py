"""
盘中雷达快刷守护进程。

用法:
  python scripts/intraday_radar_daemon.py
  python scripts/intraday_radar_daemon.py --interval 60
  python scripts/intraday_radar_daemon.py --once
  python scripts/intraday_radar_daemon.py --disable-notify
  python scripts/intraday_radar_daemon.py --force

交易日盘中自动刷新自定义板块实时数据，默认每 2 分钟执行一次。
企业微信通知默认每 5 分钟推送一次，并复用盘中雷达通知脚本。
日志写入 logs/intraday_radar.log。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable
LOCK_FILE = Path(os.environ.get("TEMP", "/tmp")) / "taoguba-intraday-radar.lock"
LOCK_EXPIRE_SECONDS = 600
NOTIFY_STATE_FILE = ROOT / "logs" / "intraday_radar_notify_slot.txt"


def log(msg: str, log_path: Path) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def is_trading_time(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return (9 * 60 + 30 <= minutes <= 11 * 60 + 30) or (13 * 60 <= minutes <= 15 * 60 + 5)


def acquire_lock() -> bool:
    if LOCK_FILE.exists():
        age = time.time() - LOCK_FILE.stat().st_mtime
        if age < LOCK_EXPIRE_SECONDS:
            return False
        LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOCK_FILE.touch()
    return True


def release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


def notify_slot(now: datetime, interval_seconds: int) -> str:
    interval_minutes = max(1, interval_seconds // 60)
    minutes = now.hour * 60 + now.minute
    bucket_start = (minutes // interval_minutes) * interval_minutes
    bucket_hour = bucket_start // 60
    bucket_minute = bucket_start % 60
    return f"{now.strftime('%Y%m%d')}-{bucket_hour:02d}{bucket_minute:02d}"


def load_last_notify_slot() -> str:
    try:
        return NOTIFY_STATE_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""
    except Exception:
        return ""


def save_last_notify_slot(slot: str) -> None:
    NOTIFY_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    NOTIFY_STATE_FILE.write_text(slot, encoding="utf-8")


def run_refresh(date_str: str, log_path: Path) -> bool:
    update_cmd = [
        PYTHON,
        str(ROOT / "scripts" / "update_daily_data.py"),
        "--date",
        date_str,
        "--intraday-custom",
        "--intraday-radar-only",
        "--custom-sleep",
        "0",
    ]
    log(f"Running: {' '.join(update_cmd)}", log_path)

    try:
        result = subprocess.run(
            update_cmd,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=300,
        )
        for line in result.stdout.strip().splitlines():
            log(f"update: {line}", log_path)
        if result.stderr:
            for line in result.stderr.strip().splitlines():
                log(f"update-err: {line}", log_path)
        if result.returncode != 0:
            log(f"Failed: update_daily_data.py exit code {result.returncode}", log_path)
            return False
    except subprocess.TimeoutExpired:
        log("Failed: update timed out (300s)", log_path)
        return False
    except Exception as exc:
        log(f"Failed: update raised {exc}", log_path)
        return False

    validate_cmd = [PYTHON, str(ROOT / "scripts" / "validate_web_data.py")]
    try:
        result = subprocess.run(
            validate_cmd,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
        for line in result.stdout.strip().splitlines():
            log(f"validate: {line}", log_path)
        if result.returncode != 0:
            log(f"Warning: validate_web_data.py exit code {result.returncode}", log_path)
            return False
    except Exception as exc:
        log(f"Warning: validate raised {exc}", log_path)
        return False

    log(f"Success: intraday radar refreshed date={date_str}", log_path)
    return True


def run_notify(top_n: int, log_path: Path) -> bool:
    notify_cmd = [
        PYTHON,
        str(ROOT / "scripts" / "notify_intraday_radar.py"),
        "--top",
        str(top_n),
    ]
    log(f"Running: {' '.join(notify_cmd)}", log_path)

    try:
        result = subprocess.run(
            notify_cmd,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=180,
        )
        for line in result.stdout.strip().splitlines():
            log(f"notify: {line}", log_path)
        if result.stderr:
            for line in result.stderr.strip().splitlines():
                log(f"notify-err: {line}", log_path)
        if result.returncode != 0:
            log(f"Failed: notify_intraday_radar.py exit code {result.returncode}", log_path)
            return False
    except subprocess.TimeoutExpired:
        log("Failed: notify timed out (180s)", log_path)
        return False
    except Exception as exc:
        log(f"Failed: notify raised {exc}", log_path)
        return False

    log("Success: intraday radar notification sent", log_path)
    return True


def maybe_notify(now: datetime, log_path: Path, interval_seconds: int, top_n: int) -> None:
    slot = notify_slot(now, interval_seconds)
    last_slot = load_last_notify_slot()
    if slot == last_slot:
        log(f"Skipped notify: slot {slot} already sent", log_path)
        return

    if run_notify(top_n=top_n, log_path=log_path):
        save_last_notify_slot(slot)


def main() -> None:
    parser = argparse.ArgumentParser(description="Intraday radar daemon loop")
    parser.add_argument("--interval", type=int, default=60, help="Loop interval in seconds (default: 60)")
    parser.add_argument("--notify-interval", type=int, default=60, help="WeCom notify interval in seconds (default: 60)")
    parser.add_argument("--notify-top", type=int, default=80, help="Max radar opportunities per notification (default: 80)")
    parser.add_argument("--disable-notify", action="store_true", help="Refresh intraday radar without sending WeCom notifications")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    parser.add_argument("--force", action="store_true", help="Ignore trading time check (for testing)")
    args = parser.parse_args()

    log_path = ROOT / "logs" / "intraday_radar.log"
    interval = args.interval
    notify_interval = max(60, args.notify_interval)

    log(f"=== Intraday radar daemon started (interval={interval}s) ===", log_path)
    if args.disable_notify:
        log("WeCom notification disabled for this run.", log_path)
    else:
        log(f"WeCom notification enabled (interval={notify_interval}s, top={args.notify_top}).", log_path)
    if args.force:
        log("WARNING: --force mode, trading time check disabled.", log_path)
    if args.once:
        log("Once mode: will exit after first refresh.", log_path)

    while True:
        now = datetime.now()
        date_str = now.strftime("%Y%m%d")

        if not args.force and not is_trading_time(now):
            if now.weekday() >= 5:
                time.sleep(300)
            else:
                time.sleep(interval)
            continue

        if not acquire_lock():
            log(f"Skipped: another instance is running (lock < {LOCK_EXPIRE_SECONDS}s)", log_path)
            time.sleep(interval)
            continue

        try:
            refreshed = run_refresh(date_str, log_path)
            if refreshed and not args.disable_notify:
                maybe_notify(
                    now=now,
                    log_path=log_path,
                    interval_seconds=notify_interval,
                    top_n=args.notify_top,
                )
        except Exception as exc:
            log(f"Unexpected error: {exc}", log_path)
        finally:
            release_lock()

        if args.once:
            log("Once mode complete, exiting.", log_path)
            break

        time.sleep(interval)


if __name__ == "__main__":
    main()
