from __future__ import annotations

import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable


def is_weekday(now: datetime) -> bool:
    return now.weekday() < 5


def is_trading_time(now: datetime) -> bool:
    minutes = now.hour * 60 + now.minute
    return (9 * 60 + 30 <= minutes <= 11 * 60 + 30) or (13 * 60 <= minutes <= 15 * 60 + 5)


def is_after_close(now: datetime) -> bool:
    return is_weekday(now) and not is_trading_time(now) and (now.hour * 60 + now.minute) > (15 * 60 + 5)


def run_script(args: list[str]) -> None:
    command = [PYTHON, *args]
    print(f"\n> {' '.join(command)}", flush=True)
    start = time.perf_counter()
    try:
        subprocess.run(command, cwd=ROOT, check=True)
    finally:
        elapsed = time.perf_counter() - start
        print(f"< completed in {elapsed:.1f}s: {' '.join(args)}", flush=True)


def main() -> None:
    now = datetime.now()
    if not is_after_close(now):
        print("Skip: not in post-close window.", flush=True)
        return

    date_str = now.strftime("%Y%m%d")
    print(f"Post-close detected, refreshing latest data for {date_str}.", flush=True)
    run_script(["scripts/update_daily_data.py", "--date", date_str, "--intraday-custom"])
    run_script(["scripts/validate_web_data.py"])
    print("Post-close refresh complete.", flush=True)


if __name__ == "__main__":
    main()
