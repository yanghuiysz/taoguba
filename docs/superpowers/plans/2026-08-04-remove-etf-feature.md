# Remove ETF Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the ETF fund-flow radar, its data pipeline, generated data, and tests while preserving historical design documents and unrelated dashboard behavior.

**Architecture:** Remove the ETF vertical at each integration boundary: dashboard navigation, daily build orchestration, validation, and feature-owned files. Keep the intraday and custom-board paths unchanged, then verify both targeted absence and the remaining test suite.

**Tech Stack:** Static HTML/CSS/JavaScript, Python 3, unittest/pytest-compatible tests, Node.js page tests.

## Global Constraints

- Preserve `docs/superpowers/specs/2026-07-31-etf-fund-flow-radar-design.md` and all Git history.
- Do not alter unrelated working-tree changes under `web/data`, `output`, or `tmp`.
- The dashboard must retain “盘中雷达” and “自定义板块”, with the current default tab and refresh behavior unchanged.
- No ETF page, generated artifact, daily update step, validation rule, or feature-specific test may remain active.

---

### Task 1: Remove ETF Dashboard Navigation

**Files:**
- Modify: `web/index.html`
- Modify: `web/tabs.js`
- Delete: `scripts/test_etf_fund_flow_page.js`

**Interfaces:**
- Consumes: Existing `.tab`, `.panel`, and `frameSrc` conventions.
- Produces: A two-tab dashboard whose lazy-loading and refresh behavior still targets `intraday` and `custom` only.

- [ ] **Step 1: Record the pre-change dashboard checks**

Run: `rg -n 'data-target="etf"|panel-etf|etf\.html' web/index.html web/tabs.js`

Expected: Matches in both dashboard files.

- [ ] **Step 2: Remove the ETF navigation wiring**

Delete the ETF `<button>` and `<section>` from `web/index.html`, and delete the `etf` entry from `frameSrc` in `web/tabs.js`. Do not change the active `intraday` button or refresh constants.

- [ ] **Step 3: Remove the obsolete ETF-only page test**

Delete `scripts/test_etf_fund_flow_page.js`; its assertions require a feature that no longer exists.

- [ ] **Step 4: Verify dashboard wiring**

Run: `rg -n 'data-target="etf"|panel-etf|etf\.html' web/index.html web/tabs.js`

Expected: No matches. Then run `node --check web/tabs.js`; expected exit code 0.

### Task 2: Remove ETF Daily Build and Publication Policy

**Files:**
- Modify: `scripts/update_daily_data.py`
- Delete: `scripts/test_etf_fund_flow_integration.py`

**Interfaces:**
- Consumes: Existing full-update and `--intraday-radar-only` modes.
- Produces: Daily updates that build and validate only the remaining datasets.

- [ ] **Step 1: Record the pre-change orchestration references**

Run: `rg -n 'ETF_FUND_FLOW|build_etf_fund_flow|etf_latest_satisfies_publication_policy' scripts/update_daily_data.py`

Expected: Constant, helper, builder call, warning, and publication-policy matches.

- [ ] **Step 2: Remove ETF orchestration**

Delete `ETF_FUND_FLOW`, `etf_latest_satisfies_publication_policy`, the optional `build_etf_fund_flow.py` call, ETF warnings, and the final ETF publication-policy failure branch. Preserve all non-ETF command order and radar-only behavior.

- [ ] **Step 3: Remove obsolete integration tests**

Delete `scripts/test_etf_fund_flow_integration.py`, whose validator and builder expectations are entirely ETF-owned.

- [ ] **Step 4: Verify the remaining orchestrator parses**

Run: `python -m py_compile scripts/update_daily_data.py`

Expected: Exit code 0.

### Task 3: Remove ETF Validation

**Files:**
- Modify: `scripts/validate_web_data.py`

**Interfaces:**
- Consumes: Existing validator CLI and remaining dataset validators.
- Produces: Validation that neither reads nor reports ETF files.

- [ ] **Step 1: Record ETF validator references**

Run: `rg -n 'ETF_|validate_etf|ETF fund-flow' scripts/validate_web_data.py`

Expected: ETF paths, schemas, validator function, CLI invocation, and success output.

- [ ] **Step 2: Remove ETF validation code**

Delete ETF path constants, schema key sets, numeric field sets, `validate_etf_fund_flow`, its main-program invocation, and its success message. Preserve shared helpers used by other validators.

- [ ] **Step 3: Verify validator syntax and non-ETF tests**

Run: `python -m py_compile scripts/validate_web_data.py`

Expected: Exit code 0.

### Task 4: Delete ETF-Owned Implementation and Data

**Files:**
- Delete: `web/etf.html`
- Delete: `web/etf.css`
- Delete: `web/etf.js`
- Delete: `web/data/etf_fund_flow.json`
- Delete: `web/data/etf_fund_flow_config.json`
- Delete: `web/data/etf_fund_flow/history/20260731.json`
- Delete: `scripts/build_etf_fund_flow.py`
- Delete: `scripts/test_build_etf_fund_flow.py`
- Delete: `scripts/test_etf_fund_flow_config.py`

**Interfaces:**
- Consumes: No shared interfaces; all listed files belong exclusively to the ETF vertical.
- Produces: No deployable ETF page, source, generated data, builder, or feature-owned tests.

- [ ] **Step 1: Delete the feature-owned files**

Use a scoped patch that names every tracked file above. Remove the now-empty `web/data/etf_fund_flow/history` directory naturally when its final file is deleted.

- [ ] **Step 2: Check tracked ETF residue**

Run: `git ls-files | rg -i '(^|[/_.-])etf([/_\.-]|$)'`

Expected: Only historical documentation such as the preserved ETF design spec may match.

### Task 5: Regression Verification

**Files:**
- Verify: `web/index.html`
- Verify: `web/tabs.js`
- Verify: `scripts/update_daily_data.py`
- Verify: `scripts/validate_web_data.py`

**Interfaces:**
- Consumes: The repository's existing Python and JavaScript test entry points.
- Produces: Evidence that the ETF feature is absent and remaining dashboard behavior is intact.

- [ ] **Step 1: Search active code and data for ETF feature references**

Run: `rg -n -i '\betf\b|build_etf_fund_flow|etf_fund_flow' web scripts -g '!custom.js'`

Expected: No matches.

- [ ] **Step 2: Run Python tests**

Run: `python -m pytest scripts -q`

Expected: All discovered remaining tests pass.

- [ ] **Step 3: Run JavaScript tests and syntax checks**

Run each remaining `scripts/test_*.js` with Node.js, followed by `node --check web/tabs.js`.

Expected: Every command exits 0.

- [ ] **Step 4: Review the scoped diff**

Run: `git diff --check` and `git status --short`.

Expected: No whitespace errors; only ETF removal files plus the user's pre-existing unrelated data/output/tmp changes are present.

- [ ] **Step 5: Commit only the ETF removal**

Stage the dashboard, pipeline, validator, and deleted ETF-owned files explicitly, excluding unrelated working-tree changes. Commit with `remove ETF fund-flow feature`.
