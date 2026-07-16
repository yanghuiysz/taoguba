import json
import tempfile
from datetime import datetime
from pathlib import Path

from auction_probe import append_snapshot


def test_append_snapshot_splits_frontend_summary_from_raw_samples():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        summary_dir = root / "auction_snapshots"
        raw_dir = summary_dir / "raw"

        append_snapshot(
            "20260618",
            datetime(2026, 6, 18, 9, 20, 0),
            {
                "000001": {
                    "code": "000001",
                    "name": "sample",
                    "changePercent": 1.23,
                    "turnover": 12000000,
                }
            },
            [{"boardCode": "ai", "boardName": "AI", "score": 88}],
            snapshot_dir=summary_dir,
            raw_dir=raw_dir,
            config={"boards": [{"code": "ai", "name": "AI", "stocks": [{"code": "000001"}]}]},
        )

        summary = json.loads((summary_dir / "20260618.summary.json").read_text(encoding="utf-8"))
        raw = json.loads((raw_dir / "20260618.json").read_text(encoding="utf-8"))

        assert not (summary_dir / "20260618.json").exists()
        assert summary["latestAlerts"][0]["boardCode"] == "ai"
        assert summary["sampleCount"] == 1
        assert "quotes" not in summary["samples"][0]
        assert summary["samples"][0]["boardSnapshots"]["ai"]["totalTurnover"] == 12000000
        assert raw["samples"][0]["quotes"]["000001"]["turnover"] == 12000000


if __name__ == "__main__":
    test_append_snapshot_splits_frontend_summary_from_raw_samples()
    print("auction snapshot split behavior ok")
