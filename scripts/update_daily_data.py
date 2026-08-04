from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable

CUSTOM_DASHBOARD = ROOT / "web/data/custom_boards.json"
FULL_A_TURNOVER = ROOT / "web/data/full_a_turnover_top20.json"
CUSTOM_HISTORY_DIR = ROOT / "web/data/custom_boards/history"
CUSTOM_INTRADAY_DIR = ROOT / "web/data/custom_boards/intraday"
CUSTOM_HISTORY_INDEX = ROOT / "web/data/custom_boards/index.json"


def run_script(args: list[str]) -> None:
    command = [PYTHON, *args]
    print(f"\n> {' '.join(command)}", flush=True)
    start = time.perf_counter()
    try:
        subprocess.run(command, cwd=ROOT, check=True)
    finally:
        elapsed = time.perf_counter() - start
        print(f"< completed in {elapsed:.1f}s: {' '.join(args)}", flush=True)


def has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def missing_modules(names: list[str]) -> list[str]:
    return [name for name in names if not has_module(name)]


def run_optional(args: list[str], output_path: Path | None = None) -> bool:
    try:
        run_script(args)
        return True
    except subprocess.CalledProcessError as exc:
        print(f"\nWARNING: optional step failed with exit code {exc.returncode}: {' '.join(args)}", file=sys.stderr, flush=True)
        if output_path and output_path.exists():
            print(f"Keeping existing data file: {output_path}", file=sys.stderr, flush=True)
            return False
        raise


def skip_optional_for_missing_modules(step_name: str, modules: list[str], output_path: Path) -> bool:
    missing = missing_modules(modules)
    if not missing:
        return False
    print(
        f"\nWARNING: skipping optional {step_name}; missing Python module(s): {', '.join(missing)}",
        file=sys.stderr,
        flush=True,
    )
    if output_path.exists():
        print(f"Keeping existing data file: {output_path}", file=sys.stderr, flush=True)
    return True


def compact_date(value: str) -> str:
    return value.replace("-", "")


def format_date(value: str) -> str:
    if len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return value


def is_today(value: str, now: datetime | None = None) -> bool:
    now = now or datetime.now()
    return compact_date(format_date(value)) == now.strftime("%Y%m%d")


def is_trading_time(now: datetime | None = None) -> bool:
    now = now or datetime.now()
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return (9 * 60 + 30 <= minutes <= 11 * 60 + 30) or (13 * 60 <= minutes <= 15 * 60 + 5)


def custom_history_path_for_date(directory: Path, date: str) -> Path:
    return directory / f"{compact_date(format_date(date))}.json"


def custom_history_web_path(date: str) -> str:
    return f"./data/custom_boards/history/{compact_date(format_date(date))}.json"


def load_json(path: Path, fallback: object) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def archive_intraday_fallback(date: str) -> bool:
    formatted_date = format_date(date)
    history_path = custom_history_path_for_date(CUSTOM_HISTORY_DIR, formatted_date)
    if history_path.exists():
        return False

    intraday_path = custom_history_path_for_date(CUSTOM_INTRADAY_DIR, formatted_date)
    payload = load_json(intraday_path, None)
    if not isinstance(payload, dict):
        return False

    payload["date"] = formatted_date
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    payload["source"] = {**source, "snapshotKind": "intraday-fallback"}
    CUSTOM_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")

    index = load_json(CUSTOM_HISTORY_INDEX, {})
    existing_items = index.get("items") if isinstance(index, dict) else []
    items = {
        str(item.get("date")): item
        for item in existing_items
        if isinstance(item, dict) and item.get("date") and item.get("path")
    }
    items[formatted_date] = {"date": formatted_date, "path": custom_history_web_path(formatted_date)}
    ordered = [items[key] for key in sorted(items, reverse=True)]
    index_payload = {"latest": ordered[0]["date"] if ordered else formatted_date, "items": ordered}
    CUSTOM_HISTORY_INDEX.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_HISTORY_INDEX.write_text(json.dumps(index_payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Update custom board daily data snapshots.")
    parser.add_argument("--date", default=datetime.now().strftime("%Y%m%d"), help="Trading date, e.g. 20260415.")
    parser.add_argument("--skip-external", action="store_true", default=True, help="Skip Tonghuashun/Eastmoney external mapping (default: skipped).")
    parser.add_argument("--skip-custom", action="store_true", help="Skip custom board average history update.")
    parser.add_argument("--intraday-custom", action="store_true", help="Overlay realtime spot quotes into custom board data.")
    parser.add_argument("--custom-sleep", type=float, default=0.2, help="Delay between custom stock history requests.")
    parser.add_argument("--strict-external", action="store_true", help="Fail the run when optional external mapping fails.")
    parser.add_argument("--strict-custom", action="store_true", help="Fail the run when custom board rebuild fails.")
    parser.add_argument("--intraday-radar-only", action="store_true", help="Only refresh custom-board intraday data used by the intraday radar.")
    parser.add_argument("--full-during-trading", action="store_true", help="Run the full update even when the target date is today during trading hours.")
    args = parser.parse_args()

    target_is_today = is_today(args.date)
    if not target_is_today and (args.intraday_custom or args.intraday_radar_only):
        print(
            f"\nWARNING: intraday refresh flags are ignored for historical date {format_date(args.date)}; "
            "using historical daily data instead.",
            file=sys.stderr,
            flush=True,
        )
        args.intraday_custom = False
        args.intraday_radar_only = False

    radar_only = args.intraday_radar_only or (
        target_is_today
        and is_trading_time()
        and not args.full_during_trading
    )
    if radar_only:
        print("\nIntraday radar refresh mode: updating custom-board realtime data only.", flush=True)
        args.skip_external = True
        args.skip_custom = False
        args.intraday_custom = True

    if not args.skip_custom:
        custom_args = ["scripts/build_custom_board_data.py", "--date", args.date, "--sleep", str(args.custom_sleep)]
        if radar_only:
            custom_args.append("--intraday-fast")
        if args.intraday_custom:
            custom_args.append("--intraday")
        if args.intraday_custom and target_is_today and is_trading_time():
            custom_args.append("--intraday-output")
        custom_rebuilt = True
        if args.strict_custom:
            run_script(custom_args)
        elif skip_optional_for_missing_modules("custom board rebuild", ["akshare"], CUSTOM_DASHBOARD):
            custom_rebuilt = False
        else:
            custom_rebuilt = run_optional(custom_args, CUSTOM_DASHBOARD)
        if not custom_rebuilt and archive_intraday_fallback(args.date):
            print(
                f"Archived intraday fallback for {format_date(args.date)} because full custom board rebuild failed.",
                flush=True,
            )
    elif not CUSTOM_DASHBOARD.exists():
        raise FileNotFoundError(f"Custom dashboard data is missing: {CUSTOM_DASHBOARD}")

    should_refresh_full_a_turnover = target_is_today
    if should_refresh_full_a_turnover:
        if args.strict_custom:
            run_script(["scripts/build_full_a_turnover_top20.py", "--date", args.date])
        else:
            run_optional(["scripts/build_full_a_turnover_top20.py", "--date", args.date], FULL_A_TURNOVER)
    else:
        print("\nSkipping full-A turnover top20 refresh for historical date.", flush=True)

    run_script(["scripts/validate_web_data.py"])

    print("\nDaily data update complete.")


if __name__ == "__main__":
    main()
