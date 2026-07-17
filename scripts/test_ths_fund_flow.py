import json
import tempfile
from pathlib import Path

import ths_fund_flow
from ths_fund_flow import (
    load_or_fetch_snapshot,
    normalize_ths_rows,
    parse_amount_yuan,
    snapshot_path,
)


def test_parse_amount_yuan_supports_chinese_units_and_missing_values():
    assert parse_amount_yuan("1.25亿") == 125_000_000.0
    assert parse_amount_yuan("-7200.36万") == -72_003_600.0
    assert parse_amount_yuan("1350") == 1350.0
    assert parse_amount_yuan("--") is None
    assert parse_amount_yuan(None) is None


def test_normalize_ths_rows_uses_six_digit_codes_and_yuan_amounts():
    rows = normalize_ths_rows(
        [
            {
                "股票代码": 21,
                "股票简称": "深科技",
                "流入资金": "2亿",
                "流出资金": "1.5亿",
                "净额": "5000万",
                "成交额": "8亿",
            }
        ],
        "2026-07-15",
    )
    assert rows == [
        {
            "date": "2026-07-15",
            "code": "000021",
            "name": "深科技",
            "inflow": 200_000_000.0,
            "outflow": 150_000_000.0,
            "mainNetInflow": 50_000_000.0,
            "turnover": 800_000_000.0,
            "source": "ths_stock_fund_flow_individual",
        }
    ]


def test_snapshot_merges_partial_calls_and_existing_same_day_cache(tmp_path, monkeypatch):
    root = tmp_path / "flow"
    path = snapshot_path(root, "20260716")
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "date": "2026-07-16",
                "source": "ths_stock_fund_flow_individual",
                "capturedAt": "2026-07-16T10:00:00",
                "marketClosed": False,
                "rows": [{"date": "2026-07-16", "code": "000001", "mainNetInflow": 1}],
            }
        ),
        encoding="utf-8",
    )
    calls = iter(
        [
            [{"date": "2026-07-16", "code": "000002", "mainNetInflow": 2}],
            [{"date": "2026-07-16", "code": "000003", "mainNetInflow": 3}],
        ]
    )
    monkeypatch.setattr(ths_fund_flow, "normalize_ths_rows", lambda rows, _date: rows)

    payload = load_or_fetch_snapshot(
        "20260716",
        root,
        fetcher=lambda: next(calls),
        force=True,
        minimum_rows=3,
        fetch_attempts=2,
        target_rows=3,
        today="20260716",
        now="2026-07-16 11:00:00",
    )

    assert {row["code"] for row in payload["rows"]} == {"000001", "000002", "000003"}


def test_load_or_fetch_snapshot_reuses_valid_same_day_cache():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "20260715" / "all.json"
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "date": "2026-07-15",
                    "source": "ths_stock_fund_flow_individual",
                    "marketClosed": True,
                    "rows": [
                        {
                            "date": "2026-07-15",
                            "code": "000021",
                            "mainNetInflow": 1.0,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        calls = []
        payload = load_or_fetch_snapshot(
            "20260715", Path(tmp), lambda: calls.append(True), minimum_rows=1
        )
        assert calls == []
        assert payload["rows"][0]["code"] == "000021"


def test_load_or_fetch_snapshot_refreshes_an_intraday_cache():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "20260715" / "all.json"
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "date": "2026-07-15",
                    "source": "ths_stock_fund_flow_individual",
                    "marketClosed": False,
                    "rows": [{"date": "2026-07-15", "code": "000021", "mainNetInflow": 1.0}],
                }
            ),
            encoding="utf-8",
        )
        calls = []

        def fetch():
            calls.append(True)
            return [{"股票代码": "000021", "股票简称": "深科技", "净额": "2万"}]

        payload = load_or_fetch_snapshot(
            "20260715",
            Path(tmp),
            fetch,
            minimum_rows=1,
            now="2026-07-15 15:30:00",
        )
        assert calls == [True]
        assert payload["marketClosed"] is True
        assert payload["rows"][0]["mainNetInflow"] == 20_000.0


def test_load_or_fetch_snapshot_reuses_a_fresh_intraday_cache():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "20260715" / "all.json"
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps({
                "date": "2026-07-15",
                "source": "ths_stock_fund_flow_individual",
                "capturedAt": "2026-07-15T10:30:00",
                "marketClosed": False,
                "rows": [{"date": "2026-07-15", "code": "000021", "mainNetInflow": 1.0}],
            }),
            encoding="utf-8",
        )
        calls = []
        payload = load_or_fetch_snapshot(
            "20260715", Path(tmp), lambda: calls.append(True), minimum_rows=1,
            now="2026-07-15 10:34:59", max_age_seconds=300,
        )
        assert calls == []
        assert payload["capturedAt"] == "2026-07-15T10:30:00"


def test_load_or_fetch_snapshot_does_not_write_cache_when_fetch_fails():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        def fail():
            raise RuntimeError("offline")

        try:
            load_or_fetch_snapshot("20260715", root, fail, minimum_rows=1, today="20260715")
        except RuntimeError as exc:
            assert str(exc) == "offline"
        else:
            raise AssertionError("fetch failure must propagate")
        assert not (root / "20260715" / "all.json").exists()


def test_load_or_fetch_snapshot_never_labels_live_data_as_a_historical_date():
    with tempfile.TemporaryDirectory() as tmp:
        calls = []
        try:
            load_or_fetch_snapshot(
                "20260714",
                Path(tmp),
                lambda: calls.append(True),
                minimum_rows=1,
                today="2026-07-15",
            )
        except ValueError as exc:
            assert "historical THS snapshot is missing" in str(exc)
        else:
            raise AssertionError("historical dates must not fetch the live THS page")
        assert calls == []


if __name__ == "__main__":
    test_parse_amount_yuan_supports_chinese_units_and_missing_values()
    test_normalize_ths_rows_uses_six_digit_codes_and_yuan_amounts()
    test_load_or_fetch_snapshot_reuses_valid_same_day_cache()
    test_load_or_fetch_snapshot_refreshes_an_intraday_cache()
    test_load_or_fetch_snapshot_does_not_write_cache_when_fetch_fails()
    test_load_or_fetch_snapshot_never_labels_live_data_as_a_historical_date()
    print("THS fund flow behavior ok")
