from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable

KPL_DASHBOARD = ROOT / "web/data/kpl_dashboard.json"
KPL_HISTORY_DIR = ROOT / "web/data/kpl/history"


def run_script(args: list[str]) -> None:
    command = [PYTHON, *args]
    print(f"\n> {' '.join(command)}")
    subprocess.run(command, cwd=ROOT, check=True)


def compact_date(value: str) -> str:
    return value.replace("-", "")


def format_date(value: str) -> str:
    if len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return value


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
    parser.add_argument("--sort-by", default="strength", help="Kaipanla plate sort key.")
    args = parser.parse_args()

    if not args.skip_kpl:
        run_script(["scripts/fetch_kpl_probe.py", "--date", args.date])
        run_script(["scripts/build_kpl_plate_stock_links.py", "--date", args.date, "--sort-by", args.sort_by])
        run_script(["scripts/build_kpl_web_data.py", "--date", args.date])
        if not args.skip_external:
            run_script(["scripts/build_ths_limit_mapping.py", "--date", args.date])
        verify_kpl_history(args.date)

    if not args.skip_custom:
        run_script(["scripts/build_custom_board_data.py", "--date", args.date])

    print("\nDaily data update complete.")


if __name__ == "__main__":
    main()
