from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


IN_DIR = Path("data/kpl_probe")
OUT_DIR = Path("data/kpl_linked")


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def split_concepts(value: str) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.replace("，", "、").split("、") if item.strip()]


def to_float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def to_int(value: str | None) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def stock_payload(row: dict[str, str], match_type: str) -> dict[str, Any]:
    return {
        "rank": to_int(row.get("rank")),
        "code": row.get("code", ""),
        "name": row.get("name", ""),
        "boardLabel": row.get("board_label", ""),
        "reasonTags": row.get("reason_tags") or row.get("concepts", ""),
        "latestPrice": to_float(row.get("latest_price")),
        "changePercent": to_float(row.get("change_percent")),
        "amount": to_float(row.get("amount")),
        "turnoverRate": to_float(row.get("turnover_rate")),
        "industry": row.get("industry", ""),
        "matchType": match_type,
    }


def link_rows(
    plates: list[dict[str, str]],
    strong_rows: list[dict[str, str]],
    limit_rows: list[dict[str, str]],
    sort_by: str,
) -> list[dict[str, Any]]:
    strong_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    limit_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in strong_rows:
        for name in {row.get("industry", ""), *split_concepts(row.get("concepts", ""))}:
            if name:
                strong_by_name[name].append(stock_payload(row, "industry_or_concept"))

    for row in limit_rows:
        for name in {row.get("industry", ""), *split_concepts(row.get("reason_tags", ""))}:
            if name:
                limit_by_name[name].append(stock_payload(row, "industry_or_reason_tag"))

    linked: list[dict[str, Any]] = []
    sorted_plates = sorted(
        plates,
        key=lambda row: to_float(row.get(sort_by)) if to_float(row.get(sort_by)) is not None else -999999,
        reverse=True,
    )

    for rank, plate in enumerate(sorted_plates, start=1):
        plate_name = plate.get("plate_name", "")
        linked.append(
            {
                "rank": rank,
                "sourceRank": to_int(plate.get("rank")),
                "plateCode": plate.get("plate_code", ""),
                "plateName": plate_name,
                "strength": to_float(plate.get("strength")),
                "speed": to_float(plate.get("speed")),
                "changePercent": to_float(plate.get("change_percent")),
                "amount": to_float(plate.get("amount")),
                "mainNetAmount": to_float(plate.get("main_net_amount")),
                "largeOrderNetAmount": to_float(plate.get("large_order_net_amount")),
                "limitUpStocks": limit_by_name.get(plate_name, []),
                "strongStocks": strong_by_name.get(plate_name, []),
            }
        )
    return linked


def write_flat_csv(path: Path, linked: list[dict[str, Any]]) -> None:
    rows: list[dict[str, Any]] = []
    for plate in linked:
        for group_name, stocks in (("limit_up", plate["limitUpStocks"]), ("strong", plate["strongStocks"])):
            for stock in stocks:
                rows.append(
                    {
                        "plate_rank": plate["rank"],
                        "plate_code": plate["plateCode"],
                        "plate_name": plate["plateName"],
                        "plate_strength": plate["strength"],
                        "group": group_name,
                        "stock_rank": stock["rank"],
                        "stock_code": stock["code"],
                        "stock_name": stock["name"],
                        "board_label": stock["boardLabel"],
                        "reason_tags": stock["reasonTags"],
                        "change_percent": stock["changePercent"],
                        "industry": stock["industry"],
                    }
                )
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Link KPL plates with limit-up and strong stocks.")
    parser.add_argument("--date", required=True, help="Date folder such as 20260415")
    parser.add_argument("--in-dir", type=Path, default=IN_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument(
        "--sort-by",
        choices=("strength", "change_percent", "speed", "main_net_amount", "large_order_net_amount"),
        default="strength",
        help="Plate sort key for linked output.",
    )
    args = parser.parse_args()

    source_dir = args.in_dir / args.date
    plates = read_csv(source_dir / "plate_ranking.csv")
    strong_rows = read_csv(source_dir / "real_ranking.csv")
    limit_rows = read_csv(source_dir / "limit_up_candidates.csv")
    linked = link_rows(plates, strong_rows, limit_rows, args.sort_by)

    out_dir = args.out_dir / args.date
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "plate_stock_links.json").write_text(
        json.dumps({"date": args.date, "sortBy": args.sort_by, "plates": linked}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_flat_csv(out_dir / "plate_stock_links.csv", linked)

    matched_plates = sum(1 for plate in linked if plate["limitUpStocks"] or plate["strongStocks"])
    print(f"Linked {matched_plates}/{len(linked)} KPL plates")
    print(f"Wrote {out_dir / 'plate_stock_links.json'}")
    print(f"Wrote {out_dir / 'plate_stock_links.csv'}")


if __name__ == "__main__":
    main()
