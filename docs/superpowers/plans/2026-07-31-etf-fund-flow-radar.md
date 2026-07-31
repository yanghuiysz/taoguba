# ETF Fund Flow Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a post-close dashboard that tracks confirmed primary-market net subscriptions for 5 broad-market and 25 industry A-share ETFs.

**Architecture:** A Python builder reads a fixed ETF registry, collects official SSE/SZSE share counts plus same-date NAV and market quotes, and writes immutable daily snapshots plus a latest aggregate. A standalone static ETF page consumes only the aggregate JSON, while the existing dashboard tab shell and post-close runner provide navigation and scheduling.

**Tech Stack:** Python 3.11, requests, pandas/openpyxl through existing AkShare dependencies, unittest, vanilla HTML/CSS/JavaScript, JSON

## Global Constraints

- Track exactly 5 broad ETFs and 25 industry ETFs with unique six-digit codes.
- Confirm net subscription only when the current and previous share counts and current same-date NAV are available.
- Calculate `netSubscription = (shares - previousShares) * nav`; never substitute turnover, main-fund-flow fields, or close price.
- Missing inputs remain JSON `null` and render as `待确认`; never coerce them to zero.
- Keep broad-market and industry totals separate.
- Do not mix ETF rows into existing custom-board stock averages or stock-level fund-flow calculations.
- Work directly on `main` as previously authorized; keep `output/` and `tmp/` untracked.

---

### Task 1: Define and Validate the ETF Registry

**Files:**
- Create: `web/data/etf_fund_flow_config.json`
- Create: `scripts/test_etf_fund_flow_config.py`

**Interfaces:**
- Produces: registry object `{version: 1, benchmarkCode: string, boardMappings: object, etfs: EtfConfig[]}`
- `EtfConfig`: `{code, name, scope, category, direction, exchange}` where `scope` is `broad` or `industry` and `exchange` is `SSE` or `SZSE`

- [ ] **Step 1: Write the failing registry test**

