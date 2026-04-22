from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "web/data"


def load_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Missing required data file: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {path}: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_kpl(web_data: Path) -> dict[str, Any]:
    dashboard_path = web_data / "kpl_dashboard.json"
    index_path = web_data / "kpl/index.json"
    dashboard = load_json(dashboard_path)
    index = load_json(index_path)

    require(isinstance(dashboard.get("plates"), list), f"{dashboard_path} must contain plates[]")
    require(dashboard.get("date"), f"{dashboard_path} must contain date")
    require(isinstance(index.get("items"), list), f"{index_path} must contain items[]")
    require(index.get("items"), f"{index_path} items[] is empty")

    missing_history: list[str] = []
    for item in index["items"]:
      path = item.get("path")
      if not path:
          missing_history.append("<empty path>")
          continue
      history_path = (web_data.parent / path.replace("./", "")).resolve()
      if not history_path.exists():
          missing_history.append(str(history_path))
    require(not missing_history, "Missing KPL history files: " + ", ".join(missing_history))
    return {
        "date": dashboard.get("date"),
        "plates": len(dashboard.get("plates", [])),
        "history": len(index.get("items", [])),
    }


def validate_custom(web_data: Path) -> dict[str, Any]:
    data_path = web_data / "custom_boards.json"
    config_path = web_data / "custom_boards_config.json"
    membership_path = web_data / "custom_board_membership.json"

    data = load_json(data_path)
    config = load_json(config_path)
    membership = load_json(membership_path)

    require(isinstance(data.get("boards"), list), f"{data_path} must contain boards[]")
    require(data.get("boards"), f"{data_path} boards[] is empty")
    require(data.get("date"), f"{data_path} must contain date")
    require(isinstance(config.get("boards"), list), f"{config_path} must contain boards[]")
    require(isinstance(membership.get("overrides"), list), f"{membership_path} must contain overrides[]")

    boards_without_trend = [
        str(board.get("name") or board.get("code") or "<unnamed>")
        for board in data.get("boards", [])
        if not isinstance(board.get("trend"), list) or not board.get("trend")
    ]
    require(not boards_without_trend, "Custom boards missing trend data: " + ", ".join(boards_without_trend))
    return {
        "date": data.get("date"),
        "boards": len(data.get("boards", [])),
        "configBoards": len(config.get("boards", [])),
        "membershipOverrides": len(membership.get("overrides", [])),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate web dashboard JSON files required by the frontend.")
    parser.add_argument("--web-data", type=Path, default=WEB_DATA)
    args = parser.parse_args()

    kpl = validate_kpl(args.web_data)
    custom = validate_custom(args.web_data)
    print(
        "KPL data OK: date={date}, plates={plates}, history={history}".format(**kpl)
    )
    print(
        "Custom board data OK: date={date}, boards={boards}, configBoards={configBoards}, membershipOverrides={membershipOverrides}".format(
            **custom
        )
    )


if __name__ == "__main__":
    main()
