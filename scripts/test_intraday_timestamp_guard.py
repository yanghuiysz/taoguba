from build_custom_board_data import merge_intraday_rows


def test_merge_intraday_rows_rejects_spot_rows_from_another_date():
    stock_histories = {
        "000001": [
            {"date": "2026-06-16", "code": "000001", "close": 10.0},
        ]
    }
    spot_rows = {
        "000001": {
            "date": "2026-06-17",
            "code": "000001",
            "close": 10.5,
            "source": "intraday_spot_tencent",
            "timestamp": "20260616161445",
        }
    }

    merge_intraday_rows(stock_histories, spot_rows, "20260617")

    assert [row["date"] for row in stock_histories["000001"]] == ["2026-06-16"]


if __name__ == "__main__":
    test_merge_intraday_rows_rejects_spot_rows_from_another_date()
    print("intraday timestamp guard behavior ok")
