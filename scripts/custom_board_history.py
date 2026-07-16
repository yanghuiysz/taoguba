from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any


def load_json(path: Path, fallback: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback
    except json.JSONDecodeError:
        return fallback


def resolve_web_path(latest_path: Path, web_path: str) -> Path:
    text = str(web_path or "").replace("\\", "/")
    if text.startswith("./"):
        text = text[2:]
    web_root = latest_path.parent.parent
    return (web_root / text).resolve()


def merge_rows_by_date(existing: list[dict[str, Any]], additions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = {str(row.get("date")): deepcopy(row) for row in existing or [] if row.get("date")}
    rows.update({str(row.get("date")): deepcopy(row) for row in additions or [] if row.get("date")})
    return [rows[date] for date in sorted(rows)]


def hydrate_custom_board_history(payload: dict[str, Any], history_payloads: list[dict[str, Any]]) -> dict[str, Any]:
    hydrated = deepcopy(payload)
    for history in sorted(history_payloads, key=lambda item: str(item.get("date") or "")):
        for key in ("marketIndex", "secondaryMarketIndex"):
            if key in hydrated or key in history:
                target = hydrated.setdefault(key, {})
                target["trend"] = merge_rows_by_date(target.get("trend") or [], (history.get(key) or {}).get("trend") or [])
        history_boards = {str(board.get("code")): board for board in history.get("boards", []) if board.get("code")}
        for board in hydrated.get("boards", []):
            history_board = history_boards.get(str(board.get("code")))
            if not history_board:
                continue
            board["trend"] = merge_rows_by_date(board.get("trend") or [], history_board.get("trend") or [])
            board["boardNewHighTrend"] = merge_rows_by_date(
                board.get("boardNewHighTrend") or [],
                history_board.get("boardNewHighTrend") or [],
            )
    return hydrated


def load_custom_board_payload(path: Path, days: int | None = None) -> dict[str, Any]:
    payload = load_json(path, {})
    if not isinstance(payload, dict):
        return {}
    history_index_path = payload.get("historyIndex")
    if not history_index_path:
        return payload
    index = load_json(resolve_web_path(path, str(history_index_path)), {})
    items = index.get("items") if isinstance(index, dict) else []
    if not isinstance(items, list):
        return payload
    selected = items[:days] if days else items
    histories = [
        item_payload
        for item in selected
        if isinstance(item, dict) and item.get("path")
        for item_payload in [load_json(resolve_web_path(path, str(item.get("path"))), None)]
        if isinstance(item_payload, dict)
    ]
    intraday_path = payload.get("intradayPath")
    if intraday_path:
        intraday_payload = load_json(resolve_web_path(path, str(intraday_path)), None)
        if isinstance(intraday_payload, dict):
            histories.append(intraday_payload)
    return hydrate_custom_board_history(payload, histories)
