const fs = require("fs");
const assert = require("assert");

const dashboard = fs.readFileSync("web/index.html", "utf8");
const page = fs.readFileSync("web/etf.html", "utf8");
const js = fs.readFileSync("web/etf.js", "utf8");

assert(dashboard.includes('data-target="etf"'), "dashboard exposes the ETF tab");
assert(dashboard.includes('id="panel-etf"'), "dashboard includes the ETF panel");
assert(page.includes('id="broad-preference"'), "page includes broad-market preferences");
assert(page.includes('id="industry-ranking"'), "page includes the industry ranking");
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

console.log("PASS: ETF radar page wiring");
