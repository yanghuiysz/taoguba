const fs = require('fs');

const source = fs.readFileSync('web/custom-swing.js', 'utf8');
const start = source.indexOf('  function renderStockTable(');
const end = source.indexOf('  function renderSwingPanel(', start);
if (start < 0 || end < 0) throw new Error('stock resilience renderer missing');

const rows = Array.from({ length: 13 }, (_, index) => ({
  code: String(index + 1).padStart(6, '0'),
  name: `stock-${index + 1}`,
  sortScore: 100 - index,
  amount3: 1,
  amount5: 1,
  mainNetInflow3: null,
  mainNetInflow5: null,
  ret3: 1,
  ret5: 1,
  rel3: 1,
  rel5: 1,
  drawdown: 0,
  macdLabel: 'test',
  macdScore: 50,
}));

const factory = new Function(
  'sortedStockRows', 'safeNumber', 'stockSortLabel', 'fmt', 'fmtAmount',
  'signedTone', 'changeClass', 'fmtPercent', 'macdTone',
  `${source.slice(start, end)}\nreturn renderStockTable;`,
);
const renderStockTable = factory(
  () => rows,
  (value) => value === null || value === undefined || value === '' ? null : Number(value),
  () => '',
  (value) => String(value),
  (value) => String(value),
  () => '',
  () => '',
  (value) => String(value),
  () => '',
);

const html = renderStockTable({ code: 'board' });
if (!html.includes('stock-1') || !html.includes('stock-13')) {
  throw new Error('stock resilience table must render every valid member');
}

console.log('stock resilience rendering behavior ok');
