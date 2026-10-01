const fs = require('fs');
const path = require('path');
const yf = require('yahoo-finance2').default;
const yahooFinance = typeof yf === 'function' && yf.name === 'YahooFinance' ? new yf() : yf;
const csv = require('csv-parser');

const DATA_DIR = path.join(__dirname, 'data', 'market', 'nse', 'mstock');
const SYMBOLS_FILE = path.join(__dirname, 'data_list', 'mStock_mtf.csv');

// Random delay between 1.5 and 4 seconds to avoid rate limits
const randomDelay = () => new Promise(resolve => 
    setTimeout(resolve, Math.floor(Math.random() * 2500) + 1500)
);

// Format date to YYYY-MM-DD
const formatDate = (date) => date.toISOString().split('T')[0];

// Get the last date from an existing CSV
const getLastDateFromCSV = (filePath) => {
    try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        const lines = content.split('\n');
        if (lines.length <= 1) return null; // Only headers
        
        const lastLine = lines[lines.length - 1];
        const lastDate = lastLine.split(',')[0];
        return lastDate;
    } catch (e) {
        return null;
    }
};

// Convert Yahoo Finance JSON to CSV format
const convertToCSVFormat = (results, symbol) => {
    return results.map(row => {
        const dateStr = formatDate(row.date);
        // Format: Date,Open,High,Low,Close,Adj Close,Volume,Symbol
        return `${dateStr},${row.open},${row.high},${row.low},${row.close},${row.adjClose},${row.volume},${symbol}`;
    }).join('\n');
};

async function processStock(symbol) {
    const csvPath = path.join(DATA_DIR, `${symbol}.csv`);
    const exists = fs.existsSync(csvPath);
    
    // Add .NS suffix for Yahoo Finance if Indian stock, else keep as is
    // You can modify this suffix logic based on your market
    const yfSymbol = symbol.endsWith('.NS') ? symbol : `${symbol}.NS`;

    let queryOptions = { 
        period1: '2000-01-01',
        period2: formatDate(new Date()) 
    };

    if (exists) {
        const lastDateStr = getLastDateFromCSV(csvPath);
        if (lastDateStr) {
            const lastDate = new Date(lastDateStr);
            // We want data strictly AFTER the last date
            const nextDate = new Date(lastDate);
            nextDate.setDate(nextDate.getDate() + 1);
            
            // If the next date is in the future, we are already up to date
            if (nextDate > new Date()) {
                console.log(`[${symbol}] Already up to date (${lastDateStr})`);
                return;
            }
            
            queryOptions.period1 = formatDate(nextDate);
            
            if (queryOptions.period1 === queryOptions.period2) {
                console.log(`[${symbol}] Already up to date (${lastDateStr}). No new daily close available yet.`);
                return;
            }
            
            console.log(`[${symbol}] Updating from ${formatDate(nextDate)}...`);
        } else {
            console.log(`[${symbol}] CSV exists but empty. Fetching full history...`);
        }
    } else {
        console.log(`[${symbol}] No CSV found. Fetching full history...`);
    }

    try {
        const chartResult = await yahooFinance.chart(yfSymbol, queryOptions);
        const results = chartResult.quotes || [];
        
        if (results.length === 0) {
            console.log(`[${symbol}] No new data found on Yahoo Finance.`);
            return;
        }

        const csvContent = convertToCSVFormat(results, symbol);
        
        if (exists) {
            // Append to existing file (with a leading newline)
            fs.appendFileSync(csvPath, `\n${csvContent}`);
            console.log(`[${symbol}] Appended ${results.length} new rows.`);
        } else {
            // Create new file with headers
            const header = `Date,Open,High,Low,Close,Adj Close,Volume,Symbol\n`;
            fs.writeFileSync(csvPath, header + csvContent);
            console.log(`[${symbol}] Created new file with ${results.length} rows.`);
        }
    } catch (err) {
        console.error(`[${symbol}] ERROR fetching data:`, err.message);
    }
}

async function run() {
    if (!fs.existsSync(DATA_DIR)) {
        console.error(`Data directory does not exist: ${DATA_DIR}`);
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(SYMBOLS_FILE)) {
        console.log(`Creating dummy ${SYMBOLS_FILE} file. Please add symbols to it.`);
        fs.writeFileSync(SYMBOLS_FILE, 'Symbol\nRELIANCE\nTCS\nINFY\n');
    }

    const symbols = new Set();
    
    // 1. First, automatically load all symbols that already have CSVs
    console.log(`Scanning existing CSVs in ${DATA_DIR}...`);
    try {
        const files = fs.readdirSync(DATA_DIR);
        for (const file of files) {
            if (file.endsWith('.csv')) {
                symbols.add(file.replace('.csv', '').trim());
            }
        }
        console.log(`Found ${symbols.size} existing stocks to update.`);
    } catch (err) {
        console.error('Error reading data directory:', err.message);
    }

    // 2. Then load from target_symbols.csv (for adding new ones)
    console.log(`Reading new/target symbols from ${SYMBOLS_FILE}...`);
    
    fs.createReadStream(SYMBOLS_FILE)
        .pipe(csv())
        .on('data', (row) => {
            const sym = row['Symbol'] || row['symbol'] || row['Ticker'] || row['ticker'];
            if (sym) symbols.add(sym.trim());
        })
        .on('end', async () => {
            const symbolArray = Array.from(symbols);
            console.log(`Total unique symbols to process: ${symbolArray.length}\n`);
            
            for (let i = 0; i < symbolArray.length; i++) {
                const symbol = symbolArray[i];
                console.log(`Processing ${i + 1}/${symbolArray.length}: ${symbol}`);
                
                await processStock(symbol);
                
                if (i < symbolArray.length - 1) {
                    await randomDelay();
                }
            }
            
            console.log('\nAll stocks processed successfully!');
        });
}

run();
