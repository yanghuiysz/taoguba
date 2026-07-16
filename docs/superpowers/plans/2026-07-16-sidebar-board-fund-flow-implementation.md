# Sidebar Board Fund Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each board's selected-date main net fund inflow or outflow in the left sidebar card.

**Architecture:** Reuse each board's existing `trend` row for `state.sortDate`; do not add requests or persisted fields. A small formatter returns the signed label and tone, and the sidebar renderer inserts it below the existing setup summary.

**Tech Stack:** Vanilla JavaScript, CSS, Node-based source behavior tests.

---

### Task 1: Sidebar fund-flow presentation

**Files:**
- Create: `scripts/test_sidebar_board_fund_flow.js`
- Modify: `web/custom.js`
- Modify: `web/custom.css`

- [ ] **Step 1: Write the failing test**

Assert that selected-date positive, negative, zero, and missing values render as `主力净流入 +1.20亿`, `主力净流出 -8000.00万`, `主力净流入 0.00万`, and `资金暂无`, with positive/zero using the red inflow class and negative using the green outflow class.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test_sidebar_board_fund_flow.js`
Expected: FAIL because the sidebar fund-flow helper and markup do not exist.

- [ ] **Step 3: Write minimal implementation**

Add `sidebarBoardFundFlow(board, date)` using the existing `rowMainNetInflow`, `amountText`, and selected trend row. Render its label in `.board-fund-flow` and add compact CSS without changing card sorting or data loading.

- [ ] **Step 4: Run focused and regression tests**

Run: `node scripts/test_sidebar_board_fund_flow.js; node scripts/test_fund_flow_trend_chart.js; node scripts/test_null_fund_flow_rendering.js`
Expected: all commands print their `ok` message and exit 0.

- [ ] **Step 5: Validate generated dashboard data**

Run: `python scripts/validate_web_data.py`
Expected: custom board and turnover data both report `OK`.
