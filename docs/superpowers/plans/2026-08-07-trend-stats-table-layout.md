# Trend Stats Table Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep both trend-statistics tables inside their card with tighter columns and no scrollbar at normal content widths.

**Architecture:** Preserve the existing rendering functions and add semantic column classes for deterministic sizing. CSS fixed-layout rules, compact padding, safe wrapping, and a narrow-screen fallback control overflow without changing data.

**Tech Stack:** Vanilla JavaScript, CSS, Python static regression tests.

## Global Constraints

- Do not change trend-statistics data or calculations.
- Avoid horizontal scrolling at desktop and common tablet widths.
- Retain a safe overflow fallback only for extremely narrow screens.
- Render the compact full shape phrase directly in the shape column.

---

### Task 1: Add a failing compact-layout regression test

**Files:**
- Create: `scripts/test_trend_stats_table_layout.py`
- Test: `scripts/test_trend_stats_table_layout.py`

**Interfaces:**
- Consumes: `web/custom.css` and `web/custom.js` as text.
- Produces: assertions for fixed layout, safe wrapping, compact padding, and semantic column classes.

- [ ] **Step 1: Write the failing test**

Create a Python script that asserts `.trend-stats-table` and `.trend-stats-dips-table` use `table-layout: fixed`, cells use `min-width: 0` and safe overflow wrapping, normal containers hide horizontal overflow, the narrow media rule restores `overflow-x: auto`, and renderer output contains semantic column classes.

- [ ] **Step 2: Run test to verify it fails**

Run: `python scripts/test_trend_stats_table_layout.py`

Expected: FAIL because fixed-layout and semantic column rules do not exist yet.

### Task 2: Implement compact responsive table layout

**Files:**
- Modify: `web/custom.js:renderCybTrendStatsTable`
- Modify: `web/custom.js:renderCybTrendDipsDetail`
- Modify: `web/custom.css` trend-statistics table section
- Test: `scripts/test_trend_stats_table_layout.py`

**Interfaces:**
- Consumes: existing day and dip values.
- Produces: unchanged table content with `trend-col-*` classes used by CSS.

- [ ] **Step 1: Add semantic column classes**

Add matching classes to each header and body cell for date/count/depth/shape and sequence/type/time/duration/range columns.

- [ ] **Step 2: Add minimal CSS layout rules**

Set both tables to fixed layout and full width, reduce horizontal padding, apply tabular numerals, constrain each semantic column, and allow shape/range cells to wrap safely inside their assigned width.

- [ ] **Step 3: Add narrow-screen fallback**

Keep normal wrappers at `overflow-x: hidden`; inside the existing responsive section, allow `overflow-x: auto` only below the selected narrow breakpoint and give the detail table a small minimum width.

- [ ] **Step 4: Run focused test**

Run: `python scripts/test_trend_stats_table_layout.py`

Expected: PASS.

### Task 3: Verify behavior and regressions

**Files:**
- Verify: `web/custom.css`
- Verify: `web/custom.js`

**Interfaces:**
- Consumes: completed layout changes.
- Produces: verification evidence only.

- [ ] **Step 1: Run JavaScript syntax validation**

Run: `node --check web/custom.js`

Expected: exit code 0.

- [ ] **Step 2: Run project tests**

Run: `python -m pytest scripts -q`

Expected: all collected tests pass.

- [ ] **Step 3: Inspect the rendered page**

Open the local page, select “趋势统计,” expand the daily details, and inspect desktop plus a narrow viewport. Confirm no value crosses a table border and normal width has no horizontal scrollbar.

### Task 4: Show complete shape phrases

**Files:**
- Modify: `web/custom.js:trendShapeLabel`
- Test: `scripts/test_trend_stats_table_layout.py`

**Interfaces:**
- Consumes: each day’s effective count, maximum depth, and dip count.
- Produces: compact complete phrases such as `多而深 · 分歧加剧`; detailed threshold text remains in the title attribute.

- [ ] **Step 1: Add a failing browser assertion**

Assert the rendered shape cells include the literal phrases `多而深 · 分歧加剧` and `深而猛 · 抛压集中` without visual overflow.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `python scripts/test_trend_stats_table_layout.py`

Expected: FAIL because the current cells only contain short labels.

- [ ] **Step 3: Return compact complete phrases from `trendShapeLabel`**

Prefix each existing conclusion with its shape characteristic while preserving the detailed `trendShapeFull` tooltip.

- [ ] **Step 4: Run focused and project tests**

Run: `python scripts/test_trend_stats_table_layout.py` and `python -m pytest scripts -q`.

Expected: all tests pass.
