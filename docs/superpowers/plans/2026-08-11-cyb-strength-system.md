# 创业板轻量强弱系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有创业板下探统计升级为同时输出可解释“市场状态”和“下探风险”的轻量强弱系统。

**Architecture:** 继续由 `scripts/build_cyb_trend_stats.py` 读取创业板指 1 分钟行情，但把波段识别、修复计算、15 分钟结构和状态判定拆成独立纯函数。日历史保留原字段并增加版本 2 字段，前端以兼容缺失值的方式逐步展示摘要、收复率曲线和扩展表格。

**Tech Stack:** Python 3 标准库、JSON、原生 JavaScript、SVG、CSS、Playwright。

## Global Constraints

- 数据源仍仅为创业板指 `sz399006` 的 1 分钟行情，不新增个股、成交额或其他指数依赖。
- 汇总文件使用 `schemaVersion: 2`；无版本的历史日文件按版本 1 兼容。
- 原有 `count`、`maxDepth`、`totalDepth`、`avgDepth`、`effectiveCount`、`effectiveTotal`、`dips` 字段不得删除。
- 回撤确认阈值为跌幅修复 50%；强承接阈值为修复 80%；有效下探兼容阈值仍为 1.00%。
- 候选回撤至少满足“深度 0.30%”或“持续 15 个交易分钟且深度 0.20%”。
- 午间休市不计入持续时间和修复时间；不同交易日不得合并波段。
- 新字段缺失必须展示 `—`，不得按零值绘图或参与判定。
- 单日有效分钟记录少于 200 条时设置 `dataQuality: incomplete`，不生成状态和风险结论。
- 所有阈值集中为模块常量，禁止散落在计算和渲染代码中。

---

## File Structure

- Modify: `scripts/build_cyb_trend_stats.py` — 行情清洗、回撤识别、修复计算、趋势结构、状态判定、版本 2 输出。
- Create: `scripts/test_cyb_strength_system.py` — 纯函数和日聚合边界测试。
- Modify: `web/custom.js` — 摘要卡、收复率曲线、扩展日表和波段明细，兼容版本 1 数据。
- Modify: `web/custom.css` — 摘要卡和新增列的响应式样式。
- Modify: `scripts/test_trend_stats_table_layout.py` — 新字段、缺失值和多视口布局验证。
- Modify: `scripts/validate_web_data.py` — 版本 2 字段类型和范围校验。
- Modify: `web/data/cyb_trend_stats.json` — 使用固定/真实分钟数据重新生成的版本 2 汇总样例。
- Modify/Create: `web/data/cyb_trend_stats_history/*.json` — 只更新实现验证实际重算到的交易日，不批量伪造旧数据。

---

### Task 1: 行情清洗、交易分钟和 15 分钟 K 线基础函数

**Files:**
- Modify: `scripts/build_cyb_trend_stats.py`
- Create: `scripts/test_cyb_strength_system.py`

**Interfaces:**
- Produces: `prepare_minute_bars(records: list[dict]) -> list[dict]`
- Produces: `trading_minutes_between(start: datetime, end: datetime) -> int`
- Produces: `resample_15min(bars: list[dict]) -> list[dict]`
- Produces constants: `MIN_COMPLETE_RECORDS = 200`, `DIP_MIN_DEPTH = 0.30`, `LONG_DIP_MIN_DEPTH = 0.20`, `LONG_DIP_MINUTES = 15`, `RECOVERY_CONFIRM = 0.50`, `STRONG_RECOVERY = 0.80`, `EFFECTIVE_DIP_DEPTH = 1.00`

- [ ] **Step 1: Write failing foundation tests**

Add import-by-path setup and tests that prove sorting, duplicate removal, invalid/non-trading record filtering, lunch exclusion, and OHLC resampling:

