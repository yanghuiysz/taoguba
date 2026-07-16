import json
import tempfile
from pathlib import Path

from custom_board_history import load_custom_board_payload


def test_loader_hydrates_split_custom_board_payload():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        data_dir = root / "web" / "data"
        history_dir = data_dir / "custom_boards" / "history"
        history_dir.mkdir(parents=True)

        latest_path = data_dir / "custom_boards.json"
        index_path = data_dir / "custom_boards" / "index.json"
        latest_path.write_text(
            json.dumps(
                {
                    "date": "2026-06-18",
                    "historyIndex": "./data/custom_boards/index.json",
                    "marketIndex": {"trend": []},
                    "boards": [{"code": "ai", "trend": [], "boardNewHighTrend": []}],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        index_path.write_text(
            json.dumps(
                {
                    "latest": "2026-06-18",
                    "items": [
                        {"date": "2026-06-18", "path": "./data/custom_boards/history/20260618.json"},
                        {"date": "2026-06-17", "path": "./data/custom_boards/history/20260617.json"},
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        for date, value in (("2026-06-17", 1.2), ("2026-06-18", 3.4)):
            (history_dir / f"{date.replace('-', '')}.json").write_text(
                json.dumps(
                    {
                        "date": date,
                        "marketIndex": {"trend": [{"date": date, "changePercent": value}]},
                        "boards": [
                            {
                                "code": "ai",
                                "trend": [{"date": date, "averageChange": value}],
                                "boardNewHighTrend": [{"date": date, "high100Count": int(value)}],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

        payload = load_custom_board_payload(latest_path, days=2)

        assert [row["date"] for row in payload["marketIndex"]["trend"]] == ["2026-06-17", "2026-06-18"]
        assert payload["boards"][0]["trend"][1]["averageChange"] == 3.4
        assert payload["boards"][0]["boardNewHighTrend"][0]["high100Count"] == 1


def test_loader_hydrates_intraday_payload_after_archived_history():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        data_dir = root / "web" / "data"
        history_dir = data_dir / "custom_boards" / "history"
        intraday_dir = data_dir / "custom_boards" / "intraday"
        history_dir.mkdir(parents=True)
        intraday_dir.mkdir(parents=True)

        latest_path = data_dir / "custom_boards.json"
        index_path = data_dir / "custom_boards" / "index.json"
        latest_path.write_text(
            json.dumps(
                {
                    "date": "2026-06-18",
                    "historyIndex": "./data/custom_boards/index.json",
                    "intradayPath": "./data/custom_boards/intraday/20260618.json",
                    "marketIndex": {"trend": []},
                    "boards": [{"code": "ai", "trend": [], "boardNewHighTrend": []}],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
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
        (history_dir / "20260617.json").write_text(
            json.dumps(
                {
                    "date": "2026-06-17",
                    "marketIndex": {"trend": [{"date": "2026-06-17", "changePercent": 1.2}]},
                    "boards": [{"code": "ai", "trend": [{"date": "2026-06-17", "averageChange": 1.2}], "boardNewHighTrend": []}],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (intraday_dir / "20260618.json").write_text(
            json.dumps(
                {
                    "date": "2026-06-18",
                    "marketIndex": {"trend": [{"date": "2026-06-18", "changePercent": 2.1}]},
                    "boards": [{"code": "ai", "trend": [{"date": "2026-06-18", "averageChange": 2.1}], "boardNewHighTrend": []}],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        payload = load_custom_board_payload(latest_path)

        assert [row["date"] for row in payload["boards"][0]["trend"]] == ["2026-06-17", "2026-06-18"]


if __name__ == "__main__":
    test_loader_hydrates_split_custom_board_payload()
    test_loader_hydrates_intraday_payload_after_archived_history()
    print("custom board history loader behavior ok")
