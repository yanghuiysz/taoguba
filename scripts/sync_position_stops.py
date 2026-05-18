import argparse
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import akshare as ak


ROOT = Path(__file__).resolve().parents[1]
POSITIONS_PATH = ROOT / "web" / "data" / "positions.json"


def normalize_code(value: Any) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits[-6:].zfill(6) if digits else ""


def safe_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def format_date(value: str) -> str:
    text = str(value or "").strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return text[:10]


def compact_date(value: str) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())[:8]


def disable_proxy_env() -> None:
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        os.environ.pop(key, None)


def fetch_hist_low(code: str, target_date: str) -> float | None:
    start_date = (datetime.strptime(target_date, "%Y%m%d") - timedelta(days=10)).strftime("%Y%m%d")
    try:
        df = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start_date, end_date=target_date, adjust="")
        if not df.empty:
            row = df[df["日期"].astype(str).map(compact_date) == target_date]
            if not row.empty:
                return safe_float(row.iloc[-1]["最低"])
    except Exception:
        pass

    prefixed = f"sh{code}" if code.startswith(("5", "6", "9")) else f"sz{code}"
    try:
        df = ak.stock_zh_a_hist_tx(symbol=prefixed, start_date=start_date, end_date=target_date, adjust="")
        if not df.empty:
            row = df[df["date"].astype(str).map(compact_date) == target_date]
            if not row.empty:
                return safe_float(row.iloc[-1]["low"])
    except Exception:
        pass
    return None


def fetch_spot_low(code: str) -> float | None:
    try:
        df = ak.stock_zh_a_spot()
    except Exception:
        return None
    if df.empty:
        return None
    code_col = df.columns[0]
    low_col = df.columns[10]
    row = df[df[code_col].astype(str).str.endswith(code)]
    if row.empty:
        return None
    return safe_float(row.iloc[-1][low_col])


def effective_stop(position: dict[str, Any]) -> float | None:
    candidates = [
        safe_float(position.get("firstBuyLow")),
        safe_float(position.get("forceExitPrice")),
    ]
    valid = [value for value in candidates if value is not None]
    return max(valid) if valid else None


def sync_position(position: dict[str, Any], overwrite: bool) -> dict[str, Any]:
    code = normalize_code(position.get("code"))
    entry_date = compact_date(position.get("entryDate"))
    if not code or not entry_date:
      position["effectiveStopPrice"] = effective_stop(position)
      return position

    low = fetch_hist_low(code, entry_date)
    if low is None and entry_date == datetime.now().strftime("%Y%m%d"):
        low = fetch_spot_low(code)

    if low is not None and (overwrite or safe_float(position.get("firstBuyLow")) is None):
        position["firstBuyLow"] = round(low, 2)

    position["effectiveStopPrice"] = effective_stop(position)
    return position


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync position stop lines from market data.")
    parser.add_argument("--positions", default=str(POSITIONS_PATH), help="Path to positions.json")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing firstBuyLow values")
    args = parser.parse_args()

    disable_proxy_env()

    positions_path = Path(args.positions)
    data = json.loads(positions_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit("positions.json must be a list")

    updated = [sync_position(dict(position), args.overwrite) for position in data]
    positions_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for position in updated:
        print(
            json.dumps(
                {
                    "code": normalize_code(position.get("code")),
                    "name": position.get("name"),
                    "firstBuyLow": position.get("firstBuyLow"),
                    "forceExitPrice": position.get("forceExitPrice"),
                    "effectiveStopPrice": position.get("effectiveStopPrice"),
                },
                ensure_ascii=False,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
