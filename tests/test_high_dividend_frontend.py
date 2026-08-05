import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FrontendContractTests(unittest.TestCase):
    def test_page_exposes_radar_controls_and_detail_sections(self):
        html = (ROOT / "web/high-dividend.html").read_text(encoding="utf-8")
        for token in ["stable", "cyclical", "status-filter", "industry-filter", "search-input", "stock-detail", "PE TTM", "做T位置"]:
            self.assertIn(token, html)
        self.assertIn("high-dividend.css", html)
        self.assertIn("high-dividend.js", html)

    def test_script_loads_snapshot_and_declares_all_states(self):
        js = (ROOT / "web/high-dividend.js").read_text(encoding="utf-8")
        self.assertIn("./data/high_dividend/latest.json", js)
        for state in ["可关注", "等待", "偏贵", "风险观察", "数据不足"]:
            self.assertIn(state, js)
        self.assertIn("/api/high-dividend/config", js)
        self.assertIn("setWatchlist", js)
        for token in ["股息与估值", "做 T 辅助", "市盈率 TTM", "20日支撑", "20日压力", "fitScore"]:
            self.assertIn(token, js)


if __name__ == "__main__":
    unittest.main()
