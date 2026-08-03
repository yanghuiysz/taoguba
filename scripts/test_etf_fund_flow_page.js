const fs = require("fs");
const assert = require("assert");

const dashboard = fs.readFileSync("web/index.html", "utf8");
const page = fs.readFileSync("web/etf.html", "utf8");
const js = fs.readFileSync("web/etf.js", "utf8");

assert(dashboard.includes('data-target="etf"'), "dashboard exposes the ETF tab");
assert(dashboard.includes('id="panel-etf"'), "dashboard includes the ETF panel");
assert(page.includes('id="broad-preference"'), "page includes broad-market preferences");
assert(page.includes('id="industry-ranking"'), "page includes the industry ranking");
assert(page.includes('id="source-errors"'), "page exposes current-date source errors");
assert(page.includes('data-sort="excessReturn1d"'), "page exposes 1-day excess sorting");
assert(page.includes('data-sort="turnover"'), "page exposes raw turnover sorting");
assert(js.includes("./data/etf_fund_flow.json"), "page loads the ETF snapshot");
assert(js.includes("待确认"), "page distinguishes unconfirmed values");
assert(js.includes("renderEtfRadar"), "page provides the radar renderer");

const { formatMoney, renderEtfRadar, selectRankedFlows, sortEtfs } = require("../web/etf.js");

assert.strictEqual(formatMoney(null), "—", "missing money is never displayed as zero");
assert.strictEqual(formatMoney(128_000_000), "1.28亿", "money uses compact Chinese units");
assert.deepStrictEqual(
  sortEtfs(
    [
      { code: "pending", netSubscription5d: null },
      { code: "low", netSubscription5d: -2 },
      { code: "high", netSubscription5d: 3 },
    ],
    "netSubscription5d",
    "desc",
  ).map((row) => row.code),
  ["high", "low", "pending"],
  "descending sort keeps pending rows last",
);
assert.deepStrictEqual(
  sortEtfs(
    [
      { code: "pending", netSubscription1d: null },
      { code: "low", netSubscription1d: -2 },
      { code: "high", netSubscription1d: 3 },
    ],
    "netSubscription1d",
    "asc",
  ).map((row) => row.code),
  ["low", "high", "pending"],
  "ascending sort also keeps pending rows last",
);
assert.deepStrictEqual(
  sortEtfs(
    [
      { code: "partial-high", netSubscription5d: 100, windowDays5d: 1 },
      { code: "full-low", netSubscription5d: 10, windowDays5d: 5 },
      { code: "pending", netSubscription5d: null, windowDays5d: 5 },
    ],
    "netSubscription5d",
    "desc",
  ).map((row) => row.code),
  ["full-low", "partial-high", "pending"],
  "full-window values sort ahead of partial-window values",
);
assert.strictEqual(typeof renderEtfRadar, "function", "radar renderer is callable");
assert.deepStrictEqual(
  selectRankedFlows(
    [
      { code: "in", netSubscription1d: 5 },
      { code: "flat", netSubscription1d: 0 },
      { code: "out", netSubscription1d: -3 },
      { code: "pending", netSubscription1d: null },
    ],
    "outflow",
    10,
  ).map((row) => row.code),
  ["out"],
  "outflow ranking never mixes in inflows when fewer than ten outflows exist",
);

class FakeClassList {
  constructor(node) { this.node = node; }
  add(name) { this.node.className = `${this.node.className} ${name}`.trim(); }
}

class FakeNode {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.className = "";
    this.children = [];
    this._text = "";
    this.classList = new FakeClassList(this);
  }
  set textContent(value) { this._text = String(value ?? ""); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
}

const ids = [
  "report-date", "report-status", "confirmed-count", "confirmed-warning", "generated-at",
  "source-errors", "broad-preference", "industry-inflow", "industry-outflow",
  "persistent-flow", "industry-table-body", "sort-description",
];
const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode()]));
global.document = {
  createElement: (tag) => new FakeNode(tag),
  getElementById: (id) => nodes[id],
};

renderEtfRadar({
  date: "2026-07-31",
  generatedAt: "2026-07-31T08:30:00+00:00",
  status: "partial",
  summary: { all: { count: 2, confirmedCount: 2, pendingCount: 0 } },
  errors: [{ code: "159915", source: "market", message: "changePercent missing for 2026-07-31" }],
  etfs: [
    {
      code: "510300", name: "沪深300ETF", scope: "broad", category: "大盘核心", direction: "沪深300",
      status: "confirmed", netSubscription1d: 10, netSubscription5d: 10, windowDays5d: 1,
      changePercent: 1,
    },
    {
      code: "159915", name: "创业板ETF", scope: "industry", category: "科技", direction: "创业板",
      status: "confirmed", netSubscription1d: 0, netSubscription5d: 0, netSubscription20d: 0,
      windowDays5d: 1, windowDays20d: 1, scale: 1_000_000, shareChange: 0,
      changePercent: 1.2, excessReturn1d: 0.2, excessReturn5d: null,
      turnover: 500_000, turnoverVs5d: null, flowLabel: "无净申赎",
    },
  ],
});

assert(nodes["broad-preference"].textContent.includes("1/5日累计"), "broad cards label partial windows");
assert(nodes["industry-table-body"].textContent.includes("1/5日"), "table exposes partial 5-day coverage");
assert(nodes["industry-table-body"].textContent.includes("1/20日"), "table exposes partial 20-day coverage");
assert(nodes["industry-table-body"].textContent.includes("50万"), "table renders raw daily turnover");
assert(nodes["industry-table-body"].textContent.includes("0.2%"), "table renders 1-day excess return");
assert(nodes["industry-table-body"].textContent.includes("无净申赎"), "zero flow renders a neutral label");
assert(nodes["source-errors"].textContent.includes("159915"), "current-date source errors are visible");
assert(nodes["source-errors"].textContent.includes("changePercent missing"), "source error reason is visible");

delete global.document;

console.log("PASS: ETF radar page wiring");
