const fs = require('fs');

const source = fs.readFileSync('web/custom.js', 'utf8');
const css = fs.readFileSync('web/custom.css', 'utf8');

const start = source.indexOf('const sidebarBoardFundFlow =');
const end = source.indexOf('const stockMainNetInflow =', start);
if (start < 0 || end < 0) throw new Error('sidebarBoardFundFlow production helper missing');

const helper = new Function(
  'rowMainNetInflow', 'amountText',
  `${source.slice(start, end)}\nreturn sidebarBoardFundFlow;`,
)(
  (row) => {
    const value = row?.mainNetInflow;
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
  (value) => {
    const parsed = Number(value);
    const abs = Math.abs(parsed);
    if (abs >= 100000000) return `${(parsed / 100000000).toFixed(2)}亿`;
    if (abs >= 10000) return `${(parsed / 10000).toFixed(2)}万`;
    return parsed.toFixed(0);
  },
);

const board = { trend: [
  { date: '2026-07-13', mainNetInflow: 120000000, fundFlowSource: 'eastmoney_stock_individual_fund_flow' },
  { date: '2026-07-14', mainNetInflow: -80000000, fundFlowSource: 'eastmoney_stock_individual_fund_flow' },
  { date: '2026-07-15', mainNetInflow: 0, fundFlowSource: 'eastmoney_stock_individual_fund_flow' },
  { date: '2026-07-12', mainNetInflow: 999, fundFlowSource: 'ths_stock_fund_flow_individual' },
] };

const positive = helper(board, '2026-07-13');
if (positive.label !== '主力净流入 +1.20亿' || positive.tone !== 'inflow') throw new Error('positive selected-date flow must render as red inflow');
const negative = helper(board, '2026-07-14');
if (negative.label !== '主力净流出 -8000.00万' || negative.tone !== 'outflow') throw new Error('negative selected-date flow must render as green outflow');
const zero = helper(board, '2026-07-15');
if (zero.label !== '主力净流入 0' || zero.tone !== 'inflow') throw new Error('zero flow must use inflow label and tone');
const missing = helper(board, '2026-07-16');
if (missing.label !== '资金暂无' || missing.tone !== 'missing') throw new Error('missing selected-date flow must stay missing');
const legacy = helper(board, '2026-07-12');
if (legacy.label !== '资金暂无' || legacy.tone !== 'missing') throw new Error('non-Eastmoney flow must not be labeled as main fund flow');

if (!source.includes('class="board-fund-flow ${fundFlow.tone}"')) throw new Error('sidebar card must render the selected-date fund flow');
if (!css.includes('.board-fund-flow.inflow') || !css.includes('.board-fund-flow.outflow')) throw new Error('sidebar flow color styles missing');

console.log('sidebar board fund flow behavior ok');
