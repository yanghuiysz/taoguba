from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from eastmoney_fund_flow_history import (
    SOURCE_NAME,
    build_secid,
    build_url,
    _fetch_with_curl,
    _read_rows,
    fetch_history,
    parse_datapc_response,
    load_or_fetch_history,
    parse_response,
)


def cached_row(date_value: str, value: float, source=SOURCE_NAME) -> dict:
    return {"date": date_value, "code": "000001", "mainNetInflow": value,
            "superLargeNetInflow": value, "largeNetInflow": value,
            "mediumNetInflow": value, "smallNetInflow": value, "source": source}


class EastmoneyFundFlowHistoryTest(unittest.TestCase):
    def test_parse_datapc_history_and_chinese_amount_units(self) -> None:
        payload = {"history": [{"rq": "2026-07-15", "spj": "10.84", "zdf": "1.40%",
            "zllr_je": "-9751.76万", "zllr_jzb": "-9.21%", "cddjlr_je": "1.2亿",
            "cddjlr_jzb": "1.1%", "ddjlr_je": "-8030.50万", "ddjlr_jzb": "-7.58%",
            "zdjlr_je": "3046.98万", "zdjlr_jzb": "2.88%", "xdjlr_je": "6704.78万",
            "xdjlr_jzb": "6.33%"}]}
        row = parse_datapc_response("000001", payload)[0]
        self.assertEqual(row["mainNetInflow"], -97517600.0)
        self.assertEqual(row["superLargeNetInflow"], 120000000.0)
        self.assertEqual(row["mainNetInflowRatio"], -9.21)
        self.assertEqual(row["source"], SOURCE_NAME)

    def test_source_less_legacy_cache_is_migrated_but_ths_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "20260715" / "000001.json"
            path.parent.mkdir(parents=True)
            legacy = {"date": "2026-07-15", "code": "000001", "mainNetInflow": 1,
                      "superLargeNetInflow": 2, "largeNetInflow": 3, "mediumNetInflow": 4, "smallNetInflow": 5}
            path.write_text(json.dumps([legacy]), encoding="utf-8")
            with patch("eastmoney_fund_flow_history.fetch_history") as fetch:
                rows = load_or_fetch_history("000001", "20260715", Path(directory))
            fetch.assert_not_called()
            self.assertEqual(rows[0]["source"], SOURCE_NAME)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))[0]["source"], SOURCE_NAME)
            path.write_text(json.dumps([{**legacy, "source": "ths_stock_fund_flow_individual"}]), encoding="utf-8")
            self.assertIsNone(_read_rows(path))

    @patch("eastmoney_fund_flow_history.subprocess.run")
    @patch("eastmoney_fund_flow_history.shutil.which", return_value="curl.exe")
    def test_curl_uses_system_proxy_configuration(self, _which, run) -> None:
        run.return_value.stdout = "{}"
        _fetch_with_curl("https://example.test", 5)
        command = run.call_args.args[0]
        self.assertNotIn("--noproxy", command)

    def test_parse_day_kline_fields(self) -> None:
        payload = {
            "data": {
                "klines": [
                    "2026-07-14,100,10,20,30,40,1,2,3,4,5,11.25,-1.75",
                    {"f51": "2026-07-15", "f52": "200", "f53": "12", "f54": "22", "f55": "32", "f56": "42", "f57": "6", "f58": "1.2", "f59": "2.2", "f60": "3.2", "f61": "4.2", "f62": "12.5", "f63": "2.5"},
                ]
            }
        }
        rows = parse_response("600000", payload)
        self.assertEqual(rows[0]["source"], SOURCE_NAME)
        self.assertEqual(rows[0]["mainNetInflow"], 100.0)
        self.assertEqual(rows[0]["smallNetInflow"], 10.0)
        self.assertEqual(rows[0]["mediumNetInflow"], 20.0)
        self.assertEqual(rows[0]["largeNetInflow"], 30.0)
        self.assertEqual(rows[0]["superLargeNetInflow"], 40.0)
        self.assertEqual(rows[0]["close"], 11.25)
        self.assertEqual(rows[0]["changePercent"], -1.75)
        self.assertEqual(rows[1]["mainNetInflowRatio"], 6.0)

    def test_market_secid(self) -> None:
        self.assertEqual(build_secid("600000"), "1.600000")
        self.assertEqual(build_secid("000001"), "0.000001")
        self.assertEqual(build_secid("430047"), "0.430047")
        self.assertIn("lmt=120", build_url("000001"))

    def test_parse_sorts_deduplicates_and_keeps_latest_120(self) -> None:
        rows = [f"{date(2026, 1, 1) + timedelta(days=day):%Y-%m-%d},1,2,3,4,5,6,7,8,9,10,11,12" for day in range(130, 0, -1)]
        rows.append(rows[-1])
        parsed = parse_response("000001", {"data": {"klines": rows}})
        self.assertEqual(len(parsed), 120)
        self.assertEqual(len({row["date"] for row in parsed}), 120)
        self.assertEqual(parsed, sorted(parsed, key=lambda row: row["date"]))

    def test_parse_rejects_only_damaged_rows(self) -> None:
        with self.assertRaises(ValueError):
            parse_response("000001", {"data": {"klines": ["bad"]}})
        with self.assertRaises(ValueError):
            parse_response("000001", {"data": {"klines": ["2026-07-15,1,2,3,4,5,6,7,8,9,10,11,12", "bad"]}})

    @patch("eastmoney_fund_flow_history._fetch_datapc_history", side_effect=OSError("datapc failed"))
    @patch("eastmoney_fund_flow_history._fetch_with_python", side_effect=OSError("proxy failed"))
    @patch("eastmoney_fund_flow_history._fetch_with_curl")
    def test_fetch_falls_back_to_system_curl(self, curl, _python, _datapc) -> None:
        curl.return_value = json.dumps({"data": {"klines": ["2026-07-15,1,2,3,4,5,6,7,8,9,10,11,12"]}})
        self.assertEqual(fetch_history("000001")[0]["date"], "2026-07-15")
        curl.assert_called_once()

    @patch("eastmoney_fund_flow_history._fetch_datapc_history", side_effect=OSError("datapc failed"))
    @patch("eastmoney_fund_flow_history.os.name", "nt")
    @patch("eastmoney_fund_flow_history._fetch_with_python")
    @patch("eastmoney_fund_flow_history._fetch_with_curl")
    def test_windows_prefers_curl_then_short_python_fallback(self, curl, python, _datapc) -> None:
        order = []
        def curl_failure(*_args):
            order.append("curl")
            raise OSError("curl failed")
        def python_success(*_args):
            order.append("python")
            return json.dumps({"data": {"klines": ["2026-07-15,1,2,3,4,5,6,7,8,9,10,11,12"]}})
        curl.side_effect = curl_failure
        python.side_effect = python_success
        fetch_history("000001")
        curl.assert_called_once()
        python.assert_called_once()
        self.assertEqual(curl.call_args.args[1], 5)
        self.assertEqual(python.call_args.args[1], 5)
        self.assertEqual(order, ["curl", "python"])

    @patch("eastmoney_fund_flow_history._fetch_datapc_history")
    def test_fetch_prefers_working_datapc_history_endpoint(self, datapc) -> None:
        datapc.return_value = {"history": [{"rq": "2026-07-15", "spj": "10", "zdf": "1%",
            "zllr_je": "1万", "zllr_jzb": "1%", "cddjlr_je": "1万", "cddjlr_jzb": "1%",
            "ddjlr_je": "1万", "ddjlr_jzb": "1%", "zdjlr_je": "1万", "zdjlr_jzb": "1%",
            "xdjlr_je": "1万", "xdjlr_jzb": "1%"}]}
        rows = fetch_history("000001")
        self.assertEqual(rows[0]["date"], "2026-07-15")
        datapc.assert_called_once_with("000001", 5)

    def test_atomic_cache_and_latest_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "20260714" / "000001.json"
            old.parent.mkdir(parents=True)
            old.write_text(json.dumps([cached_row("2026-07-14", 9)]), encoding="utf-8")
            with patch("eastmoney_fund_flow_history.fetch_history", side_effect=RuntimeError("offline")):
                rows = load_or_fetch_history("000001", "20260715", root)
            self.assertEqual(rows[0]["mainNetInflow"], 9)
            self.assertEqual(rows[0]["source"], SOURCE_NAME)
            self.assertFalse((root / "20260715" / "000001.json").exists())

    def test_same_date_cache_without_target_row_is_refetched(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stale = root / "20260715" / "000001.json"
            stale.parent.mkdir(parents=True)
            stale.write_text(json.dumps([{"date": "2026-06-04", "mainNetInflow": 9}]), encoding="utf-8")
            fresh = [{"date": "2026-07-15", "mainNetInflow": 10, "source": SOURCE_NAME}]
            with patch("eastmoney_fund_flow_history.fetch_history", return_value=fresh) as fetch:
                rows = load_or_fetch_history("000001", "20260715", root)
            fetch.assert_called_once_with("000001")
            self.assertEqual(rows, fresh)

    def test_empty_same_day_cache_does_not_hide_older_valid_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / "20260715" / "000001.json"
            current.parent.mkdir(parents=True)
            current.write_text("[]", encoding="utf-8")
            older = root / "20260714" / "000001.json"
            older.parent.mkdir(parents=True)
            older.write_text(json.dumps([cached_row("2026-07-14", 9)]), encoding="utf-8")
            with patch("eastmoney_fund_flow_history.fetch_history", side_effect=RuntimeError("offline")):
                rows = load_or_fetch_history("000001", "20260715", root)
            self.assertEqual(rows[0]["mainNetInflow"], 9)

    def test_target_before_returned_window_is_rejected_without_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [{"date": "2026-07-01", "code": "000001", "mainNetInflow": 1, "source": SOURCE_NAME}]
            with patch("eastmoney_fund_flow_history.fetch_history", return_value=rows):
                with self.assertRaisesRegex(ValueError, "outside 120-day window"):
                    load_or_fetch_history("000001", "20260101", root)
            self.assertFalse((root / "20260101" / "000001.json").exists())

    def test_damaged_cache_is_rejected_and_older_cache_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / "20260715" / "000001.json"
            current.parent.mkdir(parents=True)
            current.write_text(json.dumps([{"date": "bad", "code": "999999", "mainNetInflow": 1, "source": "wrong"}]), encoding="utf-8")
            older = root / "20260714" / "000001.json"
            older.parent.mkdir(parents=True)
            older.write_text(json.dumps([
                cached_row("2026-07-14", 2),
                cached_row("2026-07-13", 1),
            ]), encoding="utf-8")
            with patch("eastmoney_fund_flow_history.fetch_history", side_effect=RuntimeError("offline")):
                rows = load_or_fetch_history("000001", "20260715", root)
            self.assertEqual([row["date"] for row in rows], ["2026-07-13", "2026-07-14"])


if __name__ == "__main__":
    unittest.main()
