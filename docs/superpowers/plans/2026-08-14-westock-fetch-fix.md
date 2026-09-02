# Westock Fetch Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably fetch five days of ChiNext minute data through westock on Windows and rebuild the major-dip panel data.

**Architecture:** Replace the shell command string with an explicit executable and argument list. Treat westock business-error text as failure, then fall back to Eastmoney; keep all statistical algorithms unchanged.

**Tech Stack:** Python 3.11 `subprocess`, Windows `npx.cmd`, `unittest`, westock-data-clawhub 1.0.4.

## Global Constraints

- Only modify westock process startup, output validation, and source priority.
- Do not modify the 15-minute consecutive-bearish-candle algorithm.
- Do not modify the 0.8% decline / 0.8% rebound algorithm.
- Do not depend on WorkBuddy private installation or session files.

---

### Task 1: Make westock invocation deterministic

**Files:**
- Modify: `scripts/build_cyb_trend_stats.py`
- Test: `scripts/test_cyb_strength_system.py`

**Interfaces:**
- Consumes: `fetch_westock_minute_days(days: int)`
- Produces: `build_westock_command(days: int) -> list[str]` and validated minute records

- [ ] Write a failing test asserting an argument list, `shell=False`, and `npx.cmd` on Windows.
- [ ] Run the focused test and confirm failure comes from the current command string.
- [ ] Implement explicit executable resolution and reject westock output containing `执行失败` or no parsed records.
- [ ] Run the focused test and full unit suite.

### Task 2: Fetch and rebuild

**Files:**
- Update generated data: `web/data/cyb_trend_stats.json`
- Update generated history: `web/data/cyb_trend_stats_history/*.json`

**Interfaces:**
- Consumes: corrected `fetch_minute_days(5)`
- Produces: five rebuilt trading days containing `majorDips` and aggregate fields

- [ ] Execute `python scripts/build_cyb_trend_stats.py --days 5 --force`.
- [ ] Inspect 2026-08-12, 2026-08-13, and 2026-08-14 for populated major-dip fields.
- [ ] Run Python compilation, all unit tests, data validation, JavaScript syntax check, and browser layout verification.
