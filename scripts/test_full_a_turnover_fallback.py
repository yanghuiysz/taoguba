from __future__ import annotations

import unittest

from build_full_a_turnover_top20 import normalize_sina_rows


class FullATurnoverFallbackTest(unittest.TestCase):
    def test_normalizes_sina_turnover_ranking(self) -> None:
        rows = normalize_sina_rows([{
            "code": "002384", "name": "东山精密", "trade": "262.49",
            "changepercent": 0.814, "volume": 139133544, "amount": 37257847530,
            "turnoverratio": 10.03617,
        }], "20260716")
        self.assertEqual(rows, [{
            "date": "2026-07-16", "code": "002384", "name": "东山精密",
            "close": 262.49, "changePercent": 0.814, "turnover": 37257847530.0,
            "amount": 37257847530.0, "volume": 139133544.0, "turnoverRate": 10.03617,
        }])


if __name__ == "__main__":
    unittest.main()
