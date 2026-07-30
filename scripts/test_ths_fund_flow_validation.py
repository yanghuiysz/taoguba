from validate_web_data import validate_fund_flow_row


def test_validate_fund_flow_row_flags_wrong_date_and_accepts_missing_amount():
    assert (
        validate_fund_flow_row(
            {
                "date": "2026-07-15",
                "mainNetInflow": None,
                "fundFlowLatestDate": None,
                "fundFlowStockCount": 0,
                "stockCount": 21,
            }
        )
        == []
    )
    errors = validate_fund_flow_row(
        {
            "date": "2026-07-15",
            "mainNetInflow": 10.0,
            "fundFlowLatestDate": "2026-07-14",
            "fundFlowStockCount": 21,
            "stockCount": 21,
        }
    )
    assert "fund flow date mismatch" in errors


def test_validate_fund_flow_row_allows_coverage_above_price_stock_count():
    errors = validate_fund_flow_row(
        {
            "date": "2026-07-15",
            "mainNetInflow": 10.0,
            "fundFlowLatestDate": "2026-07-15",
            "fundFlowSource": "eastmoney_stock_individual_fund_flow",
            "fundFlowStockCount": 22,
            "stockCount": 21,
            "stocks": [{} for _ in range(22)],
        }
    )
    assert errors == []


def test_validate_fund_flow_row_accepts_intraday_ths_source():
    errors = validate_fund_flow_row({
        "date": "2026-07-16",
        "mainNetInflow": 10.0,
        "fundFlowLatestDate": "2026-07-16",
        "fundFlowSource": "ths_stock_fund_flow_individual",
        "fundFlowStockCount": 9,
        "stockCount": 10,
    })
    assert errors == []


def test_validate_fund_flow_row_accepts_mixed_known_sources():
    errors = validate_fund_flow_row({
        "date": "2026-07-30",
        "mainNetInflow": 10.0,
        "fundFlowLatestDate": "2026-07-30",
        "fundFlowSource": "mixed",
        "fundFlowStockCount": 5,
        "stocks": [{}, {}, {}, {}, {}],
    })
    assert errors == []


def test_validate_fund_flow_row_rejects_coverage_above_member_rows():
    errors = validate_fund_flow_row(
        {
            "date": "2026-07-15",
            "mainNetInflow": 10.0,
            "fundFlowLatestDate": "2026-07-15",
            "fundFlowSource": "eastmoney_stock_individual_fund_flow",
            "fundFlowStockCount": 23,
            "stockCount": 21,
            "stocks": [{} for _ in range(22)],
        }
    )
    assert "fund flow coverage exceeds stock count" in errors


def test_validate_fund_flow_row_rejects_unknown_source_for_present_amount():
    errors = validate_fund_flow_row(
        {
            "date": "2026-07-15",
            "mainNetInflow": 10.0,
            "fundFlowLatestDate": "2026-07-15",
            "fundFlowSource": "unknown_fund_flow_source",
            "fundFlowStockCount": 1,
            "stocks": [{}],
        }
    )
    assert "fund flow source mismatch" in errors
    low_coverage_errors = validate_fund_flow_row(
        {
            "date": "2026-07-15",
            "mainNetInflow": 10.0,
            "fundFlowLatestDate": "2026-07-15",
            "fundFlowSource": "eastmoney_stock_individual_fund_flow",
            "fundFlowStockCount": 3,
            "stocks": [{}, {}, {}, {}, {}],
        }
    )
    assert "fund flow amount present below 80% coverage" in low_coverage_errors


if __name__ == "__main__":
    test_validate_fund_flow_row_flags_wrong_date_and_accepts_missing_amount()
    test_validate_fund_flow_row_allows_coverage_above_price_stock_count()
    test_validate_fund_flow_row_rejects_coverage_above_member_rows()
    test_validate_fund_flow_row_rejects_non_eastmoney_source_for_present_amount()
    print("THS fund flow validation behavior ok")