```python
def test_prepare_bars_sorts_deduplicates_and_filters():
    records = [
        row("20260811", "093100", 101),
        row("20260811", "093000", 100),
        row("20260811", "093100", 102),
        row("20260811", "120000", 999),
        row("20260811", "093200", -1),
    ]
    bars = trend.prepare_minute_bars(records)
    assert [(b["time"], b["price"]) for b in bars] == [("093000", 100), ("093100", 102)]

def test_trading_minutes_excludes_lunch_break():
    assert trend.trading_minutes_between(dt("20260811", "112000"), dt("20260811", "131000")) == 20

def test_resample_15min_builds_ohlc():
    bars = trend.prepare_minute_bars([
        row("20260811", "093000", 100), row("20260811", "093500", 103),
        row("20260811", "094000", 99), row("20260811", "094400", 101),
    ])
    assert trend.resample_15min(bars)[0] | {"bars": None} == {
        "label": "2026-08-11 09:30", "O": 100, "H": 103, "L": 99, "C": 101, "bars": None,
    }
```

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m unittest scripts.test_cyb_strength_system -v`

Expected: FAIL because the new functions/constants do not exist.

- [ ] **Step 3: Implement the pure foundation functions**

Move datetime conversion and 15-minute resampling out of `analyze_day`. Deduplicate by `(date, HHMM)` with the last valid record winning; retain only `09:30–11:29` and `13:00–14:59`; reject non-finite or non-positive prices. Implement trading minutes by iterating minute boundaries only inside those sessions.

- [ ] **Step 4: Run tests and existing script smoke check**

Run: `python -m unittest scripts.test_cyb_strength_system -v`

Expected: PASS.

Run: `python scripts/build_cyb_trend_stats.py --regen --out output/cyb-trend-foundation.json`

Expected: exits 0 without modifying production summary.

- [ ] **Step 5: Commit foundation**

```powershell
git add scripts/build_cyb_trend_stats.py scripts/test_cyb_strength_system.py
git commit -m "refactor: extract CYB minute bar helpers"
```

---

### Task 2: 峰谷回撤和修复能力识别

**Files:**
- Modify: `scripts/build_cyb_trend_stats.py`
- Modify: `scripts/test_cyb_strength_system.py`

**Interfaces:**
- Consumes: `prepare_minute_bars`, `trading_minutes_between` and threshold constants from Task 1.
- Produces: `detect_dips(bars: list[dict]) -> list[dict]`
- Dip fields: `wave`, `type`, `start`, `end`, `peak`, `trough`, `depth`, `duration`, `recoveryRate`, `recovery50Minutes`, `fullyRecovered`.

- [ ] **Step 1: Write failing wave tests**

Use a helper that expands `(minute_offset, price)` points into bars and cover the required structures:

```python
def test_small_bounce_does_not_split_dip():
    dips = trend.detect_dips(bars_from_prices([100, 99.4, 99.7, 99.0, 99.6]))
    assert len(dips) == 1
    assert dips[0]["peak"] == 100
    assert dips[0]["trough"] == 99.0

def test_half_recovery_confirms_dip_and_records_speed():
    dips = trend.detect_dips(bars_from_prices([100, 99, 99.2, 99.5, 100]))
    assert dips[0]["recoveryRate"] == 100.0
    assert dips[0]["recovery50Minutes"] == 2
    assert dips[0]["fullyRecovered"] is True

def test_close_forces_unrecovered_dip():
    dips = trend.detect_dips(bars_from_prices([100, 99.6, 99.0, 99.1]))
    assert dips[0]["recoveryRate"] == 10.0
    assert dips[0]["recovery50Minutes"] is None
    assert dips[0]["fullyRecovered"] is False
```

Also add cases for the 0.30% depth filter, the 0.20%/15-minute alternative, recovery capped at 100%, and lunch-free duration.

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `python -m unittest scripts.test_cyb_strength_system.CybDipTests -v`

Expected: FAIL because `detect_dips` does not exist.

- [ ] **Step 3: Implement the dip state machine**

Track a running peak, trough, and phase (`seeking_peak`, `falling`, `recovering`). Keep a bounce inside the same dip until it reaches 50% recovery. When confirmed, finalize the dip and start the next peak search from the confirmation bar. At close, finalize any qualifying open dip. Compute repair metrics in a second pass so each dip observes bars from its trough to the next confirmed dip peak or close.

- [ ] **Step 4: Run tests**

Run: `python -m unittest scripts.test_cyb_strength_system.CybDipTests -v`

Expected: PASS.

- [ ] **Step 5: Commit wave detection**

```powershell
git add scripts/build_cyb_trend_stats.py scripts/test_cyb_strength_system.py
git commit -m "feat: detect CYB pullbacks and recoveries"
```

---

### Task 3: 趋势结构、市场状态和风险判定

**Files:**
- Modify: `scripts/build_cyb_trend_stats.py`
- Modify: `scripts/test_cyb_strength_system.py`

**Interfaces:**
- Consumes: 15-minute K bars from `resample_15min` and day metrics from Task 2.
- Produces: `classify_trend_structure(k15: list[dict]) -> str`
- Produces: `classify_market_state(metrics: dict) -> str | None`
- Produces: `classify_risk(metrics: dict) -> str | None`
- Produces: `compare_risk(previous: str | None, current: str | None) -> str | None`
- Produces: `build_reasons(metrics: dict) -> list[str]` with at most three entries.

- [ ] **Step 1: Write failing classification tests**

Add deterministic K-line fixtures for `上升结构`, `下降结构`, `上攻乏力`, `支撑转弱`, and `震荡结构`. Add table-driven boundary tests:

```python
def test_risk_boundaries():
    base = {"effectiveCount": 0, "maxDepth": 1.49, "avgRecoveryRate": 50, "closePosition": 35}
    assert trend.classify_risk(base) == "低"
    assert trend.classify_risk(base | {"maxDepth": 1.5}) == "升温"
    assert trend.classify_risk(base | {"effectiveCount": 2, "maxDepth": 1.5, "closePosition": 34.9}) == "高"

