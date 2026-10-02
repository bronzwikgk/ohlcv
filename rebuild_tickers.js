const fs = require('fs');
const path = require('path');

const dir = 'e:/github/ohlcv/data/market/nse/mstock';
const files = fs.readdirSync(dir);

const tickers = files
    .filter(f => f.endsWith('.csv'))
    .map(f => f.replace('.csv', ''))
    .sort();

const out = 'export const TICKERS = [\n' + 
    tickers.map(s => `  { symbol: "${s}", name: "${s}" }`).join(',\n') + 
    '\n];\n';

fs.writeFileSync('e:/github/ohlcv/ohlcv_app/data_list/tickers.js', out);
console.log(`Successfully rebuilt tickers.js with ${tickers.length} tickers.`);
