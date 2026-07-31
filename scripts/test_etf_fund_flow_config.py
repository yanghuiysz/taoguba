from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "web/data/etf_fund_flow_config.json"


class EtfFundFlowConfigTest(unittest.TestCase):
    def test_registry_has_exact_approved_universe(self):
        payload = json.loads(CONFIG.read_text(encoding="utf-8"))
        rows = payload["etfs"]
        self.assertEqual(payload["benchmarkCode"], "510300")
        self.assertEqual(len(rows), 30)
        self.assertEqual(len({row["code"] for row in rows}), 30)
        self.assertEqual(sum(row["scope"] == "broad" for row in rows), 5)
        self.assertEqual(sum(row["scope"] == "industry" for row in rows), 25)
        self.assertTrue(all(len(row["code"]) == 6 and row["code"].isdigit() for row in rows))
        self.assertTrue(all(row["exchange"] in {"SSE", "SZSE"} for row in rows))
        self.assertEqual(payload["boardMappings"]["512800"], ["yinhang"])
        self.assertEqual(payload["boardMappings"]["515170"], ["shipinyinliao"])


if __name__ == "__main__":
    unittest.main()
