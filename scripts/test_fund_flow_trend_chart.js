const fs = require('fs');

const source = fs.readFileSync('web/custom.js', 'utf8');
const css = fs.readFileSync('web/custom.css', 'utf8');
const testSource = fs.readFileSync(__filename, 'utf8');
if (testSource.includes(['const rowMain', 'NetInflow = (row) =>'].join(''))) {
  throw new Error('test must execute the production rowMainNetInflow helper instead of a handwritten substitute');
}

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
  if (rowMainNetInflow({ mainNetInflow: missing }) !== null) throw new Error('production rowMainNetInflow must preserve missing and invalid values as null');
}
if (rowMainNetInflow({ mainNetInflow: '123.5' }) !== 123.5) throw new Error('production rowMainNetInflow must parse numeric values');
if (fundFlowSourceText({ fundFlowSource: 'ths_stock_fund_flow_individual' }) !== '同花顺口径') throw new Error('production source label is incorrect');
if (fundFlowSourceText({ fundFlowSource: 'eastmoney_stock_individual_fund_flow' }) !== '东方财富口径') throw new Error('Eastmoney source label is incorrect');
if (fundFlowSourceText({}) !== '资金来源暂无') throw new Error('production missing-source label is incorrect');
if (fundFlowCoverageText({ fundFlowStockCount: 2, stocks: [{}, {}] }) !== '覆盖 2/2') throw new Error('production coverage label is incorrect');
if (fundFlowCoverageText({ fundFlowStockCount: 1, stocks: [{}, {}] }) !== '覆盖 1/2，覆盖不足') throw new Error('production low-coverage warning is incorrect');

const signedMatch = source.match(/const signedFundFlowText = \(value\) => \{([\s\S]*?)\n\};/);
if (!signedMatch) throw new Error('signedFundFlowText helper not found');
const signedFundFlowText = new Function('value', 'number', `${signedMatch[1]}\nreturn text;`);
const number = (value, digits = 2) => Number(value).toFixed(digits);
if (signedFundFlowText(1559000000, number) !== '+15.59亿') throw new Error('positive flow must use signed 亿 format');
if (signedFundFlowText(-572000000, number) !== '-5.72亿') throw new Error('negative flow must use signed 亿 format');
if (signedFundFlowText(0, number) !== '0.00亿') throw new Error('zero flow must use 0.00亿 format');

const chartTrendRows = new Function(
  'board', 'trendValues', 'marketIndexRowByDate', 'rowDisplayAverageChange',
  `${functionSource('chartTrendRows', 'renderTrendChart')}\nreturn chartTrendRows(board);`,
);
const board = { code: 'B1', name: '测试板块', trend: [
  { date: '2026-07-10', averageChange: 1, mainNetInflow: 1559000000, fundFlowSource: 'ths_stock_fund_flow_individual', fundFlowStockCount: 2, stocks: [{}, {}] },
  { date: '2026-07-11', averageChange: 0.5, mainNetInflow: 1, fundFlowSource: 'eastmoney_stock_individual_fund_flow', fundFlowStockCount: 2, stocks: [{}, {}] },
  { date: '2026-07-12', averageChange: -1, mainNetInflow: -572000000, fundFlowSource: 'ths_stock_fund_flow_individual', fundFlowStockCount: 1, stocks: [{}, {}] },
] };
const trendValues = (item) => item.trend;
const marketIndexRowByDate = (date) => date === '2026-07-11' ? null : { changePercent: 1 };
const rowDisplayAverageChange = (_board, row) => row.averageChange;
const alignedRows = chartTrendRows(board, trendValues, marketIndexRowByDate, rowDisplayAverageChange);
if (alignedRows.map((row) => row.date).join(',') !== '2026-07-10,2026-07-11,2026-07-12') throw new Error('shared chart rows must retain board dates when market index data is missing');
const xMatch = source.match(/const chartPointX = \(index, length, width, pad\) => ([^;]+);/);
if (!xMatch) throw new Error('shared chartPointX helper not found');
const chartPointX = new Function('index', 'length', 'width', 'pad', `return ${xMatch[1]};`);
const sharedPad = { left: 52, right: 48 };
if (chartPointX(1, 3, 760, sharedPad) !== 382) throw new Error('shared x-coordinate calculation is incorrect');
if ((source.match(/chartPointX\(index, [^\n]+\)/g) || []).length < 2) throw new Error('both charts must use shared x coordinates');

