from __future__ import annotations

import argparse
import json
import re
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import akshare as ak
import requests
from bs4 import BeautifulSoup


DASHBOARD_PATH = Path("web/data/kpl_dashboard.json")
HISTORY_DIR = Path("web/data/kpl/history")
OUT_DIR = Path("data/external/ths_limit_mapping")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Referer": "https://q.10jqka.com.cn/gn/",
}

# These aliases bridge common Kaipanla plate names to Tonghuashun concept names.
# Keep them intentionally small and visible: this mapping is explainable data glue,
# not a claim that both vendors use identical concept taxonomies.
ALIASES: dict[str, list[str]] = {
    "医药": ["创新药", "医药电商", "医疗器械概念", "智能医疗", "减肥药", "仿制药一致性评价", "医美概念"],
    "医疗器械": ["医疗器械概念"],
    "算力": ["东数西算(算力)", "算力租赁", "云计算"],
    "商业航天": ["商业航天"],
    "芯片": ["芯片概念", "存储芯片", "汽车芯片", "MCU芯片"],
    "智能家居": ["智能家居"],
    "智能电网": ["电力物联网"],
    "电力": ["绿色电力", "电力物联网", "超超临界发电"],
    "储能": ["储能"],
    "电池": ["锂电池概念", "固态电池", "钠离子电池", "动力电池回收"],
    "消费电子": ["消费电子概念", "AI手机", "AI PC", "AI眼镜"],
    "AI应用": ["AI应用", "AI智能体", "多模态AI", "智能医疗"],
    "机器人": ["机器人概念", "人形机器人"],
    "低空经济": ["低空经济", "飞行汽车(eVTOL)"],
    "食品饮料": ["乳业", "白酒概念"],
}


def compact_date(value: str) -> str:
    return value.replace("-", "")


def normalize_name(value: str) -> str:
    return re.sub(r"[\s（）()《》]+", "", value).replace("概念", "")


