import tempfile
from pathlib import Path
from unittest.mock import patch

from build_custom_board_data import build_fund_flow_map, fund_flow_cache_path


def test_build_fund_flow_map_refreshes_a_target_date_cache_with_stale_rows():
    with tempfile.TemporaryDirectory() as tmp:
        cache_dir = Path(tmp)
        target_date = "20260715"
        stale_rows = [{"date": "2026-07-10", "code": "000001", "mainNetInflow": 1.0}]
        fresh_rows = [{"date": "2026-07-15", "code": "000001", "mainNetInflow": 2.0}]
        cache_path = fund_flow_cache_path(cache_dir, "000001", target_date)
        cache_path.parent.mkdir(parents=True)
        cache_path.write_text(__import__("json").dumps(stale_rows), encoding="utf-8")

        with patch("build_custom_board_data.fetch_fund_flow_history", return_value=fresh_rows) as fetch:
            result, errors = build_fund_flow_map(
                {"000001"}, target_date, cache_dir, refresh=False, sleep=0
            )

        assert errors == []
        assert fetch.call_count == 1
        assert result["000001"][-1]["date"] == "2026-07-15"


if __name__ == "__main__":
    test_build_fund_flow_map_refreshes_a_target_date_cache_with_stale_rows()
    print("fund flow freshness behavior ok")
