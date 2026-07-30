from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from custom_board_history import load_custom_board_payload
except ModuleNotFoundError:
    from scripts.custom_board_history import load_custom_board_payload


ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "web/data"
FULL_A_TURNOVER = WEB_DATA / "full_a_turnover_top20.json"


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


def number_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        return number
    except (TypeError, ValueError):
        return None


def validate_fund_flow_row(row: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    amount = row.get("mainNetInflow")
    flow_date = row.get("fundFlowLatestDate")
    if amount is not None and flow_date != row.get("date"):
        errors.append("fund flow date mismatch")
    source = row.get("fundFlowSource")
    if amount is not None and source not in {
        "eastmoney_stock_individual_fund_flow",
        "ths_stock_fund_flow_individual",
        "mixed",
    }:
        errors.append("fund flow source mismatch")
    count = number_or_none(row.get("fundFlowStockCount"))
    stocks = row.get("stocks")
    total = float(len(stocks)) if isinstance(stocks, list) else number_or_none(row.get("stockCount"))
    if count is not None and total is not None and count > total:
        errors.append("fund flow coverage exceeds stock count")
    if amount is not None and count is not None and total is not None and total > 0 and count / total < 0.8:
        errors.append("fund flow amount present below 80% coverage")
    return errors


def validate_custom(web_data: Path) -> dict[str, Any]:
    data_path = web_data / "custom_boards.json"
    config_path = web_data / "custom_boards_config.json"
    membership_path = web_data / "custom_board_membership.json"

    latest_payload = load_json(data_path)
    display_days = int(number_or_none(latest_payload.get("days")) or 15) if isinstance(latest_payload, dict) else 15
    data = load_custom_board_payload(data_path, days=display_days)
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

    fund_flow_errors = []
    for board in data.get("boards", []):
        for row in board.get("trend") or []:
            for error in validate_fund_flow_row(row):
                fund_flow_errors.append(
                    f"{board.get('name') or board.get('code')} {row.get('date')}: {error}"
                )
    require(not fund_flow_errors, "Invalid custom-board fund flow data: " + "; ".join(fund_flow_errors[:10]))

    market_trend = data.get("marketIndex", {}).get("trend", [])
    require(isinstance(market_trend, list), f"{data_path} marketIndex.trend must be a list")
    for previous, current in zip(market_trend, market_trend[1:]):
        current_volume = number_or_none(current.get("volume"))
        previous_volume = number_or_none(previous.get("volume"))
        if current.get("source") == "intraday_index_spot_tencent" and current_volume is not None and previous_volume:
            ratio = current_volume / previous_volume
            require(
                ratio <= 5,
                "Suspicious market index volume ratio; realtime volume may use a different unit: "
                f"{current.get('date')} volume={current_volume}, previous={previous_volume}, ratio={ratio:.4f}",
            )
    return {
        "date": data.get("date"),
        "boards": len(data.get("boards", [])),
        "configBoards": len(config.get("boards", [])),
        "membershipOverrides": len(membership.get("overrides", [])),
    }


def validate_full_a_turnover(web_data: Path) -> dict[str, Any]:
    data_path = web_data / "full_a_turnover_top20.json"
    if not data_path.exists():
        return {"date": "missing", "stocks": 0, "missing": True}
    data = load_json(data_path)
    stocks = data.get("stocks")
    require(isinstance(stocks, list), f"{data_path} must contain stocks[]")
    require(len(stocks) >= 20, f"{data_path} must contain at least 20 rows")

    previous_turnover: float | None = None
    for index, stock in enumerate(stocks[:20], start=1):
        code = str(stock.get("code") or "")
        turnover = number_or_none(stock.get("turnover") or stock.get("amount"))
        change = number_or_none(stock.get("changePercent"))
        require(code.isdigit() and len(code) == 6, f"{data_path} row {index} has invalid code: {code!r}")
        require(turnover is not None and turnover > 0, f"{data_path} row {index} missing positive turnover")
        require(change is not None, f"{data_path} row {index} missing changePercent")
        if previous_turnover is not None:
            require(turnover <= previous_turnover, f"{data_path} stocks[] must be sorted by turnover desc")
        previous_turnover = turnover

    return {
        "date": data.get("date"),
        "stocks": len(stocks),
        "missing": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate web dashboard JSON files required by the frontend.")
    parser.add_argument("--web-data", type=Path, default=WEB_DATA)
    args = parser.parse_args()

    custom = validate_custom(args.web_data)
    full_a = validate_full_a_turnover(args.web_data)
    print(
        "Custom board data OK: date={date}, boards={boards}, configBoards={configBoards}, membershipOverrides={membershipOverrides}".format(
            **custom
        )
    )
    if full_a["missing"]:
        print("Full-A turnover data skipped: web/data/full_a_turnover_top20.json not generated yet")
    else:
        print("Full-A turnover data OK: date={date}, stocks={stocks}".format(**full_a))


if __name__ == "__main__":
    main()
