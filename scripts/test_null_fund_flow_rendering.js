const fs = require('fs');

const source = fs.readFileSync('web/custom.js', 'utf8');
const match = source.match(/const rowMainNetInflow = \(row\) => \{([\s\S]*?)\n\};/);

if (!match) throw new Error('rowMainNetInflow helper not found');

const rowMainNetInflow = new Function('row', `${match[1]}\nreturn parsed;`);

if (rowMainNetInflow({ mainNetInflow: null }) !== null) {
  throw new Error('missing fund flow must remain null instead of rendering as zero');
}

if (rowMainNetInflow({ mainNetInflow: 123 }) !== 123) {
  throw new Error('numeric fund flow must remain numeric');
}

const stockMatch = source.match(/const stockMainNetInflow = \(stock\) => \{([\s\S]*?)\n\};/);
if (!stockMatch) throw new Error('stockMainNetInflow helper not found');
const stockMainNetInflow = new Function('stock', `${stockMatch[1]}\nreturn parsed;`);
if (stockMainNetInflow({ mainNetInflow: null, latestMainNetInflow: null }) !== null) {
  throw new Error('missing stock fund flow must remain null instead of rendering as zero');
}

if (!source.includes('覆盖不足')) {
  throw new Error('low fund-flow coverage must be labeled explicitly');
}

console.log('null fund flow rendering behavior ok');
