# Eastmoney Historical Fund Flow Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill a consistent 15-trading-day Eastmoney net fund-flow series for every custom board and use it in the trend chart and selected-date summary.

**Architecture:** Add a focused Eastmoney history client that parses the documented kline response and can fall back to `curl.exe` on this machine. Feed its per-stock daily rows into the existing board builder, applying an 80% coverage threshold before emitting board totals; keep THS snapshots available for other views while the trend contract explicitly selects Eastmoney.

**Tech Stack:** Python 3.11, urllib/JSON/subprocess curl fallback, existing AKShare-compatible normalized schema, vanilla JavaScript/SVG, Node/Python regression scripts.

---

### Task 1: Direct Eastmoney history client

**Files:**
- Create: `scripts/eastmoney_fund_flow_history.py`
- Create: `scripts/test_eastmoney_fund_flow_history.py`

- [ ] Write a failing test with a fixture containing two `klines`, asserting `parse_history_payload("300347", payload)` maps f51–f65 to the existing normalized keys and rejects `rc != 0` or missing `klines`.
- [ ] Run `python scripts/test_eastmoney_fund_flow_history.py`; expect failure because the module does not exist.
- [ ] Implement `history_url`, `parse_history_payload`, `fetch_json_with_urllib`, `fetch_json_with_curl`, and `fetch_history`. `fetch_history` tries urllib first and uses `curl.exe --fail --silent --show-error --max-time 30` after transport failure. Validate JSON before returning rows.
- [ ] Run the focused test; expect `Eastmoney fund flow history behavior ok`.

Core parser mapping for a comma-split kline:

```python
{
    "date": values[0],
    "mainNetInflow": float(values[1]),
    "smallNetInflow": float(values[2]),
    "mediumNetInflow": float(values[3]),
    "largeNetInflow": float(values[4]),
    "superLargeNetInflow": float(values[5]),
    "mainNetInflowRatio": float(values[6]),
    "smallNetInflowRatio": float(values[7]),
    "mediumNetInflowRatio": float(values[8]),
    "largeNetInflowRatio": float(values[9]),
    "superLargeNetInflowRatio": float(values[10]),
    "close": float(values[11]),
    "changePercent": float(values[12]),
    "code": code,
    "source": "eastmoney_stock_individual_fund_flow",
}
```

### Task 2: Cache and builder integration

**Files:**
- Modify: `scripts/build_custom_board_data.py`
- Create: `scripts/test_eastmoney_fund_flow_integration.py`

- [ ] Write failing tests for atomic cache replacement, latest-cache fallback after a simulated fetch failure, and `aggregate_fund_flow(values, total)` returning `None` below `0.8` coverage.
- [ ] Run `python scripts/test_eastmoney_fund_flow_integration.py`; expect failure for missing integration helpers.
- [ ] Replace the AKShare history fetch implementation with the direct client, retain the existing cache paths, and write via `Path.with_suffix(".tmp")` followed by `replace`.
- [ ] Add a pure aggregation helper returning `(sum_or_none, covered_count, coverage_ratio)` and use it in both current and historical board-row construction. Set source to `eastmoney_stock_individual_fund_flow` only when the 80% threshold passes.
- [ ] Ensure the builder requests Eastmoney history whenever the 15-day trend is built; THS remains available only for consumers outside this trend contract.
- [ ] Run focused integration and existing THS/freshness tests; expect all `ok`.

### Task 3: Trend metadata and UI source consistency

**Files:**
- Modify: `web/custom.js`
- Modify: `scripts/validate_web_data.py`
- Modify: `README.md`
- Modify: `scripts/test_fund_flow_trend_chart.js`

- [ ] Extend the failing JS test to require the exact subtitle `东方财富口径 · 正值流入 / 负值流出`, production source text mapping, and selected-date summary using the Eastmoney row.
- [ ] Extend Python validation tests so a non-null historical fund-flow row must have the Eastmoney source and at least 80% member coverage.
- [ ] Update `fundFlowSourceText`, the panel subtitle, payload metadata, README provenance, and selected-row summary. Do not change red/green/missing-line chart geometry.
- [ ] Run JS/Python focused tests and syntax checks; expect all to pass.

### Task 4: Real backfill and end-to-end verification

**Files:**
- Generate: `data/custom_fund_flow/20260715/*.json` (ignored cache)
- Generate: `web/data/custom_boards.json`

- [ ] Run `python scripts/build_custom_board_data.py --date 20260715 --sleep 0 --intraday --refresh-fund-flow` to fetch all current member stocks and rebuild board history.
- [ ] Assert 23 boards, 15 aligned trading dates, Eastmoney source on every non-null point, coverage `>= 0.8`, and at least 10 non-null/non-zero points per board.
- [ ] Run all fund-flow tests, `python scripts/validate_web_data.py`, JavaScript syntax checks, and `git diff --check`.
- [ ] Open the trend page in Chrome at desktop and 760px widths; verify 15 historical points, source text, positive red/negative green, no strength tags, and no horizontal overflow.