```python
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "web/data/etf_fund_flow_config.json"

class EtfFundFlowConfigTest(unittest.TestCase):
    def test_registry_has_exact_approved_universe(self):
        payload = json.loads(CONFIG.read_text(encoding="utf-8"))
        rows = payload["etfs"]
        self.assertEqual(payload["benchmarkCode"], "510300")
        self.assertEqual(len(rows), 30)
        self.assertEqual(len({row["code"] for row in rows}), 30)
        self.assertEqual(sum(row["scope"] == "broad" for row in rows), 5)
        self.assertEqual(sum(row["scope"] == "industry" for row in rows), 25)
        self.assertTrue(all(len(row["code"]) == 6 and row["code"].isdigit() for row in rows))
        self.assertTrue(all(row["exchange"] in {"SSE", "SZSE"} for row in rows))
        self.assertEqual(payload["boardMappings"]["512800"], ["yinhang"])
        self.assertEqual(payload["boardMappings"]["515170"], ["shipinyinliao"])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `python -m unittest scripts.test_etf_fund_flow_config -v`

Expected: ERROR because `web/data/etf_fund_flow_config.json` does not exist.

- [ ] **Step 3: Create the approved 30-ETF registry**

Create JSON with these exact rows and fields:

```json
{
  "version": 1,
  "benchmarkCode": "510300",
  "boardMappings": {
    "515070": ["aiyingyong"],
    "515230": ["aiyingyong"],
    "515880": ["guangxian", "cpo"],
    "512480": ["xinpianbandaoti", "cunchuxinpian"],
    "512800": ["yinhang"],
    "515170": ["shipinyinliao"],
    "512010": ["yiyao"],
    "159992": ["yiyao"],
    "512170": ["yiyao"],
    "516160": ["lidian", "chuneng"],
    "515030": ["lidian"],
    "515790": ["guangfu"],
    "512400": ["jinshulv", "xiaojinshu", "xitu"],
    "159825": []
  },
  "etfs": [
    {"code":"510300","name":"沪深300ETF","scope":"broad","category":"大盘核心","direction":"沪深300","exchange":"SSE"},
    {"code":"510500","name":"中证500ETF","scope":"broad","category":"中盘","direction":"中证500","exchange":"SSE"},
    {"code":"512100","name":"中证1000ETF","scope":"broad","category":"小盘","direction":"中证1000","exchange":"SSE"},
    {"code":"159915","name":"创业板ETF","scope":"broad","category":"创业成长","direction":"创业板","exchange":"SZSE"},
    {"code":"588000","name":"科创50ETF","scope":"broad","category":"科创成长","direction":"科创50","exchange":"SSE"},
    {"code":"515070","name":"人工智能ETF","scope":"industry","category":"科技","direction":"AI全产业链","exchange":"SSE"},
    {"code":"588760","name":"科创人工智能ETF","scope":"industry","category":"科技","direction":"科创AI硬件与核心技术","exchange":"SSE"},
    {"code":"515230","name":"软件ETF","scope":"industry","category":"科技","direction":"软件、信创与AI应用","exchange":"SSE"},
    {"code":"515880","name":"通信ETF","scope":"industry","category":"科技","direction":"通信设备与光通信","exchange":"SSE"},
    {"code":"512480","name":"半导体ETF","scope":"industry","category":"科技","direction":"半导体产业链","exchange":"SSE"},
    {"code":"159869","name":"游戏ETF","scope":"industry","category":"科技","direction":"游戏与AI内容应用","exchange":"SZSE"},
    {"code":"512980","name":"传媒ETF","scope":"industry","category":"科技","direction":"传媒、营销与数字内容","exchange":"SSE"},
    {"code":"159851","name":"金融科技ETF","scope":"industry","category":"科技","direction":"金融软件与金融IT","exchange":"SZSE"},
    {"code":"512660","name":"军工ETF","scope":"industry","category":"制造","direction":"国防军工","exchange":"SSE"},
    {"code":"512800","name":"银行ETF","scope":"industry","category":"金融","direction":"银行","exchange":"SSE"},
    {"code":"512000","name":"券商ETF","scope":"industry","category":"金融","direction":"证券公司","exchange":"SSE"},
    {"code":"159928","name":"消费ETF","scope":"industry","category":"消费","direction":"主要消费","exchange":"SZSE"},
    {"code":"515170","name":"食品饮料ETF","scope":"industry","category":"消费","direction":"食品饮料","exchange":"SSE"},
    {"code":"159996","name":"家电ETF","scope":"industry","category":"消费","direction":"家用电器","exchange":"SZSE"},
    {"code":"512010","name":"医药ETF","scope":"industry","category":"医药","direction":"医药行业","exchange":"SSE"},
    {"code":"159992","name":"创新药ETF","scope":"industry","category":"医药","direction":"创新药产业","exchange":"SZSE"},
    {"code":"512170","name":"医疗ETF","scope":"industry","category":"医药","direction":"医疗器械与医疗服务","exchange":"SSE"},
    {"code":"516160","name":"新能源ETF","scope":"industry","category":"新能源","direction":"新能源产业","exchange":"SSE"},
    {"code":"515030","name":"新能源车ETF","scope":"industry","category":"新能源","direction":"新能源汽车产业链","exchange":"SSE"},
    {"code":"515790","name":"光伏ETF","scope":"industry","category":"新能源","direction":"光伏产业链","exchange":"SSE"},
    {"code":"512400","name":"有色金属ETF","scope":"industry","category":"周期","direction":"有色金属","exchange":"SSE"},
    {"code":"515220","name":"煤炭ETF","scope":"industry","category":"周期","direction":"煤炭","exchange":"SSE"},
    {"code":"159870","name":"化工ETF","scope":"industry","category":"周期","direction":"化工","exchange":"SZSE"},
    {"code":"159825","name":"农业ETF","scope":"industry","category":"农业","direction":"农林牧渔","exchange":"SZSE"},
    {"code":"512200","name":"房地产ETF","scope":"industry","category":"地产","direction":"房地产","exchange":"SSE"}
  ]
}
```

- [ ] **Step 4: Run the registry test**

Run: `python -m unittest scripts.test_etf_fund_flow_config -v`

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```powershell
git add web/data/etf_fund_flow_config.json scripts/test_etf_fund_flow_config.py
git commit -m "feat: define ETF fund flow universe"
```

### Task 2: Build Confirmed ETF Daily Snapshots

**Files:**
- Create: `scripts/build_etf_fund_flow.py`
- Create: `scripts/test_build_etf_fund_flow.py`
- Create at runtime: `web/data/etf_fund_flow/history/YYYYMMDD.json`
- Create at runtime: `web/data/etf_fund_flow.json`

**Interfaces:**
- Produces `compute_net_subscription(current_shares: float|None, previous_shares: float|None, nav: float|None) -> float|None`
- Produces `classify_flow(change_pct: float|None, net_subscription: float|None) -> str`
- Produces `build_row(config: dict, current: dict, previous: dict|None, history: list[dict], benchmark_returns: dict[str,float]) -> dict`
- CLI: `python scripts/build_etf_fund_flow.py --date YYYYMMDD [--config PATH] [--out PATH] [--history-dir PATH]`

- [ ] **Step 1: Write failing unit tests for confirmed-only math**

```python
class ConfirmedFlowMathTest(unittest.TestCase):
    def test_confirmed_subscription_uses_share_delta_times_nav(self):
        self.assertEqual(compute_net_subscription(1_200_000, 1_000_000, 1.25), 250_000)

    def test_any_missing_input_returns_none(self):
        self.assertIsNone(compute_net_subscription(None, 1_000_000, 1.25))
        self.assertIsNone(compute_net_subscription(1_200_000, None, 1.25))
        self.assertIsNone(compute_net_subscription(1_200_000, 1_000_000, None))

    def test_four_flow_labels_and_pending(self):
        self.assertEqual(classify_flow(1.2, 10), "资金强化")
        self.assertEqual(classify_flow(-1.2, 10), "逆势承接")
        self.assertEqual(classify_flow(1.2, -10), "上涨兑现")
        self.assertEqual(classify_flow(-1.2, -10), "资金撤退")
        self.assertEqual(classify_flow(1.2, None), "待确认")
