from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests


OUT_PATH = Path("web/data/full_a_turnover_top20.json")
HISTORY_DIR = Path("web/data/full_a_turnover_top20_history")
EASTMONEY_CLIST_URL = "https://push2.eastmoney.com/api/qt/clist/get"
EASTMONEY_A_SHARE_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048"
SINA_TURNOVER_URL = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"


def format_date(value: str) -> str:
    if len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return value


def number_or_none(value: Any) -> float | None:
    try:
        if value is None or value == "-":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_top_turnover(limit: int, timeout: float) -> list[dict[str, Any]]:
    params = {
        "pn": 1,
        "pz": limit,
        "po": 1,
        "np": 1,
        "fltt": 2,
        "invt": 2,
        "fid": "f6",
        "fs": EASTMONEY_A_SHARE_FS,
        "fields": "f12,f14,f2,f3,f5,f6,f8",
    }
    url = f"{EASTMONEY_CLIST_URL}?{urlencode(params)}"
    try:
        response = requests.get(
            EASTMONEY_CLIST_URL,
            params=params,
            timeout=timeout,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"},
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        print(f"Eastmoney top-turnover request failed through environment proxy, retrying direct: {exc}")
        try:
            session = requests.Session()
            session.trust_env = False
            response = session.get(
                EASTMONEY_CLIST_URL,
                params=params,
                timeout=timeout,
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"},
            )
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as direct_exc:
            print(f"Eastmoney direct request failed, retrying through PowerShell: {direct_exc}")
            payload = fetch_with_powershell(url, timeout)
    rows = payload.get("data", {}).get("diff") or []
    if not isinstance(rows, list):
        raise ValueError("Eastmoney response data.diff is not a list")
    return rows


def fetch_with_powershell(url: str, timeout: float) -> dict[str, Any]:
    if not sys.platform.startswith("win"):
        raise RuntimeError("PowerShell fallback is only available on Windows")
    script = (
        "$ProgressPreference='SilentlyContinue'; "
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
        "(Invoke-RestMethod -Uri $args[0] -TimeoutSec $args[1]) | ConvertTo-Json -Depth 8 -Compress"
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script, url, str(max(1, int(timeout)))],
        check=True,
        capture_output=True,
        cwd=Path.cwd(),
        encoding="utf-8",
        errors="replace",
        timeout=timeout + 5,
    )
    return json.loads(result.stdout)


def normalize_rows(rows: list[dict[str, Any]], date: str) -> list[dict[str, Any]]:
    stocks: list[dict[str, Any]] = []
    for row in rows:
        code = str(row.get("f12") or "")
        turnover = number_or_none(row.get("f6"))
        if not code or turnover is None:
            continue
        stocks.append(
            {
                "date": format_date(date),
                "code": code,
                "name": str(row.get("f14") or code),
                "close": number_or_none(row.get("f2")),
                "changePercent": number_or_none(row.get("f3")),
                "turnover": turnover,
                "amount": turnover,
                "volume": number_or_none(row.get("f5")),
                "turnoverRate": number_or_none(row.get("f8")),
            }
        )
    return stocks


def fetch_sina_top_turnover(limit: int, timeout: float) -> list[dict[str, Any]]:
    response = requests.get(
        SINA_TURNOVER_URL,
        params={"page": 1, "num": limit, "sort": "amount", "asc": 0, "node": "hs_a", "symbol": "", "_s_r_a": "page"},
        timeout=timeout,
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/"},
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise ValueError("Sina turnover response is not a list")
    return payload


def normalize_sina_rows(rows: list[dict[str, Any]], date: str) -> list[dict[str, Any]]:
    stocks: list[dict[str, Any]] = []
    for row in rows:
        code = str(row.get("code") or "")
        turnover = number_or_none(row.get("amount"))
        if not code or turnover is None:
            continue
        stocks.append({
            "date": format_date(date),
            "code": code,
            "name": str(row.get("name") or code),
            "close": number_or_none(row.get("trade")),
            "changePercent": number_or_none(row.get("changepercent")),
            "turnover": turnover,
            "amount": turnover,
            "volume": number_or_none(row.get("volume")),
            "turnoverRate": number_or_none(row.get("turnoverratio")),
        })
    return stocks


def compact_date(value: str) -> str:
    return format_date(value).replace("-", "")


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def previous_snapshot(history_dir: Path, date: str) -> dict[str, Any] | None:
    current = compact_date(date)
    candidates = sorted(
        (path for path in history_dir.glob("*.json") if path.stem.isdigit() and path.stem < current),
        key=lambda path: path.stem,
        reverse=True,
    )
    for path in candidates:
        payload = load_json(path)
        if isinstance((payload or {}).get("stocks"), list):
            return payload
    return None


def annotate_new_entries(stocks: list[dict[str, Any]], previous: dict[str, Any] | None) -> list[dict[str, Any]]:
    previous_codes = {
        str(stock.get("code") or "")
        for stock in (previous or {}).get("stocks", [])
        if stock.get("code")
    }
    for stock in stocks:
        stock["isNew"] = bool(previous_codes) and str(stock.get("code") or "") not in previous_codes
    return stocks


def main() -> None:
    parser = argparse.ArgumentParser(description="Build full A-share top turnover stock snapshot for the web dashboard.")
    parser.add_argument("--date", default=datetime.now().strftime("%Y%m%d"))
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--history-dir", type=Path, default=HISTORY_DIR)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args()

    source_name = "Eastmoney clist top turnover"
    try:
        stocks = normalize_rows(fetch_top_turnover(args.limit, args.timeout), args.date)
    except Exception as exc:  # noqa: BLE001 - keep dashboard usable when Eastmoney is flaky.
        print(f"Eastmoney full-A turnover refresh failed, retrying Sina ranking: {exc}")
        try:
            stocks = normalize_sina_rows(fetch_sina_top_turnover(args.limit, args.timeout), args.date)
            source_name = "Sina Market Center top turnover"
        except Exception as fallback_exc:  # noqa: BLE001 - keep dashboard usable when both sources are unavailable.
            if args.out.exists():
                print(f"Full-A turnover refresh failed, keeping existing snapshot: {fallback_exc}")
                return
            raise
    if len(stocks) < args.limit:
        raise ValueError(f"Only got {len(stocks)} full-A turnover rows, expected at least {args.limit}")

    previous = previous_snapshot(args.history_dir, args.date)
    stocks = annotate_new_entries(stocks, previous)
    payload = {
        "date": format_date(args.date),
        "compareDate": previous.get("date") if previous else None,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": {
            "name": source_name,
            "kind": "A-share realtime spot ranking",
            "amountUnit": "turnover_yuan",
            "note": "Fetched with pn=1,pz=20,fid=f6 so only the first ranked page is downloaded.",
        },
        "stocks": stocks,
    }
    history_payload = {key: value for key, value in payload.items() if key != "compareDate"}
    args.history_dir.mkdir(parents=True, exist_ok=True)
    (args.history_dir / f"{compact_date(args.date)}.json").write_text(
        json.dumps(history_payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Full-A turnover top {len(stocks)} OK: {args.out}")


if __name__ == "__main__":
    main()