const segmentFactory = new Function(`${functionSource('fundFlowLineSegments', 'renderFundFlowTrendChart')}\nreturn fundFlowLineSegments;`);
const fundFlowLineSegments = segmentFactory();
const segments = fundFlowLineSegments([
  { x: 0, y: 20, value: 2 }, { x: 10, y: 10, value: -2 },
  { x: 20, y: null, value: null }, { x: 30, y: 12, value: -1 }, { x: 40, y: 8, value: 1 },
], 15);
if (segments.length !== 4 || segments[0].x2 !== 5 || segments[0].y2 !== 15 || segments[1].x1 !== 5) {
  throw new Error('line must switch color exactly at zero and break across null');
}
for (const [name, points, expectedTone] of [
  ['positive-to-zero', [{ x: 0, y: 10, value: 1 }, { x: 10, y: 15, value: 0 }], 'inflow'],
  ['zero-to-negative', [{ x: 0, y: 15, value: 0 }, { x: 10, y: 20, value: -1 }], 'outflow'],
  ['negative-to-zero', [{ x: 0, y: 20, value: -1 }, { x: 10, y: 15, value: 0 }], 'outflow'],
  ['zero-to-positive', [{ x: 0, y: 15, value: 0 }, { x: 10, y: 10, value: 1 }], 'inflow'],
  ['continuous-zero', [{ x: 0, y: 15, value: 0 }, { x: 10, y: 15, value: 0 }], 'inflow'],
]) {
  const zeroSegments = fundFlowLineSegments(points, 15);
  if (zeroSegments.length !== 1 || zeroSegments[0].tone !== expectedTone) throw new Error(`${name} must produce one correctly colored segment`);
  if (Object.values(zeroSegments[0]).some((value) => typeof value === 'number' && Number.isNaN(value))) throw new Error(`${name} must not produce NaN`);
  if (zeroSegments[0].x1 === zeroSegments[0].x2 && zeroSegments[0].y1 === zeroSegments[0].y2) throw new Error(`${name} must not produce a duplicate zero-length segment`);
}

const labelMatch = source.match(/const fundFlowLabelY = \(pointY, padTop, axisBottom\) => ([^;]+);/);
if (!labelMatch) throw new Error('fundFlowLabelY production helper not found');
const fundFlowLabelY = new Function('pointY', 'padTop', 'axisBottom', `return ${labelMatch[1]};`);
if (fundFlowLabelY(100, 34, 194) > 88) throw new Error('normal point label must sit at least 12px above the point');
const topLabelY = fundFlowLabelY(42, 34, 194);
if (topLabelY - 42 < 12 || topLabelY > 190) throw new Error('top-edge point label must move below the point with safe spacing');

const renderFundFlowTrendChart = new Function(
  'board', 'chartTrendRows', 'rowMainNetInflow', 'fundFlowLineSegments', 'signedFundFlowText',
  'fundFlowSourceText', 'fundFlowCoverageText', 'shortDate', 'state', 'chartPointX',
  'fundFlowLabelY',
  `${functionSource('renderFundFlowTrendChart', 'pureCoreChartScaffold')}\nreturn renderFundFlowTrendChart(board);`,
);
const deps = [
  rowMainNetInflow, fundFlowLineSegments, (value) => signedFundFlowText(value, number),
  fundFlowSourceText, fundFlowCoverageText,
  (date) => date.slice(5), { sortDate: '2026-07-12' }, chartPointX, fundFlowLabelY,
];
const html = renderFundFlowTrendChart(board, () => alignedRows, ...deps);
if (!html.includes('+15.59亿') || !html.includes('-5.72亿')) throw new Error('rendered nodes must use signed 亿 labels');
if (!html.includes('2026-07-10 | 资金净流入 +15.59亿 | 同花顺口径 | 覆盖 2/2')) throw new Error('title must contain date, signed amount, source, and coverage');
if (!html.includes('selected-date-band')) throw new Error('selected date highlight missing');
if ((html.match(/fund-flow-dot/g) || []).length !== 3) throw new Error('only numeric values may render nodes');
const topNode = html.match(/class="fund-flow-dot inflow" cx="[^"]+" cy="([^"]+)"[\s\S]*?class="fund-flow-value inflow"[^>]*>(?:\+15\.59亿)/);
if (!topNode) throw new Error('highest inflow node and label not found');
const topValueTag = html.slice(topNode.index).match(/<text[^>]* y="([^"]+)"[^>]*class="fund-flow-value inflow"/);
if (!topValueTag || Number(topValueTag[1]) - Number(topNode[1]) < 12) throw new Error('highest point label must move below instead of overlapping the dot');

const singleHtml = renderFundFlowTrendChart(board, () => [alignedRows[0]], ...deps);
if ((singleHtml.match(/class="fund-flow-dot /g) || []).length !== 1) throw new Error('single-point series must render exactly one dot');
if ((singleHtml.match(/class="fund-flow-line /g) || []).length !== 0) throw new Error('single-point series must not render a line');

const missingBoard = { ...board, trend: alignedRows.map((row) => ({ ...row, mainNetInflow: row.date === '2026-07-10' ? null : 'bad' })) };
const missingHtml = renderFundFlowTrendChart(missingBoard, (item) => item.trend, ...deps);
if (!missingHtml.includes('暂无资金净流入数据') || missingHtml.includes('fund-flow-dot')) throw new Error('all-missing series must render only the empty state');

const trendBody = functionSource('renderTrendChart', 'fundFlowLineSegments');
if (!trendBody.includes('chartTrendRows(board)')) throw new Error('price chart must use shared chartTrendRows');
if (!source.includes('const pad = { top: 34, right: 48, bottom: 46, left: 52 };')) throw new Error('fund-flow chart padding must align with price chart');
if (/class="tag-label"/.test(source)) throw new Error('trend date-axis strength tags must stay removed');
if (!source.includes('<strong>资金净流入</strong>') || !source.includes('<span>东方财富口径 · 正值流入 / 负值流出</span>')) throw new Error('panel title or subtitle is not exact');
if (!css.includes('.fund-flow-line.inflow') || !css.includes('.fund-flow-line.outflow')) throw new Error('fund-flow color styles missing');

console.log('fund flow trend chart behavior ok');
