# High Dividend Radar Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily high-dividend radar that screens Shanghai/Shenzhen A-shares into stable-income and cyclical-income pools, explains five observation states, and supports a personal watchlist and pool overrides.

**Architecture:** A pure Python rule module evaluates normalized stock records without network access. A separate builder obtains/caches market inputs and writes a versioned JSON snapshot consumed by a standalone iframe page; the existing scheduler, validator, tab shell, and editable local server receive narrow integrations.

**Tech Stack:** Python 3.11, standard-library `unittest`, pandas, AKShare, vanilla HTML/CSS/JavaScript, JSON snapshots.

## Global Constraints

- Include only Shanghai/Shenzhen A-share ordinary stocks; exclude ST/*ST/delisting, listing age below three years, and 20-day average turnover below CNY 50 million.
- Require current or five-year-average dividend yield of at least 3% and at least three consecutive dividend years.
- Separate stable-income and cyclical-income rules; manual pool overrides beat industry defaults.
- Stable target yield is `max(5.0%, China 10Y government yield + 2.5%)`; cyclical target yield is `max(6.0%, China 10Y government yield + 3.5%)`.
- Emit only `可关注`, `等待`, `偏贵`, `风险观察`, or `数据不足`; never emit trading or position advice.
- Missing values stay missing and must never be converted to zero.

---

### Task 1: Pure screening and state rules

**Files:**
- Create: `scripts/high_dividend_rules.py`
- Create: `tests/test_high_dividend_rules.py`

**Interfaces:**
- Produces: `classify_pool(industry, overrides, code) -> str`, `normalized_dividend(dividends, pool) -> float | None`, `target_yield(pool, bond_yield) -> float | None`, `evaluate_stock(stock, config, as_of) -> dict`.

- [ ] Write table-driven failing tests for pool overrides, stable median, cyclical 25th percentile, dual yield anchors, data-expiry, hard failures, and all five state priorities.
- [ ] Run `python -m unittest tests.test_high_dividend_rules -v` and confirm failures are caused by missing implementation.
- [ ] Implement typed, side-effect-free helpers and structured check results with `status`, `label`, `value`, `threshold`, and `reason`.
- [ ] Re-run the test module and confirm all cases pass.

### Task 2: Snapshot builder and deterministic fixture mode

**Files:**
- Create: `scripts/build_high_dividend_data.py`
- Create: `tests/fixtures/high_dividend_source.json`
- Create: `tests/test_build_high_dividend_data.py`
- Create: `web/data/high_dividend_config.json`

**Interfaces:**
- Consumes: `evaluate_stock` from Task 1.
- Produces: `build_snapshot(source, config, date) -> dict`; CLI flags `--date`, `--source-json`, `--output`, `--strict`.

- [ ] Write a failing builder test using eight fixture stocks covering stable, cyclical, ST, low-turnover, young-listing, broken-dividend, and missing-data cases.
- [ ] Verify the test fails before implementation.
- [ ] Implement fixture input, config loading, pool grouping, summary counts, reason propagation, atomic JSON output, and preservation of an existing output on failure.
- [ ] Add best-effort live adapters for AKShare spot, dividend, financial, industry, listing-date, history, and China 10Y yield inputs; cache raw payloads under `data/high_dividend_cache/` and mark unavailable fields missing.
- [ ] Run builder tests and generate `web/data/high_dividend/latest.json` from the deterministic fixture so the UI always has a valid development snapshot.

### Task 3: High-dividend radar page

**Files:**
- Create: `web/high-dividend.html`
- Create: `web/high-dividend.css`
- Create: `web/high-dividend.js`
- Create: `tests/test_high_dividend_frontend.py`

**Interfaces:**
- Consumes: `./data/high_dividend/latest.json` schema version 1.
- Produces: pool tabs, summary cards, filter/search/sort, candidate table/mobile cards, and stock detail panel.

- [ ] Write static-contract tests asserting accessible controls, required script/style references, state labels, data URL, and detail sections.
- [ ] Verify the tests fail.
- [ ] Implement the responsive radar page, default stable pool, watchlist toggle, status/industry filters, sort, explicit missing values, reason lists, quality checks, five-year dividends, yield ladder, and data timestamps.
- [ ] Re-run frontend contract tests.

### Task 4: Dashboard and editable-service integration

**Files:**
- Modify: `web/index.html`
- Modify: `web/tabs.js`
- Modify: `web/tabs.css`
- Modify: `scripts/serve_custom_boards.py`
- Create: `tests/test_high_dividend_service.py`

**Interfaces:**
- Produces: top-level `high-dividend` tab and POST `/api/high-dividend/config` actions `add`, `remove`, and `set-pool`.

- [ ] Write failing tests for config mutations, code/pool validation, idempotency, and preservation of unrelated config keys.
- [ ] Add pure config mutation helpers and the new API route using the existing build lock and atomic writes.
- [ ] Add the lazy-loaded iframe panel and responsive three-tab switcher.
- [ ] Run service and rule tests.

### Task 5: Daily update, validation, and documentation

**Files:**
- Modify: `scripts/update_daily_data.py`
- Modify: `scripts/validate_web_data.py`
- Modify: `README.md`
- Create: `tests/test_validate_high_dividend.py`

**Interfaces:**
- Produces: optional close-time high-dividend refresh, strict validation of schema version 1, unique codes, enums, numerical ranges, and non-empty reasons.

- [ ] Write failing validation tests for a valid snapshot and malformed codes, duplicate codes, invalid states, invalid pool values, and empty reasons.
- [ ] Implement `validate_high_dividend`, add it to validator output, and integrate the builder as an optional full-update step excluded from radar-only refresh.
- [ ] Document the new page, data files, manual fixture build, live build, update behavior, state semantics, and data limitations.
- [ ] Run all unit tests and `python scripts/validate_web_data.py`.

### Task 6: Visual verification and final regression

**Files:**
- Modify only files found defective during verification.

**Interfaces:**
- Consumes the complete feature and local server.

- [ ] Start the local editable service and inspect desktop and mobile layouts in a real browser.
- [ ] Verify pool switching, filters, search, sorting, details, missing-data labels, and observation-list interactions.
- [ ] Run `python -m unittest discover -s tests -v`, `python scripts/validate_web_data.py`, and `git diff --check`.
- [ ] Review the final diff for accidental generated or unrelated files, then commit the implementation.
