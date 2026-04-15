from __future__ import annotations

import argparse
import csv
import json
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


KPL_API_URL = "https://apphq.longhuvip.com/w1/api/index.php"
OUT_DIR = Path("data/kpl_probe")

# This probe only calls endpoints that are reachable without account cookies or
# device secrets. Keep captured private headers/tokens out of this repository.
REAL_RANKING_FORM = {
    "a": "RealRankingInfo_W8",
    "c": "NewStockRanking",
    "Order": "1",
    "st": "26",
    "index": "0",
    "PhoneOSNew": "1",
    "VerSion": "5.15.0.5",
    "apiv": "w39",
    "Type": "6",
}

PLATE_RANKING_FORM = {
    "a": "RealRankingInfo",
    "c": "ZhiShuRanking",
    "Index": "0",
    "Order": "1",
    "st": "80",
    "PhoneOSNew": "2",
    "VerSion": "5.11.0.1",
    "apiv": "w33",
    "Type": "1",
    "ZSType": "7",
}


def fetch_form(url: str, form: dict[str, str]) -> dict[str, Any]:
    body = urllib.parse.urlencode(form).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 6.0.1; MuMu Build/V417IR)",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def row_value(row: list[Any], index: int, default: Any = None) -> Any:
    return row[index] if index < len(row) else default


def normalize_real_ranking(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payload.get("list", [])
    normalized: list[dict[str, Any]] = []
    for rank, row in enumerate(rows, start=1):
        if not isinstance(row, list):
            continue
        normalized.append(
            {
                "rank": rank,
                "code": row_value(row, 0, ""),
                "name": row_value(row, 1, ""),
                "concepts": row_value(row, 4, ""),
                "latest_price": row_value(row, 5),
                "change_percent": row_value(row, 6),
                "amount": row_value(row, 7),
                "turnover_rate": row_value(row, 8),
                "board_label": row_value(row, 23, ""),
                "industry": row_value(row, 39, ""),
                "raw_columns": len(row),
            }
        )
    return normalized


def normalize_limit_up_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    limit_rows: list[dict[str, Any]] = []
    for row in rows:
        board_label = str(row.get("board_label") or "")
        if "板" not in board_label:
            continue
        limit_rows.append(
            {
                "rank": row.get("rank"),
                "code": row.get("code"),
                "name": row.get("name"),
                "board_label": board_label,
                "reason_tags": row.get("concepts"),
                "latest_price": row.get("latest_price"),
                "change_percent": row.get("change_percent"),
                "amount": row.get("amount"),
                "turnover_rate": row.get("turnover_rate"),
                "industry": row.get("industry"),
            }
        )
    return limit_rows


def normalize_plate_ranking(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payload.get("list", [])
    normalized: list[dict[str, Any]] = []
    for rank, row in enumerate(rows, start=1):
        if not isinstance(row, list):
            continue
        normalized.append(
            {
                "rank": rank,
                "plate_code": row_value(row, 0, ""),
                "plate_name": row_value(row, 1, ""),
                "strength": row_value(row, 2),
                "speed": row_value(row, 3),
                "change_percent": row_value(row, 4),
                "amount": row_value(row, 5),
                "main_net_amount": row_value(row, 6),
                "main_buy_amount": row_value(row, 7),
                "main_sell_amount": row_value(row, 8),
                "volume_ratio": row_value(row, 9),
                "float_market_value": row_value(row, 10),
                "large_order_net_amount": row_value(row, 12),
                "raw_columns": len(row),
            }
        )
    return normalized


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
    parser = argparse.ArgumentParser(description="Probe public Kaipanla app JSON endpoints.")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--date", default=datetime.now().strftime("%Y%m%d"))
    args = parser.parse_args()

    out_dir = args.out_dir / args.date
    out_dir.mkdir(parents=True, exist_ok=True)

    real_ranking = fetch_form(KPL_API_URL, REAL_RANKING_FORM)
    real_rows = normalize_real_ranking(real_ranking)
    limit_rows = normalize_limit_up_rows(real_rows)
    (out_dir / "real_ranking_raw.json").write_text(
        json.dumps(real_ranking, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(out_dir / "real_ranking.csv", real_rows)
    write_csv(out_dir / "limit_up_candidates.csv", limit_rows)

    plate_ranking = fetch_form(KPL_API_URL, PLATE_RANKING_FORM)
    plate_rows = normalize_plate_ranking(plate_ranking)
    (out_dir / "plate_ranking_raw.json").write_text(
        json.dumps(plate_ranking, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(out_dir / "plate_ranking.csv", plate_rows)

    print(f"Fetched {len(real_rows)} KPL stock ranking rows")
    print(f"Extracted {len(limit_rows)} KPL limit-up candidate rows")
    print(f"Fetched {len(plate_rows)} KPL plate ranking rows")
    print(f"Wrote {out_dir / 'real_ranking_raw.json'}")
    print(f"Wrote {out_dir / 'real_ranking.csv'}")
    print(f"Wrote {out_dir / 'limit_up_candidates.csv'}")
    print(f"Wrote {out_dir / 'plate_ranking_raw.json'}")
    print(f"Wrote {out_dir / 'plate_ranking.csv'}")


if __name__ == "__main__":
    main()