```

- [ ] **Step 2: Run tests and verify import failure**

Run: `python -m unittest scripts.test_build_etf_fund_flow -v`

Expected: ERROR because `scripts.build_etf_fund_flow` does not exist.

- [ ] **Step 3: Implement source adapters and normalization**

Implement these exact providers in `scripts/build_etf_fund_flow.py`:

```python
def fetch_sse_shares(date: str) -> dict[str, dict]:
    """Use akshare.fund_etf_scale_sse(date); return code -> {shares, sharesDate}."""

def fetch_szse_latest_shares() -> dict[str, dict]:
    """Use akshare.fund_etf_scale_szse(); return code -> {shares, sharesDate}."""

def fetch_nav(code: str, start_date: str, end_date: str) -> dict[str, dict]:
    """Use akshare.fund_etf_fund_info_em; return date -> {nav, navDate}."""

def fetch_market_history(code: str, start_date: str, end_date: str) -> dict[str, dict]:
    """Use akshare.fund_etf_hist_em; return date -> {close, changePercent, turnover}."""
```

Use exchange share data as the authority. Apply request timeouts/retries at adapter boundaries and keep per-code failures in `errors`; do not abort all 30 rows because one ETF fails.

- [ ] **Step 4: Implement confirmed calculations and history windows**

Each row must expose these stable keys:

```python
{
  "code": str, "name": str, "scope": str, "category": str, "direction": str,
  "exchange": str, "date": str, "status": "confirmed" | "pending",
  "shares": float | None, "previousShares": float | None, "shareChange": float | None,
  "nav": float | None, "scale": float | None, "close": float | None,
  "changePercent": float | None, "turnover": float | None, "turnoverVs5d": float | None,
  "netSubscription1d": float | None, "netSubscription5d": float | None,
  "netSubscription20d": float | None, "excessReturn5d": float | None,
  "positiveFlowDays5d": int | None, "flowLabel": str,
  "persistenceLabel": "持续流入" | "持续流出" | None,
  "stockBreadth": float | None, "breadthConfirmed": bool,
  "mainlineCandidate": bool
}
```

Set `status="confirmed"` only when both share dates, current NAV date, and requested trading date align. For a first-run SZSE baseline, write shares but leave `previousShares`, share change, and net subscription `null`. Calculate 5-day/20-day sums only when every required daily confirmed value exists; use at most the available window during the first 19 archived sessions and expose `windowDays5d`/`windowDays20d` so the UI can distinguish partial history.

Load `web/data/custom_boards.json` and calculate each mapped board's breadth as `上涨且有行情的股票数 / 有行情股票数`. Set `breadthConfirmed=true` only when the custom-board date equals the ETF snapshot date and at least one mapped board is present. Set `mainlineCandidate=true` only when 1-day and 5-day net subscription are positive, 5-day excess return is positive, at least 3 of 5 sessions have positive flow, turnover is at least its 5-day mean, and mapped stock breadth is at least 50%. ETFs without a mapping or same-date breadth stay `mainlineCandidate=false`; the UI may label their ETF evidence as strong but must not call them confirmed mainline candidates.

- [ ] **Step 5: Test aggregation, null preservation, and atomic output**

Add fixture-driven tests that call `build_snapshot(..., providers=fakes)` with two ETFs and assert:

```python
self.assertIsNone(snapshot["etfs"][1]["netSubscription1d"])
self.assertEqual(snapshot["etfs"][1]["flowLabel"], "待确认")
self.assertEqual(snapshot["summary"]["broad"]["confirmedCount"], 1)
self.assertEqual(snapshot["summary"]["industry"]["confirmedCount"], 0)
self.assertFalse(math.isnan(snapshot["etfs"][0]["netSubscription1d"]))
```

Write to a sibling temporary file and replace the destination only after `json.dumps(..., allow_nan=False)` succeeds. A failed live refresh must preserve the previous latest file.

- [ ] **Step 6: Run builder tests**

Run: `python -m unittest scripts.test_build_etf_fund_flow -v`

Expected: all tests PASS without network access.

- [ ] **Step 7: Commit the builder**

```powershell
git add scripts/build_etf_fund_flow.py scripts/test_build_etf_fund_flow.py
git commit -m "feat: build confirmed ETF fund flow snapshots"
```

### Task 3: Add the ETF Radar Page and Dashboard Tab

**Files:**
- Create: `web/etf.html`
- Create: `web/etf.css`
- Create: `web/etf.js`
- Create: `scripts/test_etf_fund_flow_page.js`
- Modify: `web/index.html`
- Modify: `web/tabs.js`

**Interfaces:**
- Consumes: `./data/etf_fund_flow.json`
- Produces: sortable tables and cards using `renderEtfRadar(payload)`, `sortEtfs(rows, key, direction)`, and `formatMoney(value)`

- [ ] **Step 1: Write the failing page wiring test**

```javascript
const fs = require("fs");
const assert = require("assert");
const html = fs.readFileSync("web/index.html", "utf8");
const page = fs.readFileSync("web/etf.html", "utf8");
const js = fs.readFileSync("web/etf.js", "utf8");
assert(html.includes('data-target="etf"'));
assert(html.includes('id="panel-etf"'));
assert(page.includes('id="broad-preference"'));
assert(page.includes('id="industry-ranking"'));
assert(js.includes("./data/etf_fund_flow.json"));
assert(js.includes("待确认"));
assert(js.includes("renderEtfRadar"));
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node scripts/test_etf_fund_flow_page.js`

Expected: ENOENT for `web/etf.html`.

- [ ] **Step 3: Build the standalone responsive page**

The page must contain:

- date/status header and confirmed-count warning;
- separate broad-market preference cards;
- industry top-10 inflow and top-10 outflow cards;
- 5-day persistent-flow list;
- sortable 1-day/5-day/20-day industry table;
- columns for scale, share change, confirmed subscription, return, excess return, turnover ratio, and labels;
- a visible explanation: `ETF成交额不等于资金净流入，本页按份额变化×单位净值计算`;
- pending values rendered as `—` plus `待确认`, never `0`.

Use `textContent` for remote data fields, `Intl.NumberFormat("zh-CN")` for values, red for positive A-share returns/flows and green for negative values, and `postMessage({type:"dashboard:resize"}, location.origin)` after each render.

- [ ] **Step 4: Wire the third dashboard tab**

Add to `web/index.html`:

```html
<button class="tab" data-target="etf">ETF资金雷达</button>
...
<section class="panel" id="panel-etf">
  <iframe title="ETF资金雷达" data-src="./etf.html?v=20260731-etf-v1"></iframe>
