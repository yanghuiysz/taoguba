const fs = require('fs');

const source = fs.readFileSync('web/custom-swing.js', 'utf8');
const start = source.indexOf('  function rankingRowsToDate(');
const end = source.indexOf('  function stockRows(', start);
if (start < 0 || end < 0) throw new Error('board ranking production helpers missing');

const safeNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const compoundReturn = (values) => {
  const valid = values.map(safeNumber).filter((value) => value !== null);
  if (!valid.length) return null;
  return (valid.reduce((acc, value) => acc * (1 + value / 100), 1) - 1) * 100;
};
const maxDrawdownFromChanges = (changes) => {
  let value = 1;
  let peak = 1;
  let drawdown = 0;
  for (const change of changes) {
    value *= 1 + Number(change) / 100;
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, (peak - value) / peak * 100);
  }
  return drawdown;
};

const factory = new Function(
  'getTrendRows', 'getBoardChange', 'getIndexChange', 'getRowTurnover',
  'rowMainNetInflowValue', 'safeNumber', 'compoundReturn', 'maxDrawdownFromChanges',
  `${source.slice(start, end)}\nreturn { rankingRowsToDate, boardRankingBaseMetric, normalizeBoardRankingMetric, scoreBoardRankingRows };`,
);
const api = factory(
  (board) => board.trend,
  (_board, row) => safeNumber(row.averageChange),
  (date) => ({
    '2026-07-11': 0.5, '2026-07-12': 0.5, '2026-07-13': 0.5,
    '2026-07-14': 0.5, '2026-07-15': 0.5, '2026-07-16': 9,
  }[date] ?? null),
  (row) => row.totalTurnover === null || row.totalTurnover === undefined ? null : safeNumber(row.totalTurnover),
  (row) => row.mainNetInflow === null || row.mainNetInflow === undefined ? null : safeNumber(row.mainNetInflow),
  safeNumber,
  compoundReturn,
  maxDrawdownFromChanges,
);

const board = { code: 'a', name: '医药', trend: [
  { date: '2026-07-11', averageChange: 1, totalTurnover: 100, mainNetInflow: 10 },
  { date: '2026-07-12', averageChange: 1, totalTurnover: 200, mainNetInflow: null },
  { date: '2026-07-13', averageChange: 1, totalTurnover: 300, mainNetInflow: 30 },
  { date: '2026-07-14', averageChange: 2, totalTurnover: 400, mainNetInflow: 40 },
  { date: '2026-07-15', averageChange: 3, totalTurnover: 500, mainNetInflow: 50 },
  { date: '2026-07-16', averageChange: 50, totalTurnover: 9999, mainNetInflow: 9999 },
] };
const metric = api.boardRankingBaseMetric(board, '2026-07-15');
if (metric.amount3 !== 1200 || metric.amount5 !== 1500) throw new Error('turnover windows must sum board totals through selected date');
if (metric.mainNetInflow3 !== 120 || metric.mainNetInflow5 !== null) throw new Error('fund-flow windows must require complete daily values');
const intradayBoard = { code: 'live', name: 'live', trend: [
  { date: '2026-07-10', averageChange: 1, totalTurnover: 100, mainNetInflow: 10 },
  { date: '2026-07-11', averageChange: 1, totalTurnover: 100, mainNetInflow: 20 },
  { date: '2026-07-12', averageChange: 1, totalTurnover: 100, mainNetInflow: 30 },
  { date: '2026-07-13', averageChange: 1, totalTurnover: 100, mainNetInflow: 40 },
  { date: '2026-07-14', averageChange: 1, totalTurnover: 100, mainNetInflow: 50 },
  { date: '2026-07-15', averageChange: 1, totalTurnover: 100, mainNetInflow: 60 },
  { date: '2026-07-16', averageChange: 2, totalTurnover: 500, mainNetInflow: null },
] };
const intradayMetric = api.boardRankingBaseMetric(intradayBoard, '2026-07-16');
if (intradayMetric.amountToday !== 500) throw new Error('current-day turnover must be exposed separately');
if (intradayMetric.mainNetInflowToday !== null) throw new Error('missing current-day fund flow must remain unavailable');
if (intradayMetric.amount3 !== 700) throw new Error('intraday turnover must include the current trading day');
if (intradayMetric.mainNetInflow3 !== 150 || intradayMetric.mainNetInflow5 !== 200) throw new Error('intraday fund flow must use the latest completed trading days');
if (intradayMetric.fundFlowLatestDate !== '2026-07-15') throw new Error('fund-flow cutoff date must identify the latest completed trading day');
const expectedReturn3 = compoundReturn([1, 2, 3]);
const expectedIndex3 = compoundReturn([0.5, 0.5, 0.5]);
if (Math.abs(metric.return3 - expectedReturn3) > 1e-9) throw new Error('3-day board return must compound');
if (Math.abs(metric.relative3 - (expectedReturn3 - expectedIndex3)) > 1e-9) throw new Error('relative return must subtract compounded index return');
if (metric.drawdown !== 0) throw new Error('rising window drawdown must be zero');

const short = api.boardRankingBaseMetric({ code: 'short', name: '不足', trend: board.trend.slice(0, 2) }, '2026-07-15');
if (short.amount3 !== null || short.return3 !== null || short.amount5 !== null) throw new Error('short windows must remain null');

const lower = { code: 'b', name: '光伏', trend: board.trend.slice(0, 5).map((row) => ({ ...row, totalTurnover: row.totalTurnover / 2, averageChange: -1, mainNetInflow: 1 })) };
const scored = api.scoreBoardRankingRows([lower, board, { code: 'missing', name: '缺失', trend: board.trend.slice(0, 3) }], '2026-07-15');
if (scored[0].board.code !== 'a' || scored[0].sortScore !== 100) throw new Error('highest turnover and return board must rank first with score 100');
if (scored.at(-1).board.code !== 'missing' || scored.at(-1).sortScore !== null) throw new Error('missing core window must rank last');

const css = fs.readFileSync('web/custom-swing.css', 'utf8');
for (const marker of [
  "const BOARD_RANKING_TAB = 'board-ranking'",
  "textContent = '板块排行'",
  'data-swing-board-ranking-sort-key=',
  'data-board-ranking-code=',
  '当日成交额', '当日资金净流入', '3日成交额', '5日成交额', '3日资金净流入', '5日资金净流入',
  '3日涨幅', '5日涨幅', '最大回撤',
]) {
  if (!source.includes(marker)) throw new Error(`board ranking UI marker missing: ${marker}`);
}
for (const marker of ["sortableHeader('sortScore'", "sortableHeader('relative3'", "sortableHeader('relative5'"]) {
  if (source.includes(marker)) throw new Error(`removed board ranking column returned: ${marker}`);
}
for (const marker of ['.board-ranking-table', '.board-ranking-status', 'min-width: 1080px', 'padding: 6px 6px', '@media (max-width: 900px)']) {
  if (!css.includes(marker)) throw new Error(`board ranking CSS marker missing: ${marker}`);
}

console.log('board swing ranking behavior ok');
