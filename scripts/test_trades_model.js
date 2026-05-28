const assert = require("node:assert/strict");

const model = require("../web/trades-model.js");

const records = [
  {
    id: "20260527-buy-603256-001",
    date: "2026-05-27",
    action: "buy",
    stockCode: "603256",
    stockName: "宏和科技",
    boardName: "玻纤",
    quantity: null,
    price: null,
    amount: null,
    tags: ["买入", "科技发力预期", "冲高回落"],
    note: "早上科创板新高，判断科技方向可能继续发力，因此买入；但最终走势冲高回落。",
  },
  {
    id: "20260526-sell-603256-001",
    date: "2026-05-26",
    action: "sell",
    stockCode: "603256",
    stockName: "宏和科技",
    boardName: "玻纤",
    tags: ["卖出"],
    note: "",
  },
  {
    id: "20260519-buy-603078-001",
    date: "2026-05-19",
    action: "buy",
    stockCode: "603078",
    stockName: "江化微",
    boardName: "芯片半导体",
    quantity: 300,
    price: 34.19,
    amount: 10257,
    tags: ["买入"],
    note: "大环境止跌，板块强势",
  },
];

const buyRecords = model.buyRecords(records);
assert.equal(buyRecords.length, 2);
assert.equal(buyRecords[0].stockName, "宏和科技");

const grouped = model.groupRecordsByDate(buyRecords);
assert.deepEqual(grouped.map((group) => group.date), ["2026-05-27", "2026-05-19"]);
assert.equal(grouped[0].records[0].primaryTag, "冲高回落");
assert.equal(grouped[0].records[0].tradeMeta.length, 0);
assert.deepEqual(grouped[1].records[0].tradeMeta, ["300股", "34.19元", "10257元"]);

assert.equal(model.filterRecords(buyRecords, "科技", "").length, 1);
assert.equal(model.filterRecords(buyRecords, "", "冲高回落").length, 1);

const stats = model.summaryStats(buyRecords);
assert.equal(stats.total, 2);
assert.equal(stats.latestDate, "2026-05-27");
assert.equal(stats.latestStockCount, 1);

console.log("trades model tests passed");
