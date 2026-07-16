import json
import tempfile
from pathlib import Path

from build_custom_board_data import (
    archive_intraday_fallback,
    build_custom_board_history_index,
    build_custom_board_history_payload,
    build_custom_board_latest_payload,
    hydrate_custom_board_history,
    write_custom_board_outputs,
)


def sample_payload():
    return {
        "date": "2026-06-18",
        "days": 2,
        "source": {"name": "sample"},
        "marketIndex": {
            "name": "上证指数",
            "trend": [
                {"date": "2026-06-17", "changePercent": 0.4},
                {"date": "2026-06-18", "changePercent": -0.43},
            ],
        },
        "secondaryMarketIndex": {
            "name": "创业板指",
            "trend": [
                {"date": "2026-06-17", "changePercent": 1.56},
                {"date": "2026-06-18", "changePercent": 2.05},
            ],
        },
        "boards": [
            {
                "code": "ai",
                "name": "AI",
                "latestAverageChange": 3.2,
                "stocks": [{"code": "000001", "name": "平安银行"}],
                "trend": [
                    {"date": "2026-06-17", "averageChange": 1.2, "stocks": [{"code": "000001", "changePercent": 1.0}]},
                    {"date": "2026-06-18", "averageChange": 3.2, "stocks": [{"code": "000001", "changePercent": 3.0}]},
                ],
                "boardNewHighTrend": [
                    {"date": "2026-06-17", "high100Count": 1},
                    {"date": "2026-06-18", "high100Count": 2},
                ],
            }
        ],
    }


def test_latest_payload_strips_heavy_history_and_keeps_index_pointer():
    latest = build_custom_board_latest_payload(sample_payload(), "./data/custom_boards/index.json")

    assert latest["historyIndex"] == "./data/custom_boards/index.json"
    assert latest["boards"][0]["trend"] == []
    assert latest["boards"][0]["boardNewHighTrend"] == []
    assert latest["marketIndex"]["trend"] == []
    assert latest["secondaryMarketIndex"]["trend"] == []
    assert latest["boards"][0]["stocks"][0]["code"] == "000001"


def test_daily_history_payload_can_hydrate_latest_payload():
    payload = sample_payload()
    latest = build_custom_board_latest_payload(payload, "./data/custom_boards/index.json")
    daily_17 = build_custom_board_history_payload(payload, "2026-06-17")
    daily_18 = build_custom_board_history_payload(payload, "2026-06-18")

    hydrated = hydrate_custom_board_history(latest, [daily_17, daily_18])

    assert [row["date"] for row in hydrated["marketIndex"]["trend"]] == ["2026-06-17", "2026-06-18"]
    assert hydrated["boards"][0]["trend"][1]["averageChange"] == 3.2
    assert hydrated["boards"][0]["trend"][1]["stocks"][0]["changePercent"] == 3.0
    assert hydrated["boards"][0]["boardNewHighTrend"][1]["high100Count"] == 2


