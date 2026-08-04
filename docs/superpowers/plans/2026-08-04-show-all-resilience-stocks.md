# 板块内韧性股全量展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“板块内韧性股排行”渲染当前板块全部有效成员，不再截断为前 12 名。

**Architecture:** 保持 `stockResilienceRows` 和 `sortedStockRows` 的计算、过滤及排序逻辑不变，只移除 `renderStockTable` 的展示截断。通过直接执行生产渲染函数的 Node 回归测试，验证第 13 条及之后的数据出现在 HTML 中。

**Tech Stack:** 原生 JavaScript、Node.js 行为测试、HTML 字符串渲染。

## Global Constraints

- 展示 `board.stocks` 中全部具有有效韧性评分的成员。
- 保留现有综合排序、表头排序和连续排名。
- 不改变评分公式、成员采集口径或其他排行表。
- 不增加分页、折叠或新的页面状态。

---

### Task 1: 全量渲染韧性股排行

**Files:**
- Create: `scripts/test_stock_resilience_rendering.js`
- Modify: `web/custom-swing.js:753-755`
- Modify: `web/custom-swing.js:809-810`

**Interfaces:**
- Consumes: `sortedStockRows(board): Array<StockRankingRow>`。
- Produces: `renderStockTable(board): string`，HTML 中包含排序结果的全部行。

- [ ] **Step 1: 写入失败的渲染回归测试**

从 `web/custom-swing.js` 截取生产函数 `renderStockTable`，通过 `new Function` 注入13条测试排行数据和最小格式化依赖。断言 HTML 同时包含第一只股票和第13只股票，并包含“展示板块全部有效成员”的辅助说明：

```javascript
const rows = Array.from({ length: 13 }, (_, index) => ({
  code: String(index + 1).padStart(6, '0'),
  name: `stock-${index + 1}`,
  sortScore: 100 - index,
  amount3: 1,
  amount5: 1,
  mainNetInflow3: null,
  mainNetInflow5: null,
  ret3: 1,
  ret5: 1,
  rel3: 1,
  rel5: 1,
  drawdown: 0,
  macdLabel: 'test',
  macdScore: 50,
}));

const html = renderStockTable({ code: 'board' });
if (!html.includes('stock-1') || !html.includes('stock-13')) {
  throw new Error('stock resilience table must render every valid member');
}
if (!source.includes('展示板块全部有效成员')) {
  throw new Error('full-member display note missing');
}
```

- [ ] **Step 2: 运行测试并确认因第13条被截断而失败**

Run: `node scripts/test_stock_resilience_rendering.js`

Expected: FAIL，错误为 `stock resilience table must render every valid member`。

- [ ] **Step 3: 实施最小改动**

将 `const rows = sortedStockRows(board).slice(0, 12);` 改为 `const rows = sortedStockRows(board);`，并将排行标题旁的说明改为“展示板块全部有效成员；按5日成交额与5日涨幅综合排序”。

- [ ] **Step 4: 运行新增测试并确认通过**

Run: `node scripts/test_stock_resilience_rendering.js`

Expected: 输出 `stock resilience rendering behavior ok`，退出码为0。

- [ ] **Step 5: 运行相关回归验证**

Run: `node scripts/test_board_swing_ranking.js`

Expected: 输出 `board swing ranking behavior ok`，退出码为0。

Run: `python scripts/validate_web_data.py`

Expected: 数据验证完成，退出码为0。

- [ ] **Step 6: 检查差异并提交实现**

Run: `git diff --check -- web/custom-swing.js scripts/test_stock_resilience_rendering.js`

Run: `git add -- web/custom-swing.js scripts/test_stock_resilience_rendering.js`

Run: `git commit -m "fix: show all resilience stocks"`
