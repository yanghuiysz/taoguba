import unittest
from datetime import date

from scripts.high_dividend_rules import classify_pool, normalized_dividend, target_yield, evaluate_stock


CONFIG = {
    "stableIndustries": ["银行", "公用事业"],
    "cyclicalIndustries": ["煤炭", "航运"],
    "poolOverrides": {"600000": "cyclical"},
}


def stock(**overrides):
    base = {
        "code": "600036", "name": "招商银行", "industry": "银行", "price": 34.0,
        "listingDate": "2002-04-09", "avgTurnover20": 900_000_000,
        "dividends": [1.52, 1.68, 1.75, 1.90, 2.00], "dividendYears": [2021, 2022, 2023, 2024, 2025],
        "ttmDividend": 2.0, "latestProfit": 100.0, "payoutRatio": 0.55,
        "bondYield": 0.018, "bondDate": "2026-08-01", "qualityScore": 84,
    }
    base.update(overrides)
    return base


class RulesTests(unittest.TestCase):
    def test_pool_override_wins(self):
        self.assertEqual(classify_pool("银行", CONFIG, "600000"), "cyclical")
        self.assertEqual(classify_pool("银行", CONFIG, "600036"), "stable")

    def test_normalized_dividend_differs_by_pool(self):
        values = [1, 2, 3, 4, 20]
        self.assertEqual(normalized_dividend(values, "stable"), 4)
        self.assertEqual(normalized_dividend(values, "cyclical"), 2)

    def test_dual_anchor(self):
        self.assertEqual(target_yield("stable", 0.018), 0.05)
        self.assertAlmostEqual(target_yield("stable", 0.035), 0.06)
        self.assertEqual(target_yield("cyclical", 0.018), 0.06)

    def test_state_priorities(self):
        as_of = date(2026, 8, 4)
        self.assertEqual(evaluate_stock(stock(price=None), CONFIG, as_of)["state"], "数据不足")
        self.assertEqual(evaluate_stock(stock(latestProfit=-1), CONFIG, as_of)["state"], "风险观察")
        self.assertEqual(evaluate_stock(stock(price=50), CONFIG, as_of)["state"], "偏贵")
        self.assertEqual(evaluate_stock(stock(price=30), CONFIG, as_of)["state"], "可关注")
        self.assertEqual(evaluate_stock(stock(price=38), CONFIG, as_of)["state"], "等待")

    def test_stale_bond_is_missing(self):
        result = evaluate_stock(stock(bondDate="2026-07-20"), CONFIG, date(2026, 8, 4))
        self.assertEqual(result["state"], "数据不足")
        self.assertTrue(any("国债" in reason for reason in result["reasons"]))

    def test_required_financial_fields_stay_missing(self):
        as_of = date(2026, 8, 4)
        for field in ["avgTurnover20", "listingDate", "latestProfit", "ttmDividend", "qualityScore"]:
            result = evaluate_stock(stock(**{field: None}), CONFIG, as_of)
            self.assertEqual(result["state"], "数据不足", field)
        for field, value in [("price", float("inf")), ("bondYield", float("-inf")), ("qualityScore", float("inf")), ("price", 0)]:
            self.assertEqual(evaluate_stock(stock(**{field: value}), CONFIG, as_of)["state"], "数据不足")

    def test_malformed_dividend_values_do_not_abort(self):
        result = evaluate_stock(stock(dividends=[1.5, "bad", 1.8, 1.9, 2.0]), CONFIG, date(2026, 8, 4))
        self.assertIn(result["state"], {"可关注", "等待", "偏贵"})
        self.assertEqual(evaluate_stock(stock(dividendYears=None), CONFIG, date(2026, 8, 4))["state"], "数据不足")

    def test_expensive_reasons_only_include_triggered_conditions(self):
        result = evaluate_stock(stock(price=50, ttmDividend=3.0), CONFIG, date(2026, 8, 4))
        self.assertEqual(result["state"], "偏贵")
        self.assertIn("价格高于目标关注价", result["reasons"])
        self.assertFalse(any("股息率明显低于" in reason for reason in result["reasons"]))


if __name__ == "__main__":
    unittest.main()
