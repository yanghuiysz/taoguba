# Fund Flow Trend Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove strength labels from the board return chart and add a red-positive/green-negative daily net fund-flow line chart beneath it.

**Architecture:** Keep the existing generated `board.trend` data contract and implement the chart entirely in `web/custom.js`. Separate fund-flow row normalization and signed line segmentation from SVG rendering so missing values and zero crossings can be regression-tested without a browser; reuse the existing chart-panel layout and shared SVG styles, adding only fund-flow-specific colors.

**Tech Stack:** Vanilla JavaScript, inline SVG, CSS, Node.js source-level regression tests, existing Python data validator.

---

## File Structure

- Modify `web/custom.js`: remove strength tags from `renderTrendChart`, normalize daily fund-flow points, split line segments at zero, render the SVG, and insert the new panel.
- Modify `web/custom.css`: add fund-flow line, node, and label styles using A-share red-for-inflow and green-for-outflow semantics.
- Create `scripts/test_fund_flow_trend_chart.js`: verify labels are removed, signed colors are present, missing values are preserved, and the panel is placed before turnover.

### Task 1: Lock the UI and missing-value requirements in a failing test

**Files:**
- Create: `scripts/test_fund_flow_trend_chart.js`
- Test: `web/custom.js`

- [ ] **Step 1: Write the failing source regression test**

```js
const fs = require('fs');
const source = fs.readFileSync('web/custom.js', 'utf8');

if (!source.includes('function renderFundFlowTrendChart(board)')) {
  throw new Error('fund-flow trend chart renderer missing');
}
if (source.includes('class="tag-label"')) {
  throw new Error('strength labels must be removed from the return chart');
}
if (!source.includes('<strong>资金净流入</strong>')) {
  throw new Error('fund-flow chart panel missing');
}
if (source.indexOf('<strong>资金净流入</strong>') > source.indexOf('<strong>正宗股成交额</strong>')) {
  throw new Error('fund-flow chart must appear before turnover chart');
}
if (!source.includes('fund-flow-line inflow') || !source.includes('fund-flow-line outflow')) {
  throw new Error('signed fund-flow line colors missing');
}
if (!source.includes('item.mainNetInflow === null') || !source.includes('Number.isFinite')) {
  throw new Error('missing fund-flow values must not become zero');
}

console.log('fund-flow trend chart behavior ok');
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `node scripts/test_fund_flow_trend_chart.js`

Expected: FAIL with `fund-flow trend chart renderer missing`.

- [ ] **Step 3: Commit the red test independently only if repository policy permits test-only commits**

```powershell
git add -- scripts/test_fund_flow_trend_chart.js
git commit -m "test: cover fund flow trend chart"
```

### Task 2: Remove date-axis strength labels and implement signed chart geometry

**Files:**
- Modify: `web/custom.js:1307-1390`
- Modify: `web/custom.js` immediately after `renderTrendChart`
- Test: `scripts/test_fund_flow_trend_chart.js`

- [ ] **Step 1: Remove tag lookup and SVG tag text from `renderTrendChart`**

Delete the `label` lookup, the returned `tag` property, and this SVG fragment:

```js
${point.tag ? `<text x="${point.x}" y="${height - 30}" text-anchor="middle" class="tag-label">${point.tag}</text>` : ''}
```

Keep the date label at the bottom of the chart.

- [ ] **Step 2: Add a fund-flow row normalizer that preserves missing values**

```js
function fundFlowTrendValues(board) {
  return trendValues(board).map((item) => {
    if (item.mainNetInflow === null || item.mainNetInflow === undefined || item.mainNetInflow === '') {
      return { ...item, fundFlowValue: null };
    }
    const value = Number(item.mainNetInflow);
    return { ...item, fundFlowValue: Number.isFinite(value) ? value : null };
  });
}
```

- [ ] **Step 3: Add zero-crossing segment construction**

Implement `fundFlowLineSegments(points, zeroY)` to walk adjacent valid points. For equal signs, append one segment with tone `inflow` for values `>= 0` and `outflow` for values `< 0`. For opposite signs, calculate `ratio = Math.abs(left.value) / (Math.abs(left.value) + Math.abs(right.value))`, interpolate the crossing `x`, add the left-colored segment ending at `{x: crossingX, y: zeroY}`, and add the right-colored segment beginning at the same point. Reset continuity whenever either adjacent point is missing.

- [ ] **Step 4: Render the fund-flow SVG**

Add `renderFundFlowTrendChart(board)` with the same `760` viewBox width and x/date positions as `renderTrendChart`. Scale the y-axis symmetrically around zero using `maxAbs = Math.max(...valid.map(abs), 1) * 1.12`, render a dashed zero line, selected-date band, signed segments, valid nodes, formatted `+/-` amount labels, date labels, and `<title>` text containing date, `amountText(value)`, source, and `fundFlowCoverageText(item)`.

For no valid values return:

```html
<div><strong>暂无资金流数据</strong><p>这个板块最近没有可用的同花顺资金流数据。</p></div>
```

- [ ] **Step 5: Run the focused test**

Run: `node scripts/test_fund_flow_trend_chart.js`

Expected: FAIL only because the chart panel and/or CSS hooks have not yet been inserted.

### Task 3: Insert and style the fund-flow panel

**Files:**
- Modify: `web/custom.js:2082-2100`
- Modify: `web/custom.css:804-1037`
- Test: `scripts/test_fund_flow_trend_chart.js`

- [ ] **Step 1: Insert the panel between return and turnover charts**

```html
<div class="chart-panel fund-flow-chart-panel">
  <div class="chart-panel-head">
    <strong>资金净流入</strong>
    <span>同花顺口径 · 正值流入 / 负值流出</span>
  </div>
  <div class="chart-box">${renderFundFlowTrendChart(board)}</div>
