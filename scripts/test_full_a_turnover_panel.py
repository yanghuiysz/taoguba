from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CUSTOM_JS = ROOT / "web" / "custom.js"


class FullATurnoverPanelTest(unittest.TestCase):
    def test_full_a_turnover_panel_is_wired(self) -> None:
        source = CUSTOM_JS.read_text(encoding="utf-8")

        self.assertIn("function fullATopTurnoverRows", source)
        self.assertIn('data-detail-tab="full-a-turnover"', source)
        self.assertIn("renderFullATurnoverPanel", source)
        self.assertIn("full_a_turnover_top20_history", source)
        self.assertIn("setSortDate(event.target.value)", source)
        self.assertIn("loadFullATurnoverData(state.sortDate)", source)
        self.assertIn("isNew: Boolean(stock.isNew)", source)
        self.assertIn("full-a-new-row", source)
        self.assertIn("isOutsideCustomBoards", source)
        self.assertIn("displayBoardLabel", source)
        self.assertIn("displayBoardSort", source)
        self.assertIn("full-a-outside-row", source)
        self.assertIn("未纳入", source)
        self.assertIn("板块", source)

    def test_missing_history_snapshot_falls_back_to_latest_snapshot(self) -> None:
        source = CUSTOM_JS.read_text(encoding="utf-8")

        self.assertIn("const latestPath = './data/full_a_turnover_top20.json';", source)
        self.assertIn("const fallback = await fetchJsonNoStore(latestPath);", source)
        self.assertIn("requestedDate: date", source)
        self.assertIn("isFallback: true", source)
        self.assertIn("所选${state.fullATurnover?.requestedDate}快照暂缺，显示最近可用数据", source)


if __name__ == "__main__":
    unittest.main()
