from pathlib import Path

from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:8766/web/custom.html"
SCREENSHOT_DIR = Path("output/playwright")


def table_overflow(table):
    return table.evaluate(
        """table => {
          const wrapper = table.parentElement;
          const card = table.closest('.card');
          const tableBox = table.getBoundingClientRect();
          const wrapperBox = wrapper.getBoundingClientRect();
          const cardBox = card.getBoundingClientRect();
          const overflowingCells = [...table.querySelectorAll('th, td')]
            .filter(cell => {
              const box = cell.getBoundingClientRect();
              return box.left < tableBox.left - 0.5 || box.right > tableBox.right + 0.5;
            })
            .map(cell => cell.textContent.trim());
          return {
            wrapperClientWidth: wrapper.clientWidth,
            wrapperScrollWidth: wrapper.scrollWidth,
            tableWidth: tableBox.width,
            wrapperOutsideCard:
              wrapperBox.left < cardBox.left - 0.5 || wrapperBox.right > cardBox.right + 0.5,
            overflowingCells,
          };
        }"""
    )


def main():
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1180, "height": 900})

        page.add_init_script(
            """(() => {
              const realFetch = window.fetch.bind(window);
              window.fetch = (...args) => {
                const url = String(args[0]);
                if (!url.includes('cyb_trend_stats.json')) return realFetch(...args);
                return new Promise(resolve => setTimeout(async () => {
                  const response = await realFetch(...args);
                  const payload = await response.json();
                  const days = payload.days || [];
                  if (days.length) {
                    delete days[0].avgRecoveryRate;
                    delete days[0].closePosition;
                    delete days[0].marketState;
                    delete days[0].intervals;
                    const latest = days[days.length - 1];
                    Object.assign(latest, {
                      dataQuality: 'complete',
                      marketState: '高位分歧',
                      riskLevel: '升温',
                      riskChange: '升温',
                      trendStructure: '上升结构',
                      avgRecoveryRate: 68,
                      medianRecovery50Minutes: 12,
                      closePosition: 81,
                      reasons: ['有效下探3次', '平均收复68%', '上升结构'],
                      majorDipCount: 2,
                      majorDipMaxDepth: 1.45,
                      majorDipAvgDepth: 1.15,
                      majorDipConfirmedCount: 2,
                      majorDipOpenCount: 0,
                      majorDips: [
                        {wave: 1, start: '09:41', end: '10:11', depth: 0.85, confirmTime: '10:36', status: '已确认'},
                        {wave: 2, start: '10:42', end: '13:19', depth: 1.45, confirmTime: '13:38', status: '已确认'},
                      ],
                    });
                    (latest.dips || []).forEach((dip, index) => Object.assign(dip, {
                      recoveryRate: index ? 54 : 82,
                      recovery50Minutes: index ? 18 : 7,
                    }));
                  }
                  resolve(new Response(JSON.stringify(payload), {
                    status: response.status,
                    headers: {'Content-Type': 'application/json'},
                  }));
                }, 600));
              };
            })()"""
        )
        page.goto(URL, wait_until="domcontentloaded")
        trend_tab = page.locator('[data-detail-tab="trend-stats"]')
        trend_tab.click()
        if "active" not in (page.locator('[data-detail-tab="trend-stats"]').get_attribute("class") or ""):
            raise AssertionError("trend stats tab should become active on the first click before data finishes loading")
        page.locator(".trend-stats-table").wait_for()
        page.locator(".cyb-strength-summary").wait_for()
        page.locator(".major-dip-panel").wait_for()
        if "0.8%下跌确认 + 0.8%反弹确认" not in page.locator(".major-dip-panel").inner_text():
            raise AssertionError("major dip panel should explain its independent confirmation rule")
        page.locator(".major-dip-chart").wait_for()
        major_headers = page.locator(".major-dip-summary-table thead th").all_text_contents()
        if major_headers != ["日期", "主要下探", "最大深度", "平均深度", "已确认", "收盘未确认"]:
            raise AssertionError(f"unexpected major dip summary headers: {major_headers}")
        page.locator(".major-dip-detail summary").click()
        major_detail_headers = page.locator(".major-dip-detail-table").last.locator("thead th").all_text_contents()
        if major_detail_headers != ["#", "高点时间", "低点时间", "深度", "反弹确认", "状态"]:
            raise AssertionError(f"unexpected major dip detail headers: {major_detail_headers}")
        summary_text = page.locator(".cyb-strength-summary").inner_text()
        for expected in ("高位分歧", "升温", "上升结构", "68%", "81%", "12 分钟"):
            if expected not in summary_text:
                raise AssertionError(f"strength summary missing {expected!r}: {summary_text}")
        page.locator(".trend-stats-detail summary").click()
        page.locator(".trend-stats-dips-table").first.wait_for()

        detail_headers = page.locator(".trend-stats-dips-table").first.locator("thead th")
        if detail_headers.count() != 8:
            raise AssertionError(
                f"detail table should have 8 columns with recovery metrics, got {detail_headers.count()}"
            )
        if "峰→谷" in detail_headers.all_text_contents():
            raise AssertionError("detail table still renders the peak-to-trough column")
        detail_cell_counts = page.locator(".trend-stats-dips-table tbody tr").evaluate_all(
            "rows => rows.map(row => row.cells.length)"
        )
        if any(count != 8 for count in detail_cell_counts):
            raise AssertionError(f"detail rows should have 8 cells: {detail_cell_counts}")

        summary_headers = page.locator(".trend-stats-table thead th").all_text_contents()
        for expected in ("平均收复", "收盘位置", "市场状态"):
            if expected not in summary_headers:
                raise AssertionError(f"summary table missing {expected}: {summary_headers}")
        legacy_cells = page.locator(".trend-stats-table tbody tr").first.locator("td").all_text_contents()
        if legacy_cells.count("—") < 3:
            raise AssertionError(f"legacy row should show missing v2 metrics as dashes: {legacy_cells}")

        summary = page.locator(".trend-stats-table")
        summary_widths = summary.locator("thead th").evaluate_all(
            "cells => cells.map(cell => cell.getBoundingClientRect().width)"
        )
        shape_width = summary_widths[-1]
        numeric_widths = summary_widths[1:8]
        if any(width >= shape_width * 0.22 for width in numeric_widths):
            raise AssertionError(
                f"summary numeric columns are not compact relative to shape: {summary_widths}"
            )
        shape_alignment = summary.locator("tbody .trend-col-shape").first.evaluate(
            "cell => getComputedStyle(cell).textAlign"
        )
        if shape_alignment != "left":
            raise AssertionError(
                f"shape labels should start beside the numeric columns, got text-align: {shape_alignment}"
            )

        shape_text = page.locator(".trend-stats-table .trend-col-shape").all_text_contents()
        expected_shapes = {"多而深 · 分歧加剧", "深而猛 · 抛压集中"}
        missing_shapes = expected_shapes.difference(text.strip() for text in shape_text)
        if missing_shapes:
            raise AssertionError(f"shape column is missing complete phrases: {sorted(missing_shapes)}")

        failures = []
        for viewport_width in (1180, 901, 900, 768):
            page.set_viewport_size({"width": viewport_width, "height": 900})
            page.locator(".trend-stats-detail").evaluate("details => details.open = true")
            tables = page.locator(".trend-stats-table, .trend-stats-dips-table, .major-dip-summary-table, .major-dip-detail-table")
            for index in range(tables.count()):
                table = tables.nth(index)
                selector = table.get_attribute("class")
                result = table_overflow(table)
                if viewport_width >= 1180 and result["wrapperScrollWidth"] > result["wrapperClientWidth"] + 1:
                    failures.append(
                        f"{selector} needs horizontal scrolling at {viewport_width}px: {result}"
                    )
                if result["overflowingCells"]:
                    failures.append(
                        f"{selector} has cells outside the table at {viewport_width}px: {result}"
                    )
                if result["wrapperOutsideCard"]:
                    failures.append(
                        f"{selector} wrapper leaves its card at {viewport_width}px: {result}"
                    )

            page.screenshot(
                path=str(SCREENSHOT_DIR / f"trend-stats-table-layout-{viewport_width}.png"),
                full_page=True,
            )
        browser.close()

    if failures:
        raise AssertionError("\n".join(failures))
    print("trend stats tables fit at 1180px, 901px, 900px and 768px")


if __name__ == "__main__":
    main()
