from __future__ import annotations

import json
from datetime import datetime, time
from pathlib import Path
from typing import Any, Callable

import akshare as ak


SOURCE_NAME = "ths_stock_fund_flow_individual"


def format_trade_date(value: str) -> str:
    text = str(value or "").strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    return text


def parse_amount_yuan(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "").replace(" ", "")
    if not text or text.lower() in {"--", "-", "none", "nan"}:
        return None
    multiplier = 1.0
    if text.endswith("亿"):
        multiplier = 100_000_000.0
        text = text[:-1]
    elif text.endswith("万"):
        multiplier = 10_000.0
        text = text[:-1]
    try:
        return float(text) * multiplier
    except ValueError:
        return None


def normalize_code(value: Any) -> str:
    digits = "".join(char for char in str(value or "") if char.isdigit())
    return digits[-6:].zfill(6) if digits else ""


def normalize_ths_rows(records: list[dict[str, Any]], trade_date: str) -> list[dict[str, Any]]:
    formatted_date = format_trade_date(trade_date)
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for record in records:
        code = normalize_code(record.get("股票代码"))
        net = parse_amount_yuan(record.get("净额"))
        if not code or code in seen or net is None:
            continue
        seen.add(code)
        normalized.append(
            {
                "date": formatted_date,
                "code": code,
                "name": str(record.get("股票简称") or code),
                "inflow": parse_amount_yuan(record.get("流入资金")),
                "outflow": parse_amount_yuan(record.get("流出资金")),
                "mainNetInflow": net,
                "turnover": parse_amount_yuan(record.get("成交额")),
                "source": SOURCE_NAME,
            }
        )
    return normalized


def fetch_ths_records() -> list[dict[str, Any]]:
    frame = ak.stock_fund_flow_individual(symbol="即时")
    return frame.to_dict(orient="records")


def snapshot_path(root: Path, trade_date: str) -> Path:
    return root / format_trade_date(trade_date).replace("-", "") / "all.json"


def snapshot_is_valid(
    payload: dict[str, Any], trade_date: str, minimum_rows: int = 3000
) -> bool:
    formatted_date = format_trade_date(trade_date)
    rows = payload.get("rows")
    if (
        payload.get("date") != formatted_date
        or payload.get("source") != SOURCE_NAME
        or not isinstance(rows, list)
        or len(rows) < minimum_rows
    ):
        return False
    codes = [normalize_code(row.get("code")) for row in rows]
    return all(codes) and len(codes) == len(set(codes))


def load_or_fetch_snapshot(
    trade_date: str,
    root: Path,
    fetcher: Callable[[], list[dict[str, Any]]] = fetch_ths_records,
    force: bool = False,
    minimum_rows: int = 3000,
    today: str | None = None,
    now: str | None = None,
) -> dict[str, Any]:
    formatted_date = format_trade_date(trade_date)
    path = snapshot_path(root, formatted_date)
    captured_at = datetime.fromisoformat(now) if now else datetime.now()
    if path.exists() and not force:
        try:
            cached = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            cached = None
        if (
            isinstance(cached, dict)
            and snapshot_is_valid(cached, formatted_date, minimum_rows)
            and cached.get("marketClosed") is True
        ):
            return cached

    current_date = format_trade_date(today or captured_at.date().isoformat())
    if formatted_date != current_date:
        raise ValueError(
            f"historical THS snapshot is missing for {formatted_date}; live data is {current_date}"
        )

    rows = normalize_ths_rows(fetcher(), formatted_date)
    payload = {
        "date": formatted_date,
        "source": SOURCE_NAME,
        "capturedAt": captured_at.isoformat(timespec="seconds"),
        "marketClosed": captured_at.time() >= time(15, 5),
        "rows": rows,
    }
    if not snapshot_is_valid(payload, formatted_date, minimum_rows):
        raise ValueError(f"THS fund flow coverage too low: {len(rows)}")

    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".json.tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temp_path.replace(path)
    return payload
