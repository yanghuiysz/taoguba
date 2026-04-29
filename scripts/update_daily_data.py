from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable

KPL_DASHBOARD = ROOT / "web/data/kpl_dashboard.json"
KPL_HISTORY_DIR = ROOT / "web/data/kpl/history"
CUSTOM_DASHBOARD = ROOT / "web/data/custom_boards.json"


def run_script(args: list[str]) -> None:
    command = [PYTHON, *args]
    print(f"\n> {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


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


def verify_kpl_history(date: str) -> None:
    history_path = KPL_HISTORY_DIR / f"{compact_date(format_date(date))}.json"
    if history_path.exists():
        print(f"KPL history saved at {history_path}")
    elif KPL_DASHBOARD.exists():
        print(f"KPL dashboard updated at {KPL_DASHBOARD}, but dated history was not found: {history_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Update Kaipanla and custom board daily data snapshots.")
    parser.add_argument("--date", default=datetime.now().strftime("%Y%m%d"), help="Trading date, e.g. 20260415.")
    parser.add_argument("--skip-kpl", action="store_true", help="Skip Kaipanla public endpoint update.")
    parser.add_argument("--skip-external", action="store_true", help="Skip Tonghuashun/Eastmoney external mapping.")
    parser.add_argument("--skip-custom", action="store_true", help="Skip custom board average history update.")
    parser.add_argument("--intraday-custom", action="store_true", help="Overlay realtime spot quotes into custom board data.")
    parser.add_argument("--custom-sleep", type=float, default=0.2, help="Delay between custom stock history requests.")
    parser.add_argument("--strict-external", action="store_true", help="Fail the run when optional external mapping fails.")
    parser.add_argument("--strict-custom", action="store_true", help="Fail the run when custom board rebuild fails.")
    parser.add_argument("--intraday-radar-only", action="store_true", help="Only refresh custom-board intraday data used by the intraday radar.")
    parser.add_argument("--full-during-trading", action="store_true", help="Run the full update even when the target date is today during trading hours.")
    parser.add_argument("--sort-by", default="strength", help="Kaipanla plate sort key.")
    args = parser.parse_args()

    radar_only = args.intraday_radar_only or (
        is_today(args.date)
        and is_trading_time()
        and not args.full_during_trading
    )
    if radar_only:
        print("\nIntraday radar refresh mode: updating custom-board realtime data only.", flush=True)
        args.skip_kpl = True
        args.skip_external = True
        args.skip_custom = False
        args.intraday_custom = True

    if not args.skip_kpl:
        run_script(["scripts/fetch_kpl_probe.py", "--date", args.date])
        run_script(["scripts/build_kpl_plate_stock_links.py", "--date", args.date, "--sort-by", args.sort_by])
        run_script(["scripts/build_kpl_web_data.py", "--date", args.date])
        if not args.skip_external:
            external_args = ["scripts/build_ths_limit_mapping.py", "--date", args.date]
            if args.strict_external:
                run_script(external_args)
            elif not skip_optional_for_missing_modules("external limit-up mapping", ["akshare", "bs4", "requests"], KPL_DASHBOARD):
                run_optional(external_args, KPL_DASHBOARD)
        verify_kpl_history(args.date)

    if not args.skip_custom:
        custom_args = ["scripts/build_custom_board_data.py", "--date", args.date, "--sleep", str(args.custom_sleep)]
        if radar_only:
            custom_args.append("--intraday-fast")
        if args.intraday_custom:
            custom_args.append("--intraday")
        if args.strict_custom:
            run_script(custom_args)
        elif not skip_optional_for_missing_modules("custom board rebuild", ["akshare"], CUSTOM_DASHBOARD):
            run_optional(custom_args, CUSTOM_DASHBOARD)
    elif not CUSTOM_DASHBOARD.exists():
        raise FileNotFoundError(f"Custom dashboard data is missing: {CUSTOM_DASHBOARD}")

    run_script(["scripts/validate_web_data.py"])

    print("\nDaily data update complete.")


if __name__ == "__main__":
    main()
