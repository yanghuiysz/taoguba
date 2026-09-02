# Trend Stats Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dip range column and compact the summary table's numeric columns.

**Architecture:** Keep the existing renderer and fixed-layout CSS. Change only the two table templates, their scoped width rules, and the browser regression test.

**Tech Stack:** HTML templates in JavaScript, CSS, Python Playwright.

## Global Constraints

- Preserve calculations, data files, typography, row heights, and unrelated page sections.
- Preserve existing uncommitted user changes in all touched files.

---

### Task 1: Add a browser regression

**Files:**
- Modify: `scripts/test_trend_stats_table_layout.py`

**Interfaces:**
- Consumes: rendered `.trend-stats-table` and `.trend-stats-dips-table` elements.
- Produces: assertions over visible headers, cell counts, and measured column widths.

- [x] Add assertions that the detail table has six cells per row and no “峰→谷” header.
- [x] Add assertions that summary count/depth columns are narrower than the shape column.
- [x] Run `python scripts/test_trend_stats_table_layout.py` and confirm it fails against the current seven-column layout.

### Task 2: Update templates and widths

**Files:**
- Modify: `web/custom.js`
- Modify: `web/custom.css`

**Interfaces:**
- Consumes: existing `days` and `day.dips` data; the removed peak/trough values remain available in data but are not rendered.
- Produces: a seven-column compact summary table and six-column detail tables.

- [x] Remove the range header and range cells from the detail template.
- [x] Assign compact scoped widths to the summary columns and redistribute the detail-table widths.
- [x] Run `python scripts/test_trend_stats_table_layout.py` and confirm all viewport checks pass.
- [x] Run the focused frontend tests covering the custom page.
