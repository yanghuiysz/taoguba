from __future__ import annotations

import csv
import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

HISTORY_URL = "https://js.tgb.cn/hangqing/ticai/taoguba/ticai_data_history.json"
MAPPING_CSV = Path("data/ticai_extract/ticai_topics.csv")
OUT_DIR = Path("data/ticai_auto")
DASHBOARD_PATH = Path("web/data/dashboard.json")
CHINA_TZ = timezone(timedelta(hours=8))


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def ms_to_date(value: int | None) -> str:
    if not value:
        return ""
    return datetime.fromtimestamp(value / 1000, tz=CHINA_TZ).strftime("%Y-%m-%d")


def stock_label(stock: dict[str, Any] | None) -> str:
    if not isinstance(stock, dict):
        return ""
    name = stock.get("s") or stock.get("stockName") or ""
    code = stock.get("f") or stock.get("fullCode") or ""
    label = stock.get("label") or ""
    text = f"{name}({code})" if name and code else (name or code)
    return f"{text} {label}".strip()


def load_dashboard_name_map(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}

    data = json.loads(path.read_text(encoding="utf-8"))
    names: dict[str, dict[str, Any]] = {}
    for row in data.get("top10", []):
        material_seq = str(row.get("materialSeq") or "")
        if not material_seq:
            continue
        names[material_seq] = {
            "materialName": row.get("materialName") or f"题材ID {material_seq}",
            "limitUpStocks": to_int(row.get("limitUpStocks")),
        }
    return names


def load_csv_name_map(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = csv.DictReader(handle)
        return {
            row["materialSeq"]: {
                "materialName": row.get("materialName") or f"题材ID {row['materialSeq']}",
                "limitUpStocks": to_int(row.get("limitUpStocks")),
            }
            for row in rows
            if row.get("materialSeq")
        }


def load_name_map(mapping_path: Path, dashboard_path: Path) -> dict[str, dict[str, Any]]:
    names = load_dashboard_name_map(dashboard_path)
    names.update(load_csv_name_map(mapping_path))
    return names


def to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def rank_value(value: Any) -> float:
    number = to_float(value)
    return -999 if number is None else number


def flatten_history(data: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for theme in data.get("list", []):
        material_seq = str(theme.get("mS"))
        rows: list[dict[str, Any]] = []
        for item in theme.get("lM", []) or []:
            rows.append(
                {
                    "materialSeq": str(item.get("mS", material_seq)),
                    "date": ms_to_date(item.get("mT")),
                    "timestamp": item.get("mT"),
                    "materialRate": to_float(item.get("mR")),
                    "popularValue": to_float(item.get("pV")),
                    "label": item.get("label"),
                    "humanDragon": stock_label(item.get("hD")),
                    "middleTroops": stock_label(item.get("mTr")),
                    "dayDragon": stock_label(item.get("dD")),
                }
            )
        rows.sort(key=lambda row: row.get("timestamp") or 0, reverse=True)
        if material_seq and rows:
            grouped[material_seq] = rows
    return grouped


def build_top10(
    grouped: dict[str, list[dict[str, Any]]],
    names: dict[str, dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    latest_timestamp = max((rows[0]["timestamp"] for rows in grouped.values() if rows), default=None)
    latest_date = ms_to_date(latest_timestamp)
    latest_rows = [rows[0] for rows in grouped.values() if rows and rows[0]["timestamp"] == latest_timestamp]
    has_popular_value = any((row.get("popularValue") or 0) != 0 for row in latest_rows)
    sort_rank_rows(latest_rows)

    top10: list[dict[str, Any]] = []
    for rank, row in enumerate(latest_rows[:10], start=1):
        material_seq = row["materialSeq"]
        meta = names.get(material_seq, {})
        top10.append(
            {
                "rank": rank,
                "materialSeq": material_seq,
                "materialName": meta.get("materialName") or f"题材ID {material_seq}",
                "limitUpStocks": meta.get("limitUpStocks"),
                "materialRate": row.get("materialRate"),
                "popularValue": row.get("popularValue") if has_popular_value else None,
                "humanDragon": row.get("humanDragon"),
                "middleTroops": row.get("middleTroops"),
                "dayDragon": row.get("dayDragon"),
                "limitUpStockNames": [row.get("dayDragon")] if row.get("dayDragon") else [],
                "limitUpStockSource": "public_history_representative",
                "newEventNum": None,
                "history": grouped.get(material_seq, [])[:8],
            }
        )
    return latest_date, top10


def sort_rank_rows(rows: list[dict[str, Any]]) -> None:
    rows.sort(key=lambda row: (rank_value(row.get("materialRate")), rank_value(row.get("popularValue"))), reverse=True)


def enrich_with_names(
    rows: list[dict[str, Any]],
    names: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for row in rows:
        material_seq = row.get("materialSeq")
        meta = names.get(material_seq, {})
        enriched.append(
            {
                "materialName": meta.get("materialName") or f"题材ID {material_seq}",
                "limitUpStocks": meta.get("limitUpStocks"),
                **row,
            }
        )
    return enriched


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    names = load_name_map(MAPPING_CSV, DASHBOARD_PATH)
    raw = fetch_json(HISTORY_URL)
    grouped = flatten_history(raw)
    latest_date, top10 = build_top10(grouped, names)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    all_latest = [rows[0] for rows in grouped.values() if rows]
    sort_rank_rows(all_latest)
    write_csv(OUT_DIR / "latest_rank.csv", enrich_with_names(all_latest, names))
    (OUT_DIR / "ticai_data_history_raw.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    payload = {
        "date": latest_date,
        "source": {
            "ranking": "public static history ranked by materialRate",
            "history": HISTORY_URL,
            "nameMapping": str(MAPPING_CSV),
        },
        "top10": top10,
    }
    DASHBOARD_PATH.parent.mkdir(parents=True, exist_ok=True)
    DASHBOARD_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {DASHBOARD_PATH} for {latest_date} with {len(top10)} rows")


if __name__ == "__main__":
    main()