</section>
```

Add to `frameSrc` in `web/tabs.js`:

```javascript
etf: "./etf.html?v=20260731-etf-v1",
```

- [ ] **Step 5: Run page tests**

Run: `node scripts/test_etf_fund_flow_page.js`

Expected: PASS.

- [ ] **Step 6: Commit the page**

```powershell
git add web/etf.html web/etf.css web/etf.js web/index.html web/tabs.js scripts/test_etf_fund_flow_page.js
git commit -m "feat: add ETF fund flow radar page"
```

### Task 4: Integrate Validation and Post-Close Refresh

**Files:**
- Modify: `scripts/validate_web_data.py`
- Modify: `scripts/update_daily_data.py`
- Create: `scripts/test_etf_fund_flow_integration.py`

**Interfaces:**
- `validate_etf_fund_flow(config_path: Path, latest_path: Path) -> list[str]`
- Daily update invokes `scripts/build_etf_fund_flow.py --date <date>` only outside trading-time radar-only mode.
- Post-close refresh treats ETF failure as non-destructive: keep last good latest file, print warning, continue existing validation.

- [ ] **Step 1: Write failing integration tests**

Test source wiring and a temporary valid/invalid payload:

```python
self.assertIn('scripts/build_etf_fund_flow.py', UPDATE_SOURCE)
self.assertIn('etf_fund_flow.json', VALIDATOR_SOURCE)
self.assertEqual(validate_etf_fund_flow(valid_config, valid_latest), [])
self.assertIn("duplicate ETF code", "\n".join(validate_etf_fund_flow(duplicate_config, valid_latest)))
self.assertIn("confirmed row missing NAV", "\n".join(validate_etf_fund_flow(valid_config, invalid_latest)))
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `python -m unittest scripts.test_etf_fund_flow_integration -v`

