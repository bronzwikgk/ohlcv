import re

with open('E:\\github\\ohlcv\\output\\omega_backtest_report.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace the old chart JS with a new auto-rendering one
old_js_start = html.find('const chartData =')
old_js_end = html.find('// Simple canvas sparkline drawer')

if old_js_start != -1 and old_js_end != -1:
    # First, let's inject a dropdown selector into the chart viewer html
    # The viewer looks like:
    # <div id="chartModal" class="mb-8 p-4 flex flex-col bg-slate-900 rounded-xl shadow-lg border border-slate-700" style="height: 600px; display: none;">
    viewer_div = '<div id="chartModal" class="mb-8 p-4 flex flex-col bg-slate-900 rounded-xl shadow-lg border border-slate-700" style="height: 600px; display: none;">'
    new_viewer_div = '<div id="chartModal" class="mb-8 p-4 flex flex-col bg-slate-900 rounded-xl shadow-lg border border-slate-700" style="height: 600px;">'
    html = html.replace(viewer_div, new_viewer_div)
    
    header_old = '<h2 id="chartTitle" class="text-xl font-bold">Select a trade from the table below to view the chart</h2>\n            <button onclick="document.getElementById(\'chartModal\').style.display=\'none\'" class="px-4 py-1 bg-slate-600 rounded hover:bg-slate-500 text-sm">Hide Chart</button>'
    header_new = '''
            <div class="flex items-center gap-4">
                <h2 id="chartTitle" class="text-xl font-bold">Trade Analysis Chart</h2>
                <select id="stockSelector" class="bg-slate-700 text-white rounded px-2 py-1" onchange="renderSelectedStock()"></select>
            </div>
    '''
    html = html.replace(header_old, header_new)
    
    new_js = '''
            const chartData = ''' + html[old_js_start:old_js_end].split('const chartData = ')[1].split(';\n')[0] + ''';
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
                    // Use exit date, but handle missing / TIME_STOP
                    let exitT = t.exitDate;
                    if(exitT && exitT.length > 0) {
                        markers.push({ time: exitT, position: 'aboveBar', color: isWin ? '#22c55e' : '#ef4444', shape: 'arrowDown', text: 'X' });
                    }
                });
                
                // Sort markers by time
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
            
'''
    html = html[:old_js_start] + new_js + '\n            ' + html[old_js_end:]
    
    with open('E:\\github\\ohlcv\\output\\omega_backtest_report.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("Fixed script and initialized chart viewer!")
else:
    print("Could not find old JS block")