def to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    text = str(value).replace("%", "").replace(",", "").strip()
    if text in ("-", "--"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_amount(value: Any) -> float | None:
    if value in (None, ""):
        return None
    text = str(value).replace(",", "").strip()
    if text in ("-", "--"):
        return None
    multiplier = 1.0
    if text.endswith("亿"):
        multiplier = 100000000.0
        text = text[:-1]
    elif text.endswith("万"):
        multiplier = 10000.0
        text = text[:-1]
    try:
        return float(text) * multiplier
    except ValueError:
        return None


def code6(value: Any) -> str:
    return str(value).strip().split(".")[0].zfill(6)


def load_dashboard(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_concepts() -> list[dict[str, str]]:
    df = ak.stock_board_concept_name_ths()
    return [{"name": str(row["name"]), "code": str(row["code"])} for _, row in df.iterrows()]


def fetch_limit_pool(date: str) -> dict[str, dict[str, Any]]:
    df = ak.stock_zt_pool_em(date=date)
    result: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        code = code6(row.get("代码"))
        result[code] = {
            "code": code,
            "name": str(row.get("名称", "")),
            "changePercent": to_float(row.get("涨跌幅")),
            "latestPrice": to_float(row.get("最新价")),
            "amount": to_float(row.get("成交额")),
            "freeMarketCap": to_float(row.get("流通市值")),
            "totalMarketCap": to_float(row.get("总市值")),
            "turnoverRate": to_float(row.get("换手率")),
            "sealAmount": to_float(row.get("封板资金")),
            "firstSealTime": str(row.get("首次封板时间", "")).zfill(6),
            "lastSealTime": str(row.get("最后封板时间", "")).zfill(6),
            "openCount": int(row.get("炸板次数", 0) or 0),
            "limitStats": str(row.get("涨停统计", "")),
            "consecutiveBoards": int(row.get("连板数", 0) or 0),
            "industry": str(row.get("所属行业", "")),
        }
    return result


def match_concepts(plate_name: str, concepts: list[dict[str, str]], max_auto: int = 5) -> list[dict[str, str]]:
    concept_by_name = {item["name"]: item for item in concepts}
    matches: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(item: dict[str, str] | None, match_type: str) -> None:
        if not item or item["code"] in seen:
            return
        seen.add(item["code"])
        matches.append({"name": item["name"], "code": item["code"], "matchType": match_type})

    add(concept_by_name.get(plate_name), "exact")
    for alias in ALIASES.get(plate_name, []):
        add(concept_by_name.get(alias), "alias")

    plate_norm = normalize_name(plate_name)
    for item in concepts:
        concept_norm = normalize_name(item["name"])
        if len(plate_norm) < 2 or item["code"] in seen:
            continue
        if plate_norm in concept_norm or concept_norm in plate_norm:
            add(item, "name_contains")
            if len([m for m in matches if m["matchType"] == "name_contains"]) >= max_auto:
                break

    return matches[:10]


def fetch_ths_first_page_stocks(concept: dict[str, str]) -> list[dict[str, Any]]:
    url = f"https://q.10jqka.com.cn/gn/detail/code/{concept['code']}/"
    response = requests.get(url, headers=HEADERS, timeout=20)
    response.encoding = "gbk"
    if response.status_code != 200:
        raise RuntimeError(f"THS returned {response.status_code} for {concept['name']}")

    soup = BeautifulSoup(response.text, "html.parser")
    rows: list[dict[str, Any]] = []
    table = soup.select_one("#maincont table")
    if not table:
        return rows

    for tr in table.select("tbody tr"):
        cells = [td.get_text(strip=True) for td in tr.select("td")]
        if len(cells) < 13:
            continue
        rows.append(
            {
                "rank": int(cells[0]) if cells[0].isdigit() else None,
                "code": code6(cells[1]),
                "name": cells[2],
                "latestPrice": to_float(cells[3]),
                "changePercent": to_float(cells[4]),
                "changeAmount": to_float(cells[5]),
                "speed": to_float(cells[6]),
                "turnoverRate": to_float(cells[7]),
                "volumeRatio": to_float(cells[8]),
                "amplitude": to_float(cells[9]),
                "amount": parse_amount(cells[10]),
                "floatShares": parse_amount(cells[11]),
                "floatMarketCap": parse_amount(cells[12]),
                "pe": to_float(cells[13]) if len(cells) > 13 else None,
                "sourceConcept": concept["name"],
                "sourceConceptCode": concept["code"],
                "conceptMatchType": concept["matchType"],
            }
        )
    return rows


def build_mapping(payload: dict[str, Any], date: str, delay: float = 0.15) -> dict[str, Any]:
    concepts = load_concepts()
    limit_pool = fetch_limit_pool(date)
    concept_stock_cache: dict[str, list[dict[str, Any]]] = {}

    plate_results: list[dict[str, Any]] = []
    for plate in payload.get("plates", []):
        plate_name = str(plate.get("plateName", ""))
        matches = match_concepts(plate_name, concepts)
        stocks_by_code: dict[str, dict[str, Any]] = {}
        concept_errors: list[str] = []

        for concept in matches:
            try:
                if concept["code"] not in concept_stock_cache:
                    concept_stock_cache[concept["code"]] = fetch_ths_first_page_stocks(concept)
                    time.sleep(delay)
                for stock in concept_stock_cache[concept["code"]]:
                    limit_row = limit_pool.get(stock["code"])
                    if not limit_row:
                        continue
                    item = stocks_by_code.setdefault(
                        stock["code"],
                        {
                            **limit_row,
                            "matchedConcepts": [],
                            "thsRanks": [],
                            "source": "Tonghuashun concept first page x Eastmoney limit-up pool",
                        },
                    )
                    item["matchedConcepts"].append(
                        {
                            "name": concept["name"],
                            "code": concept["code"],
                            "matchType": concept["matchType"],
                        }
                    )
                    item["thsRanks"].append(
                        {
                            "concept": concept["name"],
                            "rank": stock.get("rank"),
                            "changePercent": stock.get("changePercent"),
                        }
                    )
            except Exception as exc:  # noqa: BLE001
                concept_errors.append(f"{concept['name']}: {exc}")

        stocks = sorted(
            stocks_by_code.values(),
            key=lambda row: (row.get("consecutiveBoards") or 0, row.get("sealAmount") or 0),
            reverse=True,
        )
        result = {
            "plateCode": plate.get("plateCode"),
            "plateName": plate_name,
            "matchedConcepts": matches,
            "limitUpStocks": stocks,
            "errors": concept_errors,
        }
        plate["externalLimitMapping"] = {
            "source": "Tonghuashun concepts + Eastmoney limit-up pool",
            "note": "This is an external cross-source mapping, not a Kaipanla official plate detail endpoint.",
            "matchedConcepts": matches,
            "limitUpStocks": stocks,
            "errors": concept_errors,
        }
        plate_results.append(result)

    payload.setdefault("externalSources", []).append(
        {
            "name": "Tonghuashun concepts + Eastmoney limit-up pool",
            "date": date,
            "note": "Maps Kaipanla plates to Tonghuashun concepts, then intersects first-page concept constituents with Eastmoney limit-up pool.",
        }
    )
    mapped_codes = {
        stock["code"]
        for item in plate_results
        for stock in item.get("limitUpStocks", [])
        if stock.get("code")
    }
    payload["summary"]["externalLimitUpStockCount"] = len(mapped_codes)
    payload["summary"]["externalLimitUpMappingCount"] = sum(
        len(item.get("limitUpStocks", [])) for item in plate_results
    )
    return {
        "date": date,
        "source": payload["externalSources"][-1],
        "plates": plate_results,
    }


def write_history(payload: dict[str, Any], history_dir: Path) -> None:
    history_path = history_dir / f"{compact_date(payload['date'])}.json"
    if history_path.exists():
        history_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Map KPL plates to THS concepts and Eastmoney limit-up stocks.")
    parser.add_argument("--date", help="Trading date, e.g. 20260415. Defaults to dashboard date.")
    parser.add_argument("--dashboard", type=Path, default=DASHBOARD_PATH)
    parser.add_argument("--history-dir", type=Path, default=HISTORY_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    args = parser.parse_args()

    payload = load_dashboard(args.dashboard)
    date = args.date or compact_date(str(payload.get("date", "")))
    mapping = build_mapping(payload, date)

    args.dashboard.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_history(payload, args.history_dir)
    out_dir = args.out_dir / date
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "ths_limit_mapping.json"
    out_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")

    matched_plates = sum(1 for plate in mapping["plates"] if plate["limitUpStocks"])
    mapped_stocks = sum(len(plate["limitUpStocks"]) for plate in mapping["plates"])
    print(f"Wrote {out_path}")
    print(f"Updated {args.dashboard}")
    print(f"Mapped plates: {matched_plates}/{len(mapping['plates'])}, mapped limit-up rows: {mapped_stocks}")


if __name__ == "__main__":
    main()
