const fs = require('fs');

const source = fs.readFileSync('web/custom.js', 'utf8');
const css = fs.readFileSync('web/custom.css', 'utf8');

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  if (start < 0 || end < 0) throw new Error(`${name} helper not found`);
  return source.slice(start, end);
}

function constSource(name, nextMarker) {
  const start = source.indexOf(`const ${name} =`);
  const end = source.indexOf(nextMarker, start + 1);
  if (start < 0 || end < 0) throw new Error(`${name} production helper not found`);
  return source.slice(start, end);
}

const rowMainNetInflow = new Function(`${constSource('rowMainNetInflow', 'const stockMainNetInflow =')}\nreturn rowMainNetInflow;`)();
const fundFlowSourceText = new Function(`${constSource('fundFlowSourceText', 'const todayFundFlowCell =')}\nreturn fundFlowSourceText;`)();
const fundFlowCoverageText = new Function(`${constSource('fundFlowCoverageText', 'async function fetchJsonNoStore')}\nreturn fundFlowCoverageText;`)();
for (const missing of [null, undefined, 'not-a-number']) {
  if (rowMainNetInflow({ mainNetInflow: missing }) !== null) throw new Error('missing flow must remain null');
}

const signedMatch = source.match(/const signedFundFlowText = \(value\) => \{([\s\S]*?)\n\};/);
if (!signedMatch) throw new Error('signedFundFlowText helper not found');
const number = (value, digits = 2) => Number(value).toFixed(digits);
const signedFundFlowText = new Function('value', 'number', `${signedMatch[1]}\nreturn text;`);

const chartTrendRows = new Function(
  'board', 'trendValues', 'marketIndexRowByDate', 'rowDisplayAverageChange',
  `${functionSource('chartTrendRows', 'renderTrendChart')}\nreturn chartTrendRows(board);`,
);
const board = { code: 'B1', name: 'sample', trend: [
  { date: '2026-07-10', averageChange: 1, mainNetInflow: 1559000000, fundFlowSource: 'eastmoney_stock_individual_fund_flow', fundFlowStockCount: 2, stocks: [{}, {}] },
  { date: '2026-07-11', averageChange: 0.5, mainNetInflow: 1, fundFlowSource: 'eastmoney_stock_individual_fund_flow', fundFlowStockCount: 2, stocks: [{}, {}] },
  { date: '2026-07-12', averageChange: -1, mainNetInflow: -572000000, fundFlowSource: 'eastmoney_stock_individual_fund_flow', fundFlowStockCount: 1, stocks: [{}, {}] },
  { date: '2026-07-13', averageChange: 0, mainNetInflow: null, stocks: [{}, {}] },
] };
const alignedRows = chartTrendRows(board, (item) => item.trend, () => ({ changePercent: 1 }), (_board, row) => row.averageChange);

const labelMatch = source.match(/const fundFlowBarLabelY = \(value, pointY, padTop, axisBottom\) => ([\s\S]*?);/);
if (!labelMatch) throw new Error('bar label placement helper missing');
const fundFlowBarLabelY = new Function('value', 'pointY', 'padTop', 'axisBottom', `return ${labelMatch[1]};`);
if (fundFlowBarLabelY(10, 50, 34, 194) >= 50) throw new Error('positive bar label must sit above the bar');
if (fundFlowBarLabelY(-10, 150, 34, 194) <= 150) throw new Error('negative bar label must sit below the bar');

const xMatch = source.match(/const chartPointX = \(index, length, width, pad\) => ([^;]+);/);
const chartPointX = new Function('index', 'length', 'width', 'pad', `return ${xMatch[1]};`);
const renderFundFlowTrendChart = new Function(
  'board', 'chartTrendRows', 'rowMainNetInflow', 'signedFundFlowText', 'fundFlowSourceText',
  'fundFlowCoverageText', 'shortDate', 'state', 'chartPointX', 'fundFlowBarLabelY',
  `${functionSource('renderFundFlowTrendChart', 'pureCoreChartScaffold')}\nreturn renderFundFlowTrendChart(board);`,
);
const html = renderFundFlowTrendChart(
  board, () => alignedRows, rowMainNetInflow, (value) => signedFundFlowText(value, number),
  fundFlowSourceText, fundFlowCoverageText, (date) => date.slice(5), { sortDate: '2026-07-12' },
  chartPointX, fundFlowBarLabelY,
);
if ((html.match(/class="fund-flow-bar /g) || []).length !== 3) throw new Error('only numeric values may render bars');
if (!html.includes('fund-flow-bar inflow') || !html.includes('fund-flow-bar outflow selected')) throw new Error('positive and negative bars need distinct tones and selected state');
if (html.includes('fund-flow-dot') || html.includes('fund-flow-line')) throw new Error('fund flow chart must not render the old line chart');
if (!html.includes('2026-07-12 |')) throw new Error('bar hover title must retain date and detail');
if (!css.includes('.fund-flow-bar.inflow') || !css.includes('.fund-flow-bar.outflow')) throw new Error('bar color styles missing');
if (css.includes('.fund-flow-line.inflow') || css.includes('.fund-flow-dot.inflow')) throw new Error('old line chart styles must be removed');

const missingBoard = { ...board, trend: board.trend.map((row) => ({ ...row, mainNetInflow: null })) };
const missingHtml = renderFundFlowTrendChart(
  missingBoard, (item) => item.trend, rowMainNetInflow, (value) => signedFundFlowText(value, number),
  fundFlowSourceText, fundFlowCoverageText, (date) => date.slice(5), { sortDate: '' }, chartPointX, fundFlowBarLabelY,
);
if (!missingHtml.includes('暂无资金净流入数据') || missingHtml.includes('fund-flow-bar')) throw new Error('missing series must render empty state');

console.log('fund flow bar chart behavior ok');