</div>
```

- [ ] **Step 2: Add restrained chart-specific CSS**

```css
.fund-flow-line {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3;
}
.fund-flow-line.inflow { stroke: var(--red); }
.fund-flow-line.outflow { stroke: var(--green); }
.fund-flow-node.inflow { fill: #fff; stroke: var(--red); }
.fund-flow-node.outflow { fill: #fff; stroke: var(--green); }
.fund-flow-value.inflow { fill: var(--red); }
.fund-flow-value.outflow { fill: var(--green); }
```

Nodes use `stroke-width: 2.2`, with the selected node using `3` and a larger radius, matching the existing chart.

- [ ] **Step 3: Run the focused regression test**

Run: `node scripts/test_fund_flow_trend_chart.js`

Expected: `fund-flow trend chart behavior ok`.

- [ ] **Step 4: Commit the implementation if requested**

```powershell
git add -- web/custom.js web/custom.css scripts/test_fund_flow_trend_chart.js
git commit -m "feat: add board fund flow trend chart"
```

### Task 4: Full verification and visual QA

**Files:**
- Verify: `web/custom.js`
- Verify: `web/custom.css`
- Verify: `web/data/custom_boards.json`

- [ ] **Step 1: Run JavaScript tests and syntax checks**

```powershell
node scripts/test_fund_flow_trend_chart.js
node scripts/test_null_fund_flow_rendering.js
node --check web/custom.js
node --check web/custom-swing.js
```

Expected: both behavior tests print `ok`; both syntax checks exit `0`.

- [ ] **Step 2: Run data tests and validation**

```powershell
python scripts/test_ths_fund_flow.py
python scripts/test_ths_fund_flow_integration.py
python scripts/test_ths_fund_flow_validation.py
python scripts/validate_web_data.py
```

Expected: all three THS tests print `ok`; validator reports custom board data OK.

- [ ] **Step 3: Run whitespace validation**

Run: `git diff --check -- web/custom.js web/custom.css scripts/test_fund_flow_trend_chart.js`

Expected: exit `0`, allowing only line-ending conversion warnings.

- [ ] **Step 4: Perform local visual QA**

Start: `python scripts/serve_custom_boards.py --host 127.0.0.1 --port 8765`

Open the custom-board trend tab and verify: no strength labels above dates; fund-flow chart is between return and turnover; positive sections and nodes are red; negative sections and nodes are green; zero crossings change color at zero; selected dates align across charts; no horizontal overflow at desktop and narrow viewport widths.
