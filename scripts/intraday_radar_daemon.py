"""
盘中雷达快刷守护进程。

用法:
  python scripts/intraday_radar_daemon.py
  python scripts/intraday_radar_daemon.py --interval 60
  python scripts/intraday_radar_daemon.py --once
  python scripts/intraday_radar_daemon.py --force

交易日盘中自动刷新自定义板块实时数据，默认每 1 分钟执行一次。
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
CLOSING_REFRESH_STATE_FILE = ROOT / "logs" / "closing_refresh_date.txt"


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


def minutes_since_midnight(value: str) -> int:
    hour_text, minute_text = value.split(":", 1)
    return int(hour_text) * 60 + int(minute_text)


def should_run_after_close_refresh(now: datetime, refresh_time: str) -> bool:
    if now.weekday() >= 5:
        return False
    return now.hour * 60 + now.minute >= minutes_since_midnight(refresh_time)


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


def load_last_closing_refresh_date() -> str:
    try:
        return CLOSING_REFRESH_STATE_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""
    except Exception:
        return ""


def save_last_closing_refresh_date(date_str: str) -> None:
    CLOSING_REFRESH_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CLOSING_REFRESH_STATE_FILE.write_text(date_str, encoding="utf-8")


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


def run_after_close_refresh(date_str: str, log_path: Path) -> bool:
    update_cmd = [
        PYTHON,
        str(ROOT / "scripts" / "update_daily_data.py"),
        "--date",
        date_str,
        "--intraday-custom",
        "--full-during-trading",
    ]
    log(f"Running after-close refresh: {' '.join(update_cmd)}", log_path)

    try:
        result = subprocess.run(
            update_cmd,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=1200,
        )
        for line in result.stdout.strip().splitlines():
            log(f"after-close: {line}", log_path)
        if result.stderr:
            for line in result.stderr.strip().splitlines():
                log(f"after-close-err: {line}", log_path)
        if result.returncode != 0:
            log(f"Failed: after-close update_daily_data.py exit code {result.returncode}", log_path)
            return False
    except subprocess.TimeoutExpired:
        log("Failed: after-close update timed out (1200s)", log_path)
        return False
    except Exception as exc:
        log(f"Failed: after-close update raised {exc}", log_path)
        return False

    log(f"Success: after-close full refresh date={date_str}", log_path)
    return True


def attempt_after_close_refresh(date_str: str, log_path: Path) -> bool:
    if not run_after_close_refresh(date_str, log_path):
        return False
    save_last_closing_refresh_date(date_str)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Intraday radar daemon loop")
    parser.add_argument("--interval", type=int, default=60, help="Loop interval in seconds (default: 60)")
    parser.add_argument("--disable-after-close-refresh", action="store_true", help="Do not run the once-per-day full refresh after close")
    parser.add_argument("--after-close-time", default="15:30", help="HH:MM time to run the after-close full refresh once per day")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    parser.add_argument("--force", action="store_true", help="Ignore trading time check (for testing)")
    args = parser.parse_args()

    log_path = ROOT / "logs" / "intraday_radar.log"
    interval = args.interval

    log(f"=== Intraday radar daemon started (interval={interval}s) ===", log_path)
    if args.disable_after_close_refresh:
        log("After-close full refresh disabled for this run.", log_path)
    else:
        log(f"After-close full refresh enabled (time={args.after_close_time}).", log_path)
    if args.force:
        log("WARNING: --force mode, trading time check disabled.", log_path)
    if args.once:
        log("Once mode: will exit after first refresh.", log_path)

    while True:
        now = datetime.now()
        date_str = now.strftime("%Y%m%d")

        if not args.force and not is_trading_time(now):
            if (
                not args.disable_after_close_refresh
                and should_run_after_close_refresh(now, args.after_close_time)
                and load_last_closing_refresh_date() != date_str
            ):
                if acquire_lock():
                    try:
                        attempt_after_close_refresh(date_str, log_path)
                    finally:
                        release_lock()
                else:
                    log(f"Skipped after-close refresh: another instance is running (lock < {LOCK_EXPIRE_SECONDS}s)", log_path)
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
            run_refresh(date_str, log_path)
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
