from build_custom_board_data import ths_fund_flow_map


def test_ths_fund_flow_map_matches_codes_and_rejects_another_date():
    payload = {
        "date": "2026-07-15",
        "source": "ths_stock_fund_flow_individual",
        "rows": [
            {
                "date": "2026-07-15",
                "code": "000021",
                "mainNetInflow": 5.0,
                "source": "ths_stock_fund_flow_individual",
            },
            {
                "date": "2026-07-14",
                "code": "000034",
                "mainNetInflow": 6.0,
                "source": "ths_stock_fund_flow_individual",
            },
        ],
    }
    result = ths_fund_flow_map(payload, {"000021", "000034"}, "2026-07-15")
    assert result["000021"][0]["mainNetInflow"] == 5.0
    assert result["000034"] == []


if __name__ == "__main__":
    test_ths_fund_flow_map_matches_codes_and_rejects_another_date()
    print("THS fund flow integration behavior ok")