def test_missing_recovery_does_not_count_as_failure():
    metrics = {"effectiveCount": 0, "maxDepth": 0, "avgRecoveryRate": None, "closePosition": 80}
    assert trend.classify_risk(metrics) == "低"

def test_incomplete_day_has_no_classification():
    metrics = {"dataQuality": "incomplete"}
    assert trend.classify_market_state(metrics) is None
    assert trend.classify_risk(metrics) is None
```

Cover all six market states and rising/falling/equal risk comparisons.

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `python -m unittest scripts.test_cyb_strength_system.CybClassificationTests -v`

Expected: FAIL because classifiers do not exist.

- [ ] **Step 3: Implement swing and classification pure functions**

Detect a swing high/low only when its high/low exceeds the two bars on both sides. Compare the latest two confirmed highs and lows exactly as specified. Encode market-state rules in their documented priority order and risk conditions as a named list of booleans. Map risk order as `{"低": 0, "升温": 1, "高": 2}` for comparison.

- [ ] **Step 4: Run classification and complete unit suite**

Run: `python -m unittest scripts.test_cyb_strength_system -v`

Expected: PASS.

- [ ] **Step 5: Commit classifiers**

```powershell
git add scripts/build_cyb_trend_stats.py scripts/test_cyb_strength_system.py
git commit -m "feat: classify CYB trend state and risk"
```

---

### Task 4: 日聚合、跨日结构和版本 2 输出

**Files:**
- Modify: `scripts/build_cyb_trend_stats.py`
- Modify: `scripts/test_cyb_strength_system.py`
- Modify: `scripts/validate_web_data.py`

**Interfaces:**
- Consumes all calculation functions from Tasks 1–3.
- Produces: `build_day_stats(records: list[dict]) -> list[dict]` with version 2 daily fields.
- Produces summary root `schemaVersion: 2` and preserves version 1 history values.

- [ ] **Step 1: Write failing aggregation tests**

Test a complete synthetic day and an incomplete day. Assert `avgRecoveryRate`, median repair time, `closePosition`, `dayChange`, `trendStructure`, `marketState`, `riskLevel`, `riskChange`, `reasons`, and `dataQuality`. Add this compatibility test:

```python
def test_summary_keeps_v1_history_without_zero_filling(tmp_path):
    old_day = {"date": "2026-08-08", "count": 1, "maxDepth": 1.1, "dips": []}
    write_history_fixture(tmp_path, "20260808", old_day)
    summary = trend.make_summary(list(trend.load_history(tmp_path).values()))
    assert summary["schemaVersion"] == 2
    assert "avgRecoveryRate" not in summary["days"][0]