def test_history_index_keeps_existing_items_and_latest_first(tmp_path: Path):
    index_path = tmp_path / "index.json"
    index_path.write_text(
        json.dumps(
            {
                "latest": "2026-06-17",
                "items": [{"date": "2026-06-17", "path": "./data/custom_boards/history/20260617.json"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    index = build_custom_board_history_index(
        index_path,
        "2026-06-18",
        "./data/custom_boards/history/20260618.json",
    )

    assert index["latest"] == "2026-06-18"
    assert [item["date"] for item in index["items"]] == ["2026-06-18", "2026-06-17"]


def test_write_outputs_creates_history_file_for_each_payload_date(tmp_path: Path):
    out_path = tmp_path / "web" / "data" / "custom_boards.json"
    history_dir = tmp_path / "web" / "data" / "custom_boards" / "history"
    index_path = tmp_path / "web" / "data" / "custom_boards" / "index.json"

    write_custom_board_outputs(sample_payload(), out_path, history_dir, index_path)

    assert (history_dir / "20260617.json").exists()
    assert (history_dir / "20260618.json").exists()
    index = json.loads(index_path.read_text(encoding="utf-8"))
    assert [item["date"] for item in index["items"]] == ["2026-06-18", "2026-06-17"]


def test_intraday_outputs_write_runtime_copy_without_history_index_mutation(tmp_path: Path):
    out_path = tmp_path / "web" / "data" / "custom_boards.json"
    history_dir = tmp_path / "web" / "data" / "custom_boards" / "history"
    intraday_dir = tmp_path / "web" / "data" / "custom_boards" / "intraday"
    index_path = tmp_path / "web" / "data" / "custom_boards" / "index.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps(
            {
                "latest": "2026-06-17",
                "items": [{"date": "2026-06-17", "path": "./data/custom_boards/history/20260617.json"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    write_custom_board_outputs(
        sample_payload(),
        out_path,
        history_dir,
        index_path,
        intraday=True,
        intraday_dir=intraday_dir,
    )

    intraday_path = intraday_dir / "20260618.json"
    assert intraday_path.exists()
    assert not (history_dir / "20260618.json").exists()
    index = json.loads(index_path.read_text(encoding="utf-8"))
    latest = json.loads(out_path.read_text(encoding="utf-8"))
    intraday = json.loads(intraday_path.read_text(encoding="utf-8"))
    assert [item["date"] for item in index["items"]] == ["2026-06-17"]
    assert latest["intradayPath"] == "./data/custom_boards/intraday/20260618.json"
    assert intraday["source"]["snapshotKind"] == "intraday"


def test_archive_intraday_fallback_promotes_intraday_snapshot_to_history(tmp_path: Path):
    history_dir = tmp_path / "web" / "data" / "custom_boards" / "history"
    intraday_dir = tmp_path / "web" / "data" / "custom_boards" / "intraday"
    index_path = tmp_path / "web" / "data" / "custom_boards" / "index.json"
    intraday_dir.mkdir(parents=True)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps(
            {
                "latest": "2026-06-17",
                "items": [{"date": "2026-06-17", "path": "./data/custom_boards/history/20260617.json"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    intraday_payload = build_custom_board_history_payload(sample_payload(), "2026-06-18")
    intraday_payload["source"]["snapshotKind"] = "intraday"
    (intraday_dir / "20260618.json").write_text(json.dumps(intraday_payload, ensure_ascii=False), encoding="utf-8")

    archived = archive_intraday_fallback("20260618", history_dir, intraday_dir, index_path)

    assert archived is True
    history = json.loads((history_dir / "20260618.json").read_text(encoding="utf-8"))
    index = json.loads(index_path.read_text(encoding="utf-8"))
    assert history["source"]["snapshotKind"] == "intraday-fallback"
    assert [item["date"] for item in index["items"]] == ["2026-06-18", "2026-06-17"]


def test_archive_intraday_fallback_keeps_existing_history(tmp_path: Path):
    history_dir = tmp_path / "web" / "data" / "custom_boards" / "history"
    intraday_dir = tmp_path / "web" / "data" / "custom_boards" / "intraday"
    index_path = tmp_path / "web" / "data" / "custom_boards" / "index.json"
    history_dir.mkdir(parents=True)
    intraday_dir.mkdir(parents=True)
    existing = build_custom_board_history_payload(sample_payload(), "2026-06-18")
    existing["source"]["snapshotKind"] = "official"
    (history_dir / "20260618.json").write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")
    intraday = build_custom_board_history_payload(sample_payload(), "2026-06-18")
    intraday["source"]["snapshotKind"] = "intraday"
    (intraday_dir / "20260618.json").write_text(json.dumps(intraday, ensure_ascii=False), encoding="utf-8")

    archived = archive_intraday_fallback("20260618", history_dir, intraday_dir, index_path)

    history = json.loads((history_dir / "20260618.json").read_text(encoding="utf-8"))
    assert archived is False
    assert history["source"]["snapshotKind"] == "official"


if __name__ == "__main__":
    test_latest_payload_strips_heavy_history_and_keeps_index_pointer()
    test_daily_history_payload_can_hydrate_latest_payload()
    with tempfile.TemporaryDirectory() as tmp:
        test_history_index_keeps_existing_items_and_latest_first(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_write_outputs_creates_history_file_for_each_payload_date(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_intraday_outputs_write_runtime_copy_without_history_index_mutation(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_archive_intraday_fallback_promotes_intraday_snapshot_to_history(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_archive_intraday_fallback_keeps_existing_history(Path(tmp))
    print("custom board history split behavior ok")
