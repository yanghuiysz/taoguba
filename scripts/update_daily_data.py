from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable

TAOGUBA_DASHBOARD = ROOT / "web/data/dashboard.json"
TAOGUBA_HISTORY_DIR = ROOT / "web/data/taoguba/history"
TAOGUBA_INDEX = ROOT / "web/data/taoguba/index.json"

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


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def archive_taoguba_dashboard() -> None:
    if not TAOGUBA_DASHBOARD.exists():
        print(f"Skip Taoguba archive: {TAOGUBA_DASHBOARD} does not exist")
        return

    payload = load_json(TAOGUBA_DASHBOARD)
    date = str(payload.get("date") or datetime.now().strftime("%Y-%m-%d"))
    history_path = TAOGUBA_HISTORY_DIR / f"{compact_date(date)}.json"
    write_json(history_path, payload)

    items: list[dict[str, Any]] = []
    for path in sorted(TAOGUBA_HISTORY_DIR.glob("*.json"), reverse=True):
        item = load_json(path)
        items.append(
            {
                "date": item.get("date", format_date(path.stem)),
                "path": f"./data/taoguba/history/{path.name}",
                "summary": {
                    "topCount": len(item.get("top10", [])),
                    "source": item.get("source", {}),
                },
            }
        )
    write_json(TAOGUBA_INDEX, {"latest": date, "items": items})
    print(f"Archived Taoguba dashboard to {history_path}")
    print(f"Updated {TAOGUBA_INDEX}")


def verify_kpl_history(date: str) -> None:
    history_path = KPL_HISTORY_DIR / f"{compact_date(format_date(date))}.json"
    if history_path.exists():
        print(f"KPL history saved at {history_path}")
    elif KPL_DASHBOARD.exists():
        print(f"KPL dashboard updated at {KPL_DASHBOARD}, but dated history was not found: {history_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Update Taoguba and Kaipanla daily data snapshots.")
    parser.add_argument("--date", default=datetime.now().strftime("%Y%m%d"), help="Trading date, e.g. 20260415.")
    parser.add_argument("--skip-taoguba", action="store_true", help="Skip Taoguba public history update.")
    parser.add_argument("--skip-kpl", action="store_true", help="Skip Kaipanla public endpoint update.")
    parser.add_argument("--skip-external", action="store_true", help="Skip Tonghuashun/Eastmoney external mapping.")
    parser.add_argument("--sort-by", default="strength", help="Kaipanla plate sort key.")
    args = parser.parse_args()

    if not args.skip_taoguba:
        run_script(["scripts/update_dashboard_auto.py"])
        archive_taoguba_dashboard()

    if not args.skip_kpl:
        run_script(["scripts/fetch_kpl_probe.py", "--date", args.date])
        run_script(["scripts/build_kpl_plate_stock_links.py", "--date", args.date, "--sort-by", args.sort_by])
        run_script(["scripts/build_kpl_web_data.py", "--date", args.date])
        if not args.skip_external:
            run_script(["scripts/build_ths_limit_mapping.py", "--date", args.date])
        verify_kpl_history(args.date)

    print("\nDaily data update complete.")


if __name__ == "__main__":
    main()
