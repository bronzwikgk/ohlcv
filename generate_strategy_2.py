import pandas as pd
import numpy as np
import os
import glob
import json

DATA_DIR = r'D:\\0dot1_Aug_2016_master\\data\\mstock_mtf_daily_data'
OUTPUT_HTML = r'output/strategy_2_report.html'
START_DATE = '2021-01-01'
END_DATE = '2022-12-31'
NUM_STOCKS_TO_TEST = 25
YEARS_TESTED = 2.0

# --- INDICATOR MATH ---
def calc_atr_and_adx(df, period=14):
    high = df['High']
    low = df['Low']
    close = df['Close']
    
    tr1 = high - low
    tr2 = (high - close.shift()).abs()
    tr3 = (low - close.shift()).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    df['ATR_14'] = tr.rolling(period).mean()
    df['ATR_Pct'] = (df['ATR_14'] / close) * 100
    
    up_move = high - high.shift()
    down_move = low.shift() - low
    
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0)
    
    plus_dm = pd.Series(plus_dm, index=df.index).ewm(alpha=1/period, adjust=False).mean()
    minus_dm = pd.Series(minus_dm, index=df.index).ewm(alpha=1/period, adjust=False).mean()
    tr_smooth = tr.ewm(alpha=1/period, adjust=False).mean()
    
    plus_di = 100 * (plus_dm / tr_smooth)
    minus_di = 100 * (minus_dm / tr_smooth)
    
    dx = 100 * (abs(plus_di - minus_di) / (plus_di + minus_di))
    df['ADX_14'] = dx.ewm(alpha=1/period, adjust=False).mean()
    return df

def calc_omega_pr(series, period, lookback=200):
    daily_returns = series.pct_change()
    def get_omega(ret_window):
        gains = ret_window[ret_window > 0].sum()
        losses = abs(ret_window[ret_window < 0].sum())
        if losses == 0: 
            return gains / 0.0001 if gains > 0 else 1.0
        return gains / losses
    rolling_omega = daily_returns.rolling(period).apply(get_omega, raw=False)
    pr = rolling_omega.rolling(lookback).apply(lambda x: pd.Series(x).rank(pct=True).iloc[-1] * 100, raw=False)
    return pr

def calculate_all_indicators(df):
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    df['EMA_20'] = df['Close'].ewm(span=20, adjust=False).mean()
    df['EMA_20_Slope'] = df['EMA_20'].diff()
    df = calc_atr_and_adx(df)
    
    df['Omega_20_PR'] = calc_omega_pr(df['Close'], period=20, lookback=200)
    df['Omega_5_PR'] = calc_omega_pr(df['Close'], period=5, lookback=200)
    
    df['Omega5_was_below_50'] = df['Omega_5_PR'].shift(1) < 50
    df['Omega5_was_below_25'] = df['Omega_5_PR'].shift(1) < 25
    
    return df.dropna().reset_index(drop=True)