```

- [ ] **Step 2: Run aggregation tests and verify failure**

Run: `python -m unittest scripts.test_cyb_strength_system.CybAggregationTests -v`

Expected: FAIL because version 2 aggregation is absent.

- [ ] **Step 3: Implement day aggregation and cross-day context**

Have `build_day_stats` retain up to the previous trading day's 15-minute bars when classifying a day with insufficient swings. Calculate median using `statistics.median`. Set `dataQuality` before classification. Generate `riskChange` only after days are date-sorted. Extract summary construction into `make_summary(days)` so compatibility is unit-testable, then let `write_summary` serialize it.

- [ ] **Step 4: Add version 2 validator checks**

When `schemaVersion == 2`, validate optional percentage fields are finite and between 0 and 100, `reasons` has at most three strings, enum values are allowed, and incomplete days have null/absent classification. Do not require new fields on legacy daily rows.

- [ ] **Step 5: Run backend tests and validation**

Run: `python -m unittest scripts.test_cyb_strength_system -v`

Expected: PASS.

Run: `python scripts/validate_web_data.py`

Expected: PASS against current version 1 production data.

- [ ] **Step 6: Commit aggregation and validation**

```powershell
git add scripts/build_cyb_trend_stats.py scripts/test_cyb_strength_system.py scripts/validate_web_data.py
git commit -m "feat: emit CYB strength schema v2"
```

---

### Task 5: 摘要卡、收复率图线和表格扩展

**Files:**
- Modify: `web/custom.js`
- Modify: `web/custom.css`
- Modify: `scripts/test_trend_stats_table_layout.py`

**Interfaces:**
- Consumes daily version 2 fields from Task 4 while accepting version 1 rows.
- Produces: `renderCybStrengthSummary(latestDay)` and safe numeric helpers used by chart/table renderers.

- [ ] **Step 1: Extend Playwright assertions before UI changes**

Update the browser test to wait for `.cyb-strength-summary`, assert the five values and reasons render, assert summary-table headers include `平均收复`, `收盘位置`, `市场状态`, and assert dip headers include `收复率`, `修复至50%`. Inject one version 1 row in the fetched payload and assert its new cells contain `—`.

- [ ] **Step 2: Run browser test and verify failure**

Start the existing local server used by this repository on port 8766, then run:

`python scripts/test_trend_stats_table_layout.py`

Expected: FAIL because the summary and new columns do not exist.

- [ ] **Step 3: Implement safe presentation helpers and summary**

Add `isFiniteMetric(value)`, `metricPercent(value)`, and `metricMinutes(value)`. Render the latest complete day; if the latest day is incomplete, show a visible `数据不完整` message and no inferred state. Use `riskChange` only for arrow/helper copy, not as the main risk value.

- [ ] **Step 4: Add recovery line and table fields**

Add a 0–100% right axis and a recovery path built only from finite `avgRecoveryRate` points. Break the SVG path across missing values instead of connecting over legacy dates. Lower the opacity/weight of cumulative depth. Add the three daily columns and two dip columns with `—` fallbacks.

- [ ] **Step 5: Add responsive styles**

Use a wrapping CSS grid for `.cyb-strength-summary`, retain horizontal table overflow at narrow widths, and give state/reason text more width than numeric columns. Do not alter unrelated cards.

- [ ] **Step 6: Run browser layout verification**

Run: `python scripts/test_trend_stats_table_layout.py`

Expected: PASS at 1180, 901, 900, and 768 px, with screenshots written under `output/playwright/`.

- [ ] **Step 7: Commit UI**

```powershell
git add web/custom.js web/custom.css scripts/test_trend_stats_table_layout.py
git commit -m "feat: show CYB strength and recovery metrics"
```

---

### Task 6: 生成版本 2 数据并完成回归验证

**Files:**
- Modify: `web/data/cyb_trend_stats.json`
- Modify/Create: `web/data/cyb_trend_stats_history/` 下由本次输入实际覆盖日期对应的日文件

**Interfaces:**
- Consumes completed backend and frontend from Tasks 1–5.
- Produces a validated production summary and updated history only for dates backed by available minute data.

- [ ] **Step 1: Rebuild data from an available minute fixture**

Prefer the existing local westock-format minute fixture if it contains complete days:

`python scripts/build_cyb_trend_stats.py --file tmp/cyb_minute.txt --force`

If that file is absent or incomplete, fetch the supported recent range:

`python scripts/build_cyb_trend_stats.py --days 5 --force`

Expected: summary root contains `schemaVersion: 2`; rebuilt complete days contain the new fields.

- [ ] **Step 2: Inspect generated scope before staging**

Run: `git status --short web/data/cyb_trend_stats.json web/data/cyb_trend_stats_history`

Expected: only the summary and dates actually represented by the input minute data changed. Do not stage unrelated pre-existing data changes.

- [ ] **Step 3: Run complete verification**

Run: `python -m unittest scripts.test_cyb_strength_system -v`

Expected: PASS.

Run: `python scripts/validate_web_data.py`

Expected: PASS.

With the local server on port 8766, run: `python scripts/test_trend_stats_table_layout.py`

Expected: PASS at every configured viewport.

- [ ] **Step 4: Manually inspect latest-day semantics**

Open the trend-statistics tab and confirm: state and risk are distinct; reasons match numeric fields; legacy dates show `—`; the recovery line has no artificial zero drops; incomplete data has no inferred label.

- [ ] **Step 5: Commit generated data**

先运行 `git diff --name-only -- web/data/cyb_trend_stats.json web/data/cyb_trend_stats_history`，逐个核对输出均属于 Step 1 重算日期。使用 `git add -- <核对后复制的完整路径列表>` 暂存这些路径；不得使用目录级通配暂存。确认 `git diff --cached --name-only` 后提交：

```powershell
git commit -m "data: refresh CYB strength metrics"
```

---

## Final Verification Checklist

- [ ] `python -m unittest scripts.test_cyb_strength_system -v` passes.
- [ ] `python scripts/validate_web_data.py` passes.
- [ ] `python scripts/test_trend_stats_table_layout.py` passes at all four viewports.
- [ ] `git diff --check` reports no whitespace errors.
- [ ] `git status --short` contains no newly introduced unstaged implementation files.
- [ ] No unrelated pre-existing workspace changes were staged or committed.
- [ ] Version 1 history remains renderable and missing metrics are never treated as zero.
- [ ] Latest complete day shows both market state and independent pullback risk with up to three matching reasons.
