from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


LINKED_DIR = Path("data/kpl_linked")
OUT_PATH = Path("web/data/kpl_dashboard.json")
HISTORY_DIR = Path("web/data/kpl/history")
INDEX_PATH = Path("web/data/kpl/index.json")


def latest_date_dir(base_dir: Path) -> Path:
    candidates = [path for path in base_dir.iterdir() if path.is_dir()]
    if not candidates:
        raise FileNotFoundError(f"No linked KPL data folders found under {base_dir}")
    return sorted(candidates, key=lambda path: path.name)[-1]


def format_date(value: str) -> str:
    if len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return value


def compact_date(value: str) -> str:
    return value.replace("-", "")


def load_linked(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_existing_history(history_dir: Path) -> list[dict[str, Any]]:
    if not history_dir.exists():
        return []
    items: list[dict[str, Any]] = []
    for path in sorted(history_dir.glob("*.json")):
        try:
            items.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return items


def attach_plate_trends(payload: dict[str, Any], history_items: list[dict[str, Any]], days: int = 15) -> None:
    history_by_date: dict[str, dict[str, Any]] = {}
    for item in history_items + [payload]:
        date = item.get("date")
        if date:
            history_by_date[str(date)] = item

    ordered = [history_by_date[date] for date in sorted(history_by_date.keys())][-days:]
    trend_map: dict[str, list[dict[str, Any]]] = {}
    for item in ordered:
        date = item.get("date")
        for plate in item.get("plates", []):
            code = plate.get("plateCode")
            if not code:
                continue
            trend_map.setdefault(code, []).append(
                {
                    "date": date,
                    "change": plate.get("changePercent"),
                    "strength": plate.get("strength"),
                    "limitUps": len(plate.get("limitUpStocks", [])),
                }
            )

    for plate in payload.get("plates", []):
        plate["trend"] = trend_map.get(plate.get("plateCode"), [])


def build_payload(linked: dict[str, Any]) -> dict[str, Any]:
    plates = linked.get("plates", [])
    return {
        "date": format_date(str(linked.get("date", ""))),
        "sortBy": linked.get("sortBy", "strength"),
        "source": {
            "name": "Kaipanla",
            "kind": "public legacy app endpoint probe",
            "note": "Only fields returned by the reachable Kaipanla endpoints are shown.",
        },
        "availableFields": [
            "plate strength",
            "plate speed",
            "plate change percent",
            "plate amount",
            "main net amount",
            "large order net amount",
            "limit-up/board label",
            "stock reason tags",
            "stock change percent",
            "stock amount",
            "stock turnover rate",
        ],
        "unavailableFields": [
            "intraday plate trend from Kaipanla",
            "limit-up hit time",
            "first limit-up time",
            "seal ratio",
            "full long-form limit-up reason",
        ],
        "summary": {
            "plateCount": len(plates),
            "linkedPlateCount": sum(1 for plate in plates if plate.get("limitUpStocks") or plate.get("strongStocks")),
            "limitUpStockCount": sum(len(plate.get("limitUpStocks", [])) for plate in plates),
            "strongStockCount": sum(len(plate.get("strongStocks", [])) for plate in plates),
        },
        "plates": plates,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build web-facing KPL dashboard JSON.")
    parser.add_argument("--date", help="Date folder such as 20260415. Defaults to latest folder.")
    parser.add_argument("--linked-dir", type=Path, default=LINKED_DIR)
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--history-dir", type=Path, default=HISTORY_DIR)
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    args = parser.parse_args()

    date_dir = args.linked_dir / args.date if args.date else latest_date_dir(args.linked_dir)
    linked_path = date_dir / "plate_stock_links.json"
    linked = load_linked(linked_path)
    payload = build_payload(linked)
    history_items = load_existing_history(args.history_dir)
    attach_plate_trends(payload, history_items)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    args.history_dir.mkdir(parents=True, exist_ok=True)
    history_path = args.history_dir / f"{compact_date(payload['date'])}.json"
    history_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    history_items = []
    for path in sorted(args.history_dir.glob("*.json"), reverse=True):
        if path.name == "index.json":
            continue
        item = json.loads(path.read_text(encoding="utf-8"))
        history_items.append(
            {
                "date": item.get("date", path.stem),
                "path": f"./data/kpl/history/{path.name}",
                "summary": item.get("summary", {}),
            }
        )
    args.index.parent.mkdir(parents=True, exist_ok=True)
    args.index.write_text(
        json.dumps({"latest": payload["date"], "items": history_items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {args.out} from {linked_path}")
    print(f"Wrote {history_path}")
    print(f"Wrote {args.index}")
    print(
        "Plates: {plateCount}, linked: {linkedPlateCount}, limit-up: {limitUpStockCount}, strong: {strongStockCount}".format(
            **payload["summary"]
        )
    )


if __name__ == "__main__":
    main()