# --- BACKTEST ENGINE ---
def backtest_strategy_2(df, symbol):
    df = df[(df['Date'] >= pd.to_datetime(START_DATE)) & (df['Date'] <= pd.to_datetime(END_DATE))].reset_index(drop=True)
    if len(df) == 0: return None
    
    # if not (90 <= df.iloc[0]['Close'] <= 600):
    #     return None
        
    trades = []
    trade_markers = []
    in_trade = False
    
    entry_price = 0
    entry_date = None
    days_held = 0
    stop_loss = 0
    target_price = 0
    lowest_price = float('inf')
    
    for i in range(1, len(df)):
        row = df.iloc[i]
        
        if in_trade:
            days_held += 1
            exit_triggered = False
            exit_reason = ""
            exit_price = 0
            
            lowest_price = min(lowest_price, row['Low'])
            
            if row['Close'] >= target_price:
                exit_triggered = True
                exit_reason = "Take Profit (+5%)"
                exit_price = row['Close']
            elif row['Close'] <= stop_loss:
                exit_triggered = True
                exit_reason = "Stop Loss (-1.5 ATR)"
                exit_price = row['Close']
            elif days_held >= 13:
                exit_triggered = True
                exit_reason = "Time Stop (13 Days)"
                exit_price = row['Close']
                
            if exit_triggered:
                drawdown = (lowest_price - entry_price) / entry_price * 100 if lowest_price < entry_price else 0
                gross_return = (exit_price - entry_price) / entry_price * 100
                net_return = gross_return - 0.24
                
                trades.append({
                    'Symbol': symbol,
                    'Entry_Date': entry_date,
                    'Entry_Price': entry_price,
                    'Exit_Date': row['Date'].strftime('%Y-%m-%d'),
                    'Exit_Price': exit_price,
                    'Return': net_return,
                    'Drawdown': drawdown,
                    'Reason': exit_reason,
                    'Entry_Reason': entry_reason,
                    'Is_Shadow': is_shadow,
                    'Shadow_Reason': shadow_reason,
                    'Days_Held': days_held
                })
                
                if not is_shadow:
                    trade_markers.append({
                        'time': row['Date'].strftime('%Y-%m-%d'),
                        'position': 'aboveBar',
                        'color': '#10b981' if net_return > 0 else '#ef4444',
                        'shape': 'arrowDown',
                        'text': f'Win ({net_return:.1f}%)' if net_return > 0 else f'Loss ({net_return:.1f}%)'
                    })
                
                in_trade = False
                days_held = 0
                
        if not in_trade:
            regime = (row['Omega_20_PR'] > 50) and (row['EMA_20_Slope'] > 0)
            
            avoid_adx = row['ADX_14'] < 15
            
            if regime:
                trigger1 = row['Omega5_was_below_50'] and (row['Omega_5_PR'] > 50)
                
                if trigger1:
                    in_trade = True
                    is_shadow = False
                    shadow_reason = ""
                    
                    if avoid_adx:
                        is_shadow = True
                        shadow_reason = "Avoid ADX < 15"
                        
                    entry_reason = "Omega 5 crosses 50"
                    
                    entry_price = row['Close']
                    entry_date = row['Date'].strftime('%Y-%m-%d')
                    days_held = 0
                    lowest_price = row['Low']
                    target_price = entry_price * 1.05
                    stop_loss = entry_price - (1.5 * row['ATR_14'])
                    
                    if not is_shadow:
                        trade_markers.append({
                            'time': row['Date'].strftime('%Y-%m-%d'),
                            'position': 'belowBar',
                            'color': '#10b981',
                            'shape': 'arrowUp',
                            'text': 'Buy'
                        })

    # Prepare TV data for all stocks regardless of trades
    df['time_str'] = df['Date'].dt.strftime('%Y-%m-%d')
    
    ohlc = df[['time_str', 'Open', 'High', 'Low', 'Close']].rename(columns={'time_str':'time','Open':'open','High':'high','Low':'low','Close':'close'}).to_dict(orient='records')
    ema = df[['time_str', 'EMA_20']].rename(columns={'time_str':'time','EMA_20':'value'}).dropna().to_dict(orient='records')
    omega5 = df[['time_str', 'Omega_5_PR']].rename(columns={'time_str':'time','Omega_5_PR':'value'}).dropna().to_dict(orient='records')
    omega20 = df[['time_str', 'Omega_20_PR']].rename(columns={'time_str':'time','Omega_20_PR':'value'}).dropna().to_dict(orient='records')
    adx = df[['time_str', 'ADX_14']].rename(columns={'time_str':'time','ADX_14':'value'}).dropna().to_dict(orient='records')
    atr = df[['time_str', 'ATR_Pct']].rename(columns={'time_str':'time','ATR_Pct':'value'}).dropna().to_dict(orient='records')
    
    tv_data = {
        'symbol': symbol,
        'ohlc': ohlc,
        'ema': ema,
        'omega5': omega5,
        'omega20': omega20,
        'adx': adx,
        'atr': atr,
        'markers': trade_markers
    }
    
    return {'trades': trades, 'tv_data': tv_data}

