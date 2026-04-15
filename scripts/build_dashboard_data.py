from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


TOPICS_CSV = Path("data/ticai_extract/ticai_topics.csv")
HISTORY_CSV = Path("data/ticai_history/ticai_history.csv")
OUT_PATH = Path("web/data/dashboard.json")


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def as_float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def as_int(value: str | None) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def compact_history(rows: list[dict[str, str]], limit: int = 8) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["materialSeq"]].append(
            {
                "date": row["date"],
                "materialRate": as_float(row["materialRate"]),
                "popularValue": as_float(row["popularValue"]),
                "humanDragon": row["humanDragon"],
                "middleTroops": row["middleTroops"],
                "dayDragon": row["dayDragon"],
            }
        )

    for material_seq, items in grouped.items():
        items.sort(key=lambda item: item["date"], reverse=True)
        grouped[material_seq] = items[:limit]
    return grouped


def main() -> None:
    topics = read_csv(TOPICS_CSV)
    history = compact_history(read_csv(HISTORY_CSV))

    top10: list[dict[str, Any]] = []
    for rank, row in enumerate(topics[:10], start=1):
        material_seq = row["materialSeq"]
        top10.append(
            {
                "rank": rank,
                "materialSeq": material_seq,
                "materialName": row["materialName"],
                "limitUpStocks": as_int(row["limitUpStocks"]),
                "materialRate": as_float(row["materialRate"]),
                "popularValue": as_float(row["popularValue"]),
                "humanDragon": row["humanDragon"],
                "middleTroops": row["middleTroops"],
                "dayDragon": row["dayDragon"],
                "newEventNum": as_int(row["newEventNum"]),
                "history": history.get(material_seq, []),
            }
        )

    payload = {
        "date": "2026-04-13",
        "source": {
            "ranking": str(TOPICS_CSV),
            "history": str(HISTORY_CSV),
        },
        "top10": top10,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(top10)} rows")


if __name__ == "__main__":
    main()
