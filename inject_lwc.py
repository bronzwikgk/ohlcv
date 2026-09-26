import re

with open('E:\\github\\ohlcv\\notebook\\omega_backtest.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add json import and all_chart_data
if 'import json' not in content:
    content = content.replace('import random', 'import random\nimport json\nall_chart_data = {}\n')

# 2. Add chart data collection in the loop
data_collection = """
        # Store for charts
        if file_path not in all_chart_data:
            df_chart = test_df.copy()
            df_chart['Date'] = df_chart['Date'].dt.strftime('%Y-%m-%d')
            all_chart_data[os.path.basename(file_path).replace('.csv', '')] = df_chart[['Date', 'Open', 'High', 'Low', 'Close', 'Omega_13', 'Omega_5', 'RSI_14']].to_dict(orient='records')
"""
if 'all_chart_data[os.path.basename' not in content:
    content = content.replace("mask = (df['Date'] >= '2023-01-01') & (df['Date'] <= '2023-12-31')\n        test_df = df[mask].copy().reset_index(drop=True)",
                              "mask = (df['Date'] >= '2023-01-01') & (df['Date'] <= '2023-12-31')\n        test_df = df[mask].copy().reset_index(drop=True)\n" + data_collection)

# 3. Add Inline HTML and LWC script
modal_html = """
    <!-- Inline Chart Viewer -->
    <div id="chartModal" class="mb-8 p-4 flex flex-col bg-slate-900 rounded-xl shadow-lg border border-slate-700" style="height: 600px;">
        <div class="flex justify-between items-center mb-2 bg-slate-800 p-2 rounded text-white">
            <div class="flex items-center gap-4">
                <h2 id="chartTitle" class="text-xl font-bold">Trade Analysis Chart</h2>
                <select id="stockSelector" class="bg-slate-700 text-white rounded px-2 py-1" onchange="renderSelectedStock()"></select>
            </div>
            <button onclick="document.getElementById('chartModal').style.display='none'" class="px-4 py-1 bg-slate-600 rounded hover:bg-slate-500 text-sm">Hide Chart</button>
        </div>
        <div id="chartContainer" class="flex-1 w-full relative flex flex-col">
            <div id="pane1" class="flex-[3] w-full border-b border-slate-700"></div>
            <div id="pane2" class="flex-1 w-full border-b border-slate-700"></div>
            <div id="pane3" class="flex-1 w-full border-b border-slate-700"></div>
            <div id="pane4" class="flex-1 w-full"></div>
        </div>
    </div>
"""

# Inject LWC script and Modal HTML
if 'lightweight-charts.standalone.production.js' not in content:
    content = content.replace('</head>', '    <script src="../library/lightweight-charts.standalone.production.js"></script>\n</head>')
    content = content.replace('<h2 class="text-2xl font-bold mb-4 text-slate-800">Global Strategy Performance</h2>', modal_html + '\n            <h2 class="text-2xl font-bold mb-4 text-slate-800">Global Strategy Performance</h2>')

# 5. Inject JSON Data and JS logic
js_logic = """
            const chartData = {json.dumps(all_chart_data)};
            let chart1, chart2, chart3, chart4;
            let candleSeries, o13Series, o5Series, rsiSeries;
            
            // Extract all trades from the table
            const allTrades = [];
            document.querySelectorAll('table tbody tr').forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if(tds.length >= 4) {
                    allTrades.push({
                        stock: tds[0].innerText.trim(),
                        entryDate: tds[1].innerText.trim(),
                        exitDate: tds[2].innerText.trim(),
                        result: tds[3].innerText.trim()
                    });
                }
            });
            
            // Populate Dropdown
            const stocks = [...new Set(allTrades.map(t => t.stock))];
            const selector = document.getElementById('stockSelector');
            selector.innerHTML = stocks.map(s => `<option value="${s}">${s}</option>`).join('');
            
            function renderSelectedStock() {
                const stock = selector.value;
                if (!stock) return;
                
                const data = chartData[stock];
                if (!data) return;
                
                const c1 = document.getElementById('pane1');
                const c2 = document.getElementById('pane2');
                const c3 = document.getElementById('pane3');
                const c4 = document.getElementById('pane4');
                
                if(!chart1) {
                    c1.innerHTML = ''; c2.innerHTML = ''; c3.innerHTML = ''; c4.innerHTML = '';
                    const chartOpts = { layout: { background: { color: '#0f172a' }, textColor: '#cbd5e1' }, grid: { vertLines: { color: '#334155' }, horzLines: { color: '#334155' } }, timeScale: { timeVisible: true } };
                    chart1 = LightweightCharts.createChart(c1, chartOpts);
                    chart2 = LightweightCharts.createChart(c2, chartOpts);
                    chart3 = LightweightCharts.createChart(c3, chartOpts);
                    chart4 = LightweightCharts.createChart(c4, chartOpts);
                    
                    candleSeries = chart1.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' });
                    o13Series = chart2.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
                    o5Series = chart3.addLineSeries({ color: '#a855f7', lineWidth: 2 });
                    rsiSeries = chart4.addLineSeries({ color: '#f59e0b', lineWidth: 2 });
                    
                    const charts = [chart1, chart2, chart3, chart4];
                    charts.forEach(c => {
                        c.timeScale().subscribeVisibleLogicalRangeChange(range => {
                            charts.forEach(other => { if (other !== c) other.timeScale().setVisibleLogicalRange(range); });
                        });
                    });
                }
                
                const candles = data.map(d => ({ time: d.Date, open: d.Open, high: d.High, low: d.Low, close: d.Close }));
                candleSeries.setData(candles);
                o13Series.setData(data.map(d => ({ time: d.Date, value: d.Omega_13 })));
                o5Series.setData(data.map(d => ({ time: d.Date, value: d.Omega_5 })));
                rsiSeries.setData(data.map(d => ({ time: d.Date, value: d.RSI_14 })));
                
                // Markers for ALL trades of this stock
                const markers = [];
                const stockTrades = allTrades.filter(t => t.stock === stock);
                stockTrades.forEach(t => {
                    const isWin = t.result.includes('WIN');
                    markers.push({ time: t.entryDate, position: 'belowBar', color: isWin ? '#22c55e' : '#ef4444', shape: 'arrowUp', text: 'E' });
                    let exitT = t.exitDate;
                    if(exitT && exitT.length > 0) {
                        markers.push({ time: exitT, position: 'aboveBar', color: isWin ? '#22c55e' : '#ef4444', shape: 'arrowDown', text: 'X' });
                    }
                });
                
                markers.sort((a, b) => new Date(a.time) - new Date(b.time));
                
                candleSeries.setMarkers(markers);
                o13Series.setMarkers(markers);
                o5Series.setMarkers(markers);
                rsiSeries.setMarkers(markers);
                
                setTimeout(() => {
                    chart1.timeScale().fitContent();
                }, 100);
            }
            
            // Initialize
            setTimeout(() => {
                if(stocks.length > 0) renderSelectedStock();
            }, 500);
"""

if 'const chartData =' not in content:
    content = content.replace('<script>\n            // Simple canvas sparkline drawer', '<script>\n' + js_logic + '\n            // Simple canvas sparkline drawer')

with open('E:\\github\\ohlcv\\inject_lwc.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated inject_lwc.py successfully")
