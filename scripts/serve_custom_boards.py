from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "web/data/custom_boards_config.json"
DATA_PATH = ROOT / "web/data/custom_boards.json"
BUILDER = ROOT / "scripts/build_custom_board_data.py"
BUILD_LOCK = threading.Lock()


def compact_date(value: str) -> str:
    text = str(value or "")
    digits = re.sub(r"\D", "", text)
    return digits[:8] if len(digits) >= 8 else datetime.now().strftime("%Y%m%d")


def normalize_stock_code(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) > 6:
        digits = digits[-6:]
    return digits.zfill(6) if digits else ""


def load_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def find_board(config: dict[str, Any], board_code: str) -> dict[str, Any]:
    for board in config.get("boards", []):
        if board.get("code") == board_code:
            return board
    raise ValueError(f"没有找到板块：{board_code}")


def current_data_date() -> str:
    data = load_json(DATA_PATH, {})
    return compact_date(str(data.get("date") or ""))


def rebuild_data(date: str) -> str:
    command = [
        sys.executable,
        str(BUILDER),
        "--date",
        date,
        "--sleep",
        "0.02",
    ]
    completed = subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=600,
    )
    return "\n".join(part for part in [completed.stdout, completed.stderr] if part)


def update_stock(payload: dict[str, Any]) -> dict[str, Any]:
    action = str(payload.get("action") or "").strip()
    board_code = str(payload.get("boardCode") or "").strip()
    stock_code = normalize_stock_code(payload.get("code"))
    stock_name = str(payload.get("name") or stock_code).strip() or stock_code
    if action not in {"add", "remove"}:
        raise ValueError("action 必须是 add 或 remove")
    if not board_code:
        raise ValueError("缺少 boardCode")
    if not stock_code:
        raise ValueError("请输入 6 位股票代码")

    with BUILD_LOCK:
        config = load_json(CONFIG_PATH, {"boards": []})
        board = find_board(config, board_code)
        stocks = board.setdefault("stocks", [])
        if action == "add":
            for stock in stocks:
                if normalize_stock_code(stock.get("code")) == stock_code:
                    stock["code"] = stock_code
                    stock["name"] = stock_name
                    break
            else:
                stocks.append({"code": stock_code, "name": stock_name})
        else:
            board["stocks"] = [
                stock
                for stock in stocks
                if normalize_stock_code(stock.get("code")) != stock_code
            ]
        write_json(CONFIG_PATH, config)
        log = rebuild_data(current_data_date())
        data = load_json(DATA_PATH, {"boards": []})
    return {"ok": True, "data": data, "log": log}


class CustomBoardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        if self.path == "/api/custom-boards/status":
            self.send_json(HTTPStatus.OK, {"ok": True, "editable": True})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        if self.path != "/api/custom-boards/stock":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            result = update_stock(self.read_json())
        except subprocess.CalledProcessError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "ok": False,
                    "error": "数据刷新失败",
                    "log": "\n".join(part for part in [exc.stdout, exc.stderr] if part),
                },
            )
        except Exception as exc:  # noqa: BLE001 - return editable-form errors to the page.
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        else:
            self.send_json(HTTPStatus.OK, result)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the dashboard with custom-board editing APIs.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), CustomBoardHandler)
    print(f"Serving dashboard at http://{args.host}:{args.port}/web/index.html")
    print("Custom board editing API is enabled.")
    server.serve_forever()


if __name__ == "__main__":
    main()
