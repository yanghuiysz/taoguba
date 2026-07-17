from build_custom_board_data import (
    aggregate_daily_fund_flow,
    apply_intraday_fund_flow,
    merge_fund_flow_fallback,
    ths_fund_flow_map,
)


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


def test_live_ths_flow_is_applied_and_aggregated_with_main_net_only():
    stock = {"code": "000021", "changePercent": 1.2}
    flow = {"date": "2026-07-16", "code": "000021", "mainNetInflow": 5.0, "source": "ths_stock_fund_flow_individual"}
    updated = apply_intraday_fund_flow(stock, flow)
    summary = aggregate_daily_fund_flow([updated], "2026-07-16")
    assert updated["fundFlowDate"] == "2026-07-16"
    assert summary["mainNetInflow"] == 5.0
    assert summary["fundFlowSource"] == "ths_stock_fund_flow_individual"


def test_ths_fills_missing_close_row_without_replacing_official_history():
    primary = {
        "000001": [{"date": "2026-07-16", "mainNetInflow": 10, "source": "eastmoney_stock_individual_fund_flow"}],
        "000002": [{"date": "2026-07-15", "mainNetInflow": 20, "source": "eastmoney_stock_individual_fund_flow"}],
    }
    fallback = {
        "000001": [{"date": "2026-07-16", "mainNetInflow": 99, "source": "ths_stock_fund_flow_individual"}],
        "000002": [{"date": "2026-07-16", "mainNetInflow": 30, "source": "ths_stock_fund_flow_individual"}],
    }
    merged = merge_fund_flow_fallback(primary, fallback, "20260716")
    assert merged["000001"][-1]["mainNetInflow"] == 10
    assert merged["000002"][-1]["mainNetInflow"] == 30


if __name__ == "__main__":
    test_ths_fund_flow_map_matches_codes_and_rejects_another_date()
    print("THS fund flow integration behavior ok")