# --- HTML REPORT GENERATOR ---
def generate_html_report(all_trades, all_tv_data, num_stocks):
    trades_df_all = pd.DataFrame(all_trades)
    trades_df = trades_df_all[trades_df_all['Is_Shadow'] == False]
    shadow_df = trades_df_all[trades_df_all['Is_Shadow'] == True]
    
    total_trades = len(trades_df)
    if total_trades > 0:
        wins = trades_df[trades_df['Return'] > 0]
        win_rate = len(wins) / total_trades * 100
        avg_return = trades_df['Return'].mean()
        avg_loss = trades_df[trades_df['Return'] <= 0]['Return'].mean() if len(trades_df[trades_df['Return'] <= 0]) > 0 else 0
        avg_drawdown = trades_df['Drawdown'].mean()
        median_drawdown = trades_df['Drawdown'].median()
        max_drawdown = trades_df['Drawdown'].min()
        
        trades_per_year = total_trades / YEARS_TESTED
        avg_trades_stock_yr = trades_per_year / num_stocks if num_stocks > 0 else 0
        
        reasons = trades_df['Reason'].value_counts()
        tp_pct = (reasons.get("Take Profit (+5%)", 0) / total_trades) * 100
        sl_pct = (reasons.get("Stop Loss (-1.5 ATR)", 0) / total_trades) * 100
        ts_pct = (reasons.get("Time Stop (13 Days)", 0) / total_trades) * 100
    else:
        win_rate = avg_return = avg_loss = tp_pct = sl_pct = ts_pct = 0
        avg_drawdown = median_drawdown = max_drawdown = avg_trades_stock_yr = 0
        
        
    # Prepare attribution data
    entry_html = ""
    if total_trades > 0:
        for entry_val, group in trades_df.groupby('Entry_Reason'):
            wr = len(group[group['Return'] > 0]) / len(group) * 100
            ar = group['Return'].mean()
            entry_html += f"<li class='text-sm mb-1'><b>{entry_val}:</b> {len(group)} Trades | Win: {wr:.1f}% | Avg: {ar:.2f}%</li>"
            
    exit_html = ""
    if total_trades > 0:
        for exit_val, group in trades_df.groupby('Reason'):
            wr = len(group[group['Return'] > 0]) / len(group) * 100
            ar = group['Return'].mean()
            exit_html += f"<li class='text-sm mb-1'><b>{exit_val}:</b> {len(group)} Trades | Win: {wr:.1f}% | Avg: {ar:.2f}%</li>"
            
    shadow_html = ""
    if len(shadow_df) > 0:
        for shadow_val, group in shadow_df.groupby('Shadow_Reason'):
            wr = len(group[group['Return'] > 0]) / len(group) * 100
            ar = group['Return'].mean()
            shadow_html += f"<li class='text-sm mb-1 text-gray-500'><b>Blocked by {shadow_val}:</b> {len(group)} Trades (Would be Win: {wr:.1f}%, Avg: {ar:.2f}%)</li>"
    
    # Serialize TV data to insert into script
    tv_data_json = json.dumps(all_tv_data)
    
    html = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Strategy 2 Trade Report</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <!-- Use the local Lightweight Charts library -->
        <script src="../library/lightweight-charts.standalone.production.js"></script>
        <style>
            .Take.Profit {{ background-color: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 999px; font-size: 0.875rem; }}
            .Stop.Loss {{ background-color: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 999px; font-size: 0.875rem; }}
            .Time.Stop {{ background-color: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 999px; font-size: 0.875rem; }}
            table td, table th {{ padding: 12px 16px; text-align: left; vertical-align: middle; }}
            tbody tr:hover {{ background-color: #f9fafb; }}
            th {{ background-color: #f3f4f6; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; color: #6b7280; }}
            td {{ white-space: nowrap; }}
            details > summary {{ list-style: none; cursor: pointer; }}
            details > summary::-webkit-details-marker {{ display: none; }}
            details[open] summary svg {{ transform: rotate(180deg); }}
            .tv-chart-container {{ width: 100%; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }}
            .chart-price {{ height: 400px; }}
            .chart-pane {{ height: 160px; }}
        </style>
    </head>
    <body class="bg-gray-50 p-8 font-sans text-gray-800">
        <div class="max-w-7xl mx-auto">
            <h1 class="text-4xl font-extrabold mb-2 text-gray-900">Top-Down Omega (Strategy 2)</h1>
            <p class="text-gray-500 mb-6">
                <b>Period:</b> Jan 2021 - Dec 2022 (2 Years) | 
                <b>Stocks Tested:</b> {num_stocks} | 
                <b>Price Filter:</b> ₹90 - ₹600 | 
                <b>Fees:</b> 0.24% Round-Trip
            </p>
            
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8 text-sm">
                <h2 class="font-bold text-gray-800 mb-2">Strategy Rules</h2>
                <ul class="list-disc pl-5 text-gray-600 space-y-1">
                    <li><b>Regime Filter:</b> Omega(20) PR &gt; 50 <span class="text-gray-400">AND</span> EMA 20 Slope &gt; 0</li>
                    <li><b>Avoid Filter:</b> ADX(14) &lt; 15</li>
                    <li><b>Entry Trigger:</b> Omega(5) PR crosses above 50</li>
                    <li><b>Exits:</b> Take Profit (+5%) <span class="text-gray-400">OR</span> Stop Loss (-1.5 ATR) <span class="text-gray-400">OR</span> Time Stop (13 Days)</li>
                </ul>
                
                <h2 class="font-bold text-gray-800 mt-6 mb-2">Rule Attribution</h2>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <h3 class="font-semibold text-gray-700 border-b pb-1 mb-2">Entry Triggers</h3>
                        <ul class="list-none text-gray-600">{entry_html}</ul>
                    </div>
                    <div>
                        <h3 class="font-semibold text-gray-700 border-b pb-1 mb-2">Exit Triggers</h3>
                        <ul class="list-none text-gray-600">{exit_html}</ul>
                    </div>
                    <div>
                        <h3 class="font-semibold text-gray-700 border-b pb-1 mb-2">Shadow Trades (Avoid Filters)</h3>
                        <ul class="list-none text-gray-600">{shadow_html}</ul>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Total Trades</h3>
                    <p class="text-2xl font-bold text-indigo-600">{total_trades}</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Win Rate</h3>
                    <p class="text-2xl font-bold text-emerald-500">{win_rate:.1f}%</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Avg Net Return</h3>
                    <p class="text-2xl font-bold text-blue-500">{avg_return:.2f}%</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Avg Loss</h3>
                    <p class="text-2xl font-bold text-red-500">{avg_loss:.2f}%</p>
                </div>

                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Target Hits (+5%)</h3>
                    <p class="text-2xl font-bold text-emerald-600">{tp_pct:.1f}%</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Stop Loss Hits</h3>
                    <p class="text-2xl font-bold text-red-500">{sl_pct:.1f}%</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Time Stop Exits</h3>
                    <p class="text-2xl font-bold text-orange-500">{ts_pct:.1f}%</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Avg Trades/Stock/Yr</h3>
                    <p class="text-2xl font-bold text-gray-700">{avg_trades_stock_yr:.2f}</p>
                </div>

                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Avg Drawdown</h3>
                    <p class="text-2xl font-bold text-gray-600">{avg_drawdown:.2f}%</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Median Drawdown</h3>
                    <p class="text-2xl font-bold text-gray-600">{median_drawdown:.2f}%</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h3 class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Max Drawdown</h3>
                    <p class="text-2xl font-bold text-red-600">{max_drawdown:.2f}%</p>
                </div>
            </div>

            <h2 class="text-xl font-bold text-gray-800 mb-4">Stock-by-Stock Interactive Charts</h2>
            <div id="accordions-container"></div>
        </div>

        <script>
            // TV Data injected from Python
            const stockData = {tv_data_json};
            
            // Build the accordions and trades table
            const container = document.getElementById('accordions-container');
            
            // Group trades by symbol for the tables
            const allTrades = {json.dumps(all_trades)};
            const tradesBySymbol = {{}};
            allTrades.forEach(t => {{
                if (!tradesBySymbol[t.Symbol]) tradesBySymbol[t.Symbol] = [];
                tradesBySymbol[t.Symbol].push(t);
            }});
            
            stockData.forEach((data, index) => {{
                const symbol = data.symbol;
                const trades = tradesBySymbol[symbol] || [];
                
                // Build the Trade Table HTML
                let tableRows = trades.map(t => {{
                    let retColor = t.Return > 0 ? "text-emerald-600" : "text-red-600";
                    let ddColor = t.Drawdown < -2 ? "text-red-500" : "text-gray-600";
                    let reasonClass = t.Reason.includes("Take Profit") ? "Take Profit" : (t.Reason.includes("Stop") && !t.Reason.includes("Time") ? "Stop Loss" : "Time Stop");
                    
                    return `
                        <tr>
                            <td class="text-gray-600">${{t.Entry_Date}}</td>
                            <td class="text-gray-900">₹${{t.Entry_Price.toFixed(2)}}</td>
                            <td class="text-gray-600">${{t.Exit_Date}}</td>
                            <td class="text-gray-900">₹${{t.Exit_Price.toFixed(2)}}</td>
                            <td class="font-bold ${{retColor}}">${{t.Return.toFixed(2)}}%</td>
                            <td class="${{ddColor}}">${{t.Drawdown.toFixed(2)}}%</td>
                            <td><span class="${{reasonClass.replace(' ', '.')}}">${{reasonClass}}</span></td>
                        </tr>
                    `;
                }}).join('');
                
                const html = `
                <details class="group bg-white rounded-xl shadow-sm border border-gray-100 mb-4 overflow-hidden" id="details-${{symbol}}">
                    <summary class="flex justify-between items-center font-medium cursor-pointer list-none px-6 py-4 hover:bg-gray-50" onclick="renderChart('${{symbol}}')">
                        <span class="text-lg font-bold text-indigo-600">${{symbol}} <span class="text-sm font-normal text-gray-500 ml-2">(${{trades.length}} Trades)</span></span>
                        <span class="transition group-open:rotate-180">
                            <svg fill="none" height="24" shape-rendering="geometricPrecision" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 24 24" width="24"><path d="M6 9l6 6 6-6"></path></svg>
                        </span>
                    </summary>
                    <div class="px-6 pb-6 pt-2 border-t border-gray-100">
                        <div id="chart-price-${{symbol}}" class="tv-chart-container chart-price"></div>
                        <div id="chart-omega-${{symbol}}" class="tv-chart-container chart-pane"></div>
                        <div id="chart-adx-${{symbol}}" class="tv-chart-container chart-pane mb-6"></div>
                        
                        <div class="overflow-x-auto rounded-lg border border-gray-200">
                            <table class="min-w-full divide-y divide-gray-200">
                                <thead>
                                    <tr style="text-align: right;">
                                        <th>Entry Date</th>
                                        <th>Entry Price</th>
                                        <th>Exit Date</th>
                                        <th>Exit Price</th>
                                        <th>Return</th>
                                        <th>Drawdown</th>
                                        <th>Reason</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${{tableRows}}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </details>
                `;
                
                container.innerHTML += html;
            }});

            const renderedCharts = new Set();

            function renderChart(symbol) {{
                // Only render once per symbol
                if (renderedCharts.has(symbol)) return;
                renderedCharts.add(symbol);
                
                // Find data
                const data = stockData.find(s => s.symbol === symbol);
                if (!data) return;
                
                // Wait for DOM to expand
                setTimeout(() => {{
                    const commonOptions = {{ 
                        layout: {{ textColor: 'black', background: {{ type: 'solid', color: 'white' }} }},
                        rightPriceScale: {{ scaleMargins: {{ top: 0.1, bottom: 0.1 }} }},
                        grid: {{ vertLines: {{ color: '#f3f4f6' }}, horzLines: {{ color: '#f3f4f6' }} }},
                        crosshair: {{ mode: LightweightCharts.CrosshairMode.Normal }}
                    }};
                    
                    // 1. PRICE PANE
                    const chartPrice = LightweightCharts.createChart(document.getElementById(`chart-price-${{symbol}}`), {{
                        ...commonOptions,
                        timeScale: {{ timeVisible: true, borderColor: '#D1D5DB' }}
                    }});
                    
                    const mainSeries = chartPrice.addSeries(LightweightCharts.LineSeries, {{
                        color: '#111827', lineWidth: 2, title: 'Close Price'
                    }});
                    const lineData = data.ohlc.map(d => ({{ time: d.time, value: d.close }}));
                    mainSeries.setData(lineData);
                    
                    const emaSeries = chartPrice.addSeries(LightweightCharts.LineSeries, {{ color: '#3b82f6', lineWidth: 1, title: 'EMA 20' }});
                    emaSeries.setData(data.ema);
                    
                    // 2. OMEGA PANE
                    const chartOmega = LightweightCharts.createChart(document.getElementById(`chart-omega-${{symbol}}`), {{
                        ...commonOptions,
                        timeScale: {{ timeVisible: true, borderColor: '#D1D5DB' }}
                    }});
                    
                    const omegaSeries5 = chartOmega.addSeries(LightweightCharts.LineSeries, {{ color: '#f59e0b', lineWidth: 2, title: 'Omega 5 PR' }});
                    const omegaSeries20 = chartOmega.addSeries(LightweightCharts.LineSeries, {{ color: '#8b5cf6', lineWidth: 1, title: 'Omega 20 PR' }});
                    
                    omegaSeries5.createPriceLine({{ price: 50, color: '#9ca3af', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '50' }});
                    omegaSeries5.createPriceLine({{ price: 25, color: '#ef4444', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '25' }});
                    
                    omegaSeries5.setData(data.omega5);
                    omegaSeries20.setData(data.omega20);
                    
                    // 3. ADX & ATR PANE
                    const chartADX = LightweightCharts.createChart(document.getElementById(`chart-adx-${{symbol}}`), {{
                        ...commonOptions,
                        timeScale: {{ timeVisible: true, borderColor: '#D1D5DB' }}
                    }});
                    
                    const adxSeries = chartADX.addSeries(LightweightCharts.LineSeries, {{ color: '#ef4444', lineWidth: 2, title: 'ADX(14)' }});
                    const atrSeries = chartADX.addSeries(LightweightCharts.LineSeries, {{ color: '#64748b', lineWidth: 1, title: 'ATR%' }});
                    
                    adxSeries.createPriceLine({{ price: 15, color: '#9ca3af', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Avoid < 15' }});
                    atrSeries.createPriceLine({{ price: 5, color: '#9ca3af', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'Avoid > 5%' }});
                    
                    adxSeries.setData(data.adx);
                    atrSeries.setData(data.atr);
                    
                    if (data.markers && data.markers.length > 0) {{
                        LightweightCharts.createSeriesMarkers(mainSeries, data.markers);
                        LightweightCharts.createSeriesMarkers(omegaSeries5, data.markers);
                        LightweightCharts.createSeriesMarkers(adxSeries, data.markers);
                    }}
                    
                    // SYNCHRONIZE TIME SCALES
                    const t1 = chartPrice.timeScale();
                    const t2 = chartOmega.timeScale();
                    const t3 = chartADX.timeScale();
                    
                    function syncPanes(sourceRange) {{
                        if (!sourceRange) return;
                        t1.setVisibleRange(sourceRange);
                        t2.setVisibleRange(sourceRange);
                        t3.setVisibleRange(sourceRange);
                    }}
                    
                    t1.subscribeVisibleTimeRangeChange(syncPanes);
                    t2.subscribeVisibleTimeRangeChange(syncPanes);
                    t3.subscribeVisibleTimeRangeChange(syncPanes);
                    
                    t1.fitContent();
                    
                }}, 100);
            }}
        </script>
    </body>
    </html>
    """
    
    os.makedirs('output', exist_ok=True)
    with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"\\nReport generated successfully: {OUTPUT_HTML}")

# --- MAIN EXECUTION ---
print("Starting Strategy 2 Backtest...")
all_trades = []
all_tv_data = []

etf_list_path = r'E:\github\ohlcv\data_list\etfs.txt'
if os.path.exists(etf_list_path):
    with open(etf_list_path, 'r') as f:
        etf_symbols = [line.strip() for line in f if line.strip()]
    files = [os.path.join(DATA_DIR, f"{sym}.csv") for sym in etf_symbols]
    NUM_STOCKS_TO_TEST = len(files)
else:
    files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))

processed = 0

for file in files:
    if processed >= NUM_STOCKS_TO_TEST:
        break
        
    symbol = os.path.basename(file).split('.')[0]
    df = pd.read_csv(file)
    if len(df) < 250: continue
    
    try:
        df_indicators = calculate_all_indicators(df)
        result = backtest_strategy_2(df_indicators, symbol)
        
        if result is not None:
            all_trades.extend(result['trades'])
            all_tv_data.append(result['tv_data'])
            
        processed += 1
        print(f"Processed [{processed}/{NUM_STOCKS_TO_TEST}]: {symbol} | Trades found: {len(result['trades']) if result else 0}")
        
    except Exception as e:
        print(f"Error processing {symbol}: {e}")

if len(all_trades) > 0:
    generate_html_report(all_trades, all_tv_data, processed)
else:
    print("No valid trades found for the sample.")
