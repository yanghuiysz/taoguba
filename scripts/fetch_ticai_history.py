from __future__ import annotations

import argparse
import csv
import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


HISTORY_URL = "https://js.tgb.cn/hangqing/ticai/taoguba/ticai_data_history.json"


def stock_label(stock: dict[str, Any] | None) -> str:
    if not isinstance(stock, dict):
        return ""
    code = stock.get("f") or stock.get("fullCode") or ""
    name = stock.get("s") or stock.get("stockName") or ""
    if code and name:
        return f"{name}({code})"
    return name or code


def stock_return(stock: dict[str, Any] | None, key: str) -> Any:
    if not isinstance(stock, dict):
        return None
    return stock.get(key)


def ms_to_date(value: int | None) -> str:
    if not value:
        return ""
    china_tz = timezone(timedelta(hours=8))
    return datetime.fromtimestamp(value / 1000, tz=china_tz).strftime("%Y-%m-%d")


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def flatten_history(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for theme in data.get("list", []):
        material_seq = theme.get("mS")
        for item in theme.get("lM", []) or []:
            human_dragon = item.get("hD")
            middle_troops = item.get("mTr")
            day_dragon = item.get("dD")
            rows.append(
                {
                    "materialSeq": item.get("mS", material_seq),
                    "date": ms_to_date(item.get("mT")),
                    "timestamp": item.get("mT"),
                    "materialRate": item.get("mR"),
                    "popularValue": item.get("pV"),
                    "label": item.get("label"),
                    "humanDragon": stock_label(human_dragon),
                    "humanDragon_p5": stock_return(human_dragon, "p5"),
                    "humanDragon_p10": stock_return(human_dragon, "p10"),
                    "humanDragon_p20": stock_return(human_dragon, "p20"),
                    "middleTroops": stock_label(middle_troops),
                    "middleTroops_p5": stock_return(middle_troops, "p5"),
                    "middleTroops_p10": stock_return(middle_troops, "p10"),
                    "middleTroops_p20": stock_return(middle_troops, "p20"),
                    "dayDragon": stock_label(day_dragon),
                    "dayDragon_p5": stock_return(day_dragon, "p5"),
                    "dayDragon_p10": stock_return(day_dragon, "p10"),
                    "dayDragon_p20": stock_return(day_dragon, "p20"),
                }
            )
    return rows


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
    parser = argparse.ArgumentParser(description="Fetch public Taoguba topic/theme history JSON.")
    parser.add_argument("--url", default=HISTORY_URL)
    parser.add_argument("--out-dir", type=Path, default=Path("data/ticai_history"))
    args = parser.parse_args()

    data = fetch_json(args.url)
    rows = flatten_history(data)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "ticai_data_history_raw.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (args.out_dir / "ticai_history.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(args.out_dir / "ticai_history.csv", rows)

    print(f"Fetched {len(data.get('list', []))} themes")
    print(f"Wrote {len(rows)} history rows to {args.out_dir}")


if __name__ == "__main__":
    main()
