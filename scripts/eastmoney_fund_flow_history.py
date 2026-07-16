from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SOURCE_NAME = "eastmoney_stock_individual_fund_flow"
ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
DATAPC_ENDPOINT = "https://datapc.eastmoney.com/emdatacenter/CapitalFlow/GetHistory"
FIELDS = tuple(f"f{number}" for number in range(51, 66))


def number_or_none(value: Any) -> float | None:
    try:
        if value in (None, "", "-"):
            return None
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def build_secid(code: str) -> str:
    normalized = str(code).zfill(6)[-6:]
    market = "1" if normalized.startswith(("6", "9")) else "0"
    return f"{market}.{normalized}"


def build_url(code: str) -> str:
    query = urlencode(
        {
            "lmt": "120",
            "klt": "101",
            "secid": build_secid(code),
            "fields1": "f1,f2",
            "fields2": ",".join(FIELDS),
        }
    )
    return f"{ENDPOINT}?{query}"


def build_datapc_url(code: str) -> str:
    normalized = str(code).zfill(6)[-6:]
    market_suffix = "1" if normalized.startswith(("6", "9")) else "2"
    return f"{DATAPC_ENDPOINT}?{urlencode({'code': normalized + market_suffix})}"


def _fetch_with_python(url: str, timeout: int = 20) -> str:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def _fetch_with_curl(url: str, timeout: int = 20) -> str:
    executable = shutil.which("curl.exe") or shutil.which("curl")
    if not executable:
        raise RuntimeError("system curl.exe is unavailable")
    result = subprocess.run(
        [executable, "--fail", "--silent", "--show-error", "--location", "--max-time", str(timeout),
         "-A", "Mozilla/5.0", "-e", "https://quote.eastmoney.com/", url],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout


def parse_response(code: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    klines = (payload.get("data") or {}).get("klines") or []
    rows: list[dict[str, Any]] = []
    damaged = False
    normalized_code = str(code).zfill(6)[-6:]
    for raw in klines:
        if isinstance(raw, str):
            values = raw.split(",")
            fields = {field: values[index] if index < len(values) else None for index, field in enumerate(FIELDS)}
        elif isinstance(raw, dict):
            fields = raw
        else:
            damaged = True
            continue
        date_text = str(fields.get("f51") or "")
        try:
            parsed_date = date.fromisoformat(date_text)
        except ValueError:
            damaged = True
            continue
        main_net_inflow = number_or_none(fields.get("f52"))
        if main_net_inflow is None:
            damaged = True
            continue
        rows.append(
            {
                "date": parsed_date.isoformat(),
                "code": normalized_code,
                "mainNetInflow": main_net_inflow,
                "smallNetInflow": number_or_none(fields.get("f53")),
                "mediumNetInflow": number_or_none(fields.get("f54")),
                "largeNetInflow": number_or_none(fields.get("f55")),
                "superLargeNetInflow": number_or_none(fields.get("f56")),
                "mainNetInflowRatio": number_or_none(fields.get("f57")),
                "smallNetInflowRatio": number_or_none(fields.get("f58")),
                "mediumNetInflowRatio": number_or_none(fields.get("f59")),
                "largeNetInflowRatio": number_or_none(fields.get("f60")),
                "superLargeNetInflowRatio": number_or_none(fields.get("f61")),
                "close": number_or_none(fields.get("f62")),
                "changePercent": number_or_none(fields.get("f63")),
                "source": SOURCE_NAME,
            }
        )
    if damaged or not rows:
        raise ValueError(f"Eastmoney returned empty or damaged fund-flow rows for {code}")
    unique = {str(row["date"]): row for row in rows}
    return [unique[key] for key in sorted(unique)][-120:]


def _amount_yuan(value: Any) -> float | None:
    text = str(value or "").strip()
    multiplier = 100000000.0 if text.endswith("亿") else 10000.0 if text.endswith("万") else 1.0
    if text.endswith(("亿", "万")):
        text = text[:-1]
    number = number_or_none(text)
    return None if number is None else number * multiplier


def _percent(value: Any) -> float | None:
    return number_or_none(str(value or "").strip().removesuffix("%"))


def parse_datapc_response(code: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    normalized = str(code).zfill(6)[-6:]
    rows = []
    for item in payload.get("history") or []:
        if not isinstance(item, dict):
            continue
        main = _amount_yuan(item.get("zllr_je"))
        try:
            day = date.fromisoformat(str(item.get("rq") or "")).isoformat()
        except ValueError:
            continue
        if main is None:
            continue
        rows.append({
            "date": day, "code": normalized, "mainNetInflow": main,
            "smallNetInflow": _amount_yuan(item.get("xdjlr_je")),
            "mediumNetInflow": _amount_yuan(item.get("zdjlr_je")),
            "largeNetInflow": _amount_yuan(item.get("ddjlr_je")),
            "superLargeNetInflow": _amount_yuan(item.get("cddjlr_je")),
            "mainNetInflowRatio": _percent(item.get("zllr_jzb")),
            "smallNetInflowRatio": _percent(item.get("xdjlr_jzb")),
            "mediumNetInflowRatio": _percent(item.get("zdjlr_jzb")),
            "largeNetInflowRatio": _percent(item.get("ddjlr_jzb")),
            "superLargeNetInflowRatio": _percent(item.get("cddjlr_jzb")),
            "close": number_or_none(item.get("spj")), "changePercent": _percent(item.get("zdf")),
            "source": SOURCE_NAME,
        })
    if not rows:
        raise ValueError(f"Eastmoney DataPC returned no fund-flow history for {code}")
    unique = {row["date"]: row for row in rows}
    return [unique[key] for key in sorted(unique)][-120:]


def _fetch_datapc_history(code: str, timeout: int) -> dict[str, Any]:
    url = build_datapc_url(code)
    try:
        text = _fetch_with_curl(url, timeout) if os.name == "nt" else _fetch_with_python(url, timeout)
    except Exception:
        text = _fetch_with_python(url, timeout) if os.name == "nt" else _fetch_with_curl(url, timeout)
    return json.loads(text)


def fetch_history(code: str, timeout: int = 5) -> list[dict[str, Any]]:
    try:
        return parse_datapc_response(code, _fetch_datapc_history(code, timeout))
    except Exception:
        pass
    url = build_url(code)
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            if os.name == "nt":
                try:
                    text = _fetch_with_curl(url, timeout)
                except Exception:
                    text = _fetch_with_python(url, timeout)
            else:
                try:
                    text = _fetch_with_python(url, timeout)
                except Exception:
                    text = _fetch_with_curl(url, timeout)
            break
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                time.sleep(1.0)
    else:
        raise RuntimeError(f"Eastmoney fund-flow request failed for {code}") from last_error
    payload = json.loads(text)
    rows = parse_response(code, payload)
    if not rows:
        raise ValueError(f"Eastmoney returned no fund-flow history for {code}")
    return rows


def cache_path(root: Path, end_date: str, code: str) -> Path:
    return root / str(end_date).replace("-", "") / f"{str(code).zfill(6)[-6:]}.json"


def _read_rows(path: Path) -> list[dict[str, Any]] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, list):
        return None
    rows: list[dict[str, Any]] = []
    expected_code = path.stem.zfill(6)[-6:]
    for item in payload:
        if not isinstance(item, dict):
            return None
        row = dict(item)
        try:
            row["date"] = date.fromisoformat(str(row.get("date") or "")).isoformat()
        except ValueError:
            return None
        flow_keys = ("mainNetInflow", "superLargeNetInflow", "largeNetInflow", "mediumNetInflow", "smallNetInflow")
        if any(number_or_none(row.get(key)) is None for key in flow_keys):
            return None
        if str(row.get("code") or "").zfill(6)[-6:] != expected_code:
            return None
        if row.get("source") not in (None, SOURCE_NAME):
            return None
        row["code"] = expected_code
        row["source"] = SOURCE_NAME
        rows.append(row)
    if not rows:
        return None
    unique = {str(row["date"]): row for row in rows}
    return [unique[key] for key in sorted(unique)][-120:]


def latest_cached_history(root: Path, end_date: str, code: str) -> list[dict[str, Any]] | None:
    target = str(end_date).replace("-", "")
    candidates = sorted(
        (directory / f"{str(code).zfill(6)[-6:]}.json" for directory in root.glob("[0-9]*")
         if directory.is_dir() and directory.name <= target),
        reverse=True,
    )
    for path in candidates:
        rows = _read_rows(path)
        if rows is not None:
            return rows
    return None


def write_cache_atomic(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(rows, stream, ensure_ascii=False, indent=2, allow_nan=False)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def load_or_fetch_history(code: str, end_date: str, root: Path, force: bool = False) -> list[dict[str, Any]]:
    path = cache_path(root, end_date, code)
    cached = None if force else _read_rows(path)
    compact = str(end_date).replace("-", "")
    target_date = f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}" if len(compact) == 8 else str(end_date)
    if cached is not None and any(str(row.get("date") or "") == target_date for row in cached):
        write_cache_atomic(path, cached)
        return cached
    try:
        rows = fetch_history(code)
    except Exception:
        fallback = latest_cached_history(root, end_date, code)
        if fallback is not None:
            return fallback
        raise
    if rows and target_date < str(rows[0].get("date") or ""):
        raise ValueError("outside 120-day window")
    write_cache_atomic(path, rows)
    return rows
