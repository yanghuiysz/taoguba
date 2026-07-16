# Board Swing Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sortable “板块排行” Tab that compares all custom boards over 3-day and 5-day windows and links each row to that board’s swing detail.

**Architecture:** Compute board rows in `web/custom-swing.js` from the already hydrated board and market-index trend data, capped at `state.sortDate`. Render the ranking as a sibling Tab to “波段观察”, retaining all state and navigation in the existing swing module; no backend or payload changes are required.

**Tech Stack:** Vanilla JavaScript, CSS, Node source-execution behavior tests.

---

### Task 1: Board window metrics and scoring

**Files:**
- Create: `scripts/test_board_swing_ranking.js`
- Modify: `web/custom-swing.js`

- [ ] **Step 1: Write the failing metric test**

Create a Node test that extracts and executes the production helpers. Use two synthetic boards with six dated rows and assert:

```js
const metric = boardRankingBaseMetric(board, '2026-07-15');
assert.equal(metric.amount3, 1200);
assert.equal(metric.amount5, 1500);
assert.equal(metric.mainNetInflow3, 120);
assert.equal(metric.mainNetInflow5, null); // one missing day invalidates the full window
assert.equal(metric.return3, compoundReturn([1, 2, 3]));
assert.equal(metric.relative3, metric.return3 - compoundReturn([0.5, 0.5, 0.5]));
assert.ok(metric.drawdown >= 0);
```

Also assert rows after the selected date are excluded, fewer than three days yield null windows, and `scoreBoardRankingRows` applies 58% five-day turnover plus 42% five-day return with missing-core rows last.

- [ ] **Step 2: Run the metric test and confirm RED**

Run: `node scripts/test_board_swing_ranking.js`
Expected: FAIL because `boardRankingBaseMetric` and `scoreBoardRankingRows` do not exist.

- [ ] **Step 3: Implement minimal production helpers**

Add pure helpers in `web/custom-swing.js`:

```js
function boardRankingBaseMetric(board, selectedDate) { /* selected-date windows and totals */ }
function normalizeBoardRankingMetric(rows, key) { /* cross-sectional 0..100; equal values => 50 */ }
function scoreBoardRankingRows(boards, selectedDate) { /* score, status, default rank */ }
```

Use existing `compoundReturn`, `maxDrawdownFromChanges`, `getBoardChange`, `getIndexChange`, `safeNumber`, and daily `totalTurnover`/`mainNetInflow`. Require complete 3-day or 5-day windows and complete fund-flow values within each window.

- [ ] **Step 4: Run metric test and confirm GREEN**

Run: `node scripts/test_board_swing_ranking.js`
Expected: `board swing ranking behavior ok`.

### Task 2: Tab, table, sorting, and jump interaction

**Files:**
- Modify: `scripts/test_board_swing_ranking.js`
- Modify: `web/custom-swing.js`
- Modify: `web/custom-swing.css`

- [ ] **Step 1: Extend the test for UI wiring and confirm RED**

Assert the production source contains:

```js
const BOARD_RANKING_TAB = 'board-ranking';
tab.textContent = '板块排行';
data-swing-board-ranking-sort-key=
data-board-ranking-code=
```

Assert the rendered table contains all specified headers, positive/negative classes, “暂无” for nulls, and a row link carrying the board code. Assert CSS includes `.board-ranking-table`, `.board-ranking-status`, and a responsive table rule.

Run: `node scripts/test_board_swing_ranking.js`
Expected: FAIL because the Tab and table are not rendered.

- [ ] **Step 2: Implement UI and interaction**

Add module-level sort state defaulting to `{ key: 'sortScore', direction: 'desc' }`, render the full table, inject the new Tab beside “波段观察”, and handle:

```js
state.selectedCode = button.dataset.boardRankingCode;
state.detailTab = SWING_TAB;
render();
```

Add table-header sort handlers using numeric null-last comparison and existing signed classes. Add compact status badges and horizontal overflow at narrow widths without altering the existing stock ranking.

- [ ] **Step 3: Run focused and regression verification**

Run:

```powershell
node scripts/test_board_swing_ranking.js
node scripts/test_fund_flow_trend_chart.js
node scripts/test_sidebar_board_fund_flow.js
node scripts/test_null_fund_flow_rendering.js
python scripts/validate_web_data.py
git diff --check
```

Expected: every test exits 0, data validation reports both datasets `OK`, and diff check reports no whitespace errors.