Expected: FAIL because the validator and pipeline do not reference ETF data.

- [ ] **Step 3: Extend validation**

Validate exactly 30 configured rows, 5/25 scope split, code uniqueness, output/config code equality, ISO date fields, finite numeric values, `confirmed` input completeness, and `pending` null preservation. Validation must accept a missing latest file before the first successful live build but print a clear warning; once present, malformed data is an error.

- [ ] **Step 4: Add the optional daily builder step**

In `scripts/update_daily_data.py`, define `ETF_FUND_FLOW = Path("web/data/etf_fund_flow.json")` and invoke:

```python
if not radar_only:
    run_optional(["scripts/build_etf_fund_flow.py", "--date", args.date], ETF_FUND_FLOW)
```

Place it before the final `validate_web_data.py` call. The post-close wrapper continues to call `update_daily_data.py`; add a regression assertion that no ETF build runs in intraday radar-only mode.

- [ ] **Step 5: Run integration and existing scheduler tests**

```powershell
python -m unittest scripts.test_etf_fund_flow_integration -v
python -m unittest scripts.test_intraday_radar_daemon_after_close -v
python scripts/validate_web_data.py
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit pipeline integration**

```powershell
git add scripts/validate_web_data.py scripts/update_daily_data.py scripts/refresh_latest_after_close.py scripts/test_etf_fund_flow_integration.py
git commit -m "feat: refresh ETF flows after close"
```

### Task 5: Build Live Data, Verify the Dashboard, and Publish

**Files:**
- Create/Modify: `web/data/etf_fund_flow.json`
- Create: `web/data/etf_fund_flow/history/20260731.json`

**Interfaces:**
- Consumes: live exchange share data, NAV history, and ETF market history.
- Produces: the first archived baseline; SSE rows may confirm against an exchange historical share record, while SZSE rows without an archived prior baseline remain `pending` for net subscription.

- [ ] **Step 1: Run the live post-close build**

Run: `python scripts/build_etf_fund_flow.py --date 20260731`

Expected: 30 rows written, no NaN/Infinity, per-source errors listed without fabricated values.

- [ ] **Step 2: Run the full automated suite**

```powershell
python -m unittest discover -s scripts -p "test_*.py"
Get-ChildItem scripts -Filter "test_*.js" | ForEach-Object { node $_.FullName }
python scripts/validate_web_data.py
```

Expected: all commands exit 0.

- [ ] **Step 3: Visually verify the local dashboard**

Open `http://127.0.0.1:8765/web/`, select `ETF资金雷达`, and verify at desktop and narrow width that all cards/tables fit, sorting works, the date/status warning is visible, red/green signs are correct, and pending SZSE values are not shown as zero.

- [ ] **Step 4: Review generated data scope**

Run: `git status --short` and confirm only planned source files plus `web/data/etf_fund_flow*` are staged; `output/` and `tmp/` remain untracked.

- [ ] **Step 5: Commit and push**

```powershell
git add web/data/etf_fund_flow.json web/data/etf_fund_flow/history/20260731.json
git commit -m "data: add initial ETF fund flow baseline"
git push origin main
```

Expected: `main -> main` and a clean tracked worktree.
