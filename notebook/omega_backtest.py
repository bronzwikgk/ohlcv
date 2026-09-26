#!/usr/bin/env python
# coding: utf-8

# # Omega Threshold Backtester
# **Goal:** 
# To backtest a highly specific entry/exit strategy across our historical dataset:
# 1. **Regime Filter:** Omega 13 > 50
# 2. **Entry Trigger:** Omega 5 crosses above 50 (was <= 50 yesterday, > 50 today).
# 3. **Exit (Win):** Target (+5%) is achieved within the **real body** of the candle (`max(Open, Close) >= Target`).
# 4. **Exit (Time Stop):** If 13 days pass without hitting the target, exit at the Close of Day 13.
# 

# In[1]:


import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os, glob

# 1. Omega Function
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

def calc_rsi(series, period=14):
    delta = series.diff()
    up = delta.clip(lower=0)
    down = -1 * delta.clip(upper=0)
    ema_up = up.ewm(com=period-1, adjust=False).mean()
    ema_down = down.ewm(com=period-1, adjust=False).mean()
    rs = ema_up / ema_down
    return 100 - (100 / (1 + rs))

import random
import json
all_chart_data = {}


# 2. Configuration
TARGET_PCT = 5.0
STOP_LOSS_PCT = 4.0
TIME_STOP_DAYS = 8
DATA_DIR = r'D:\0dot1_Aug_2016_master\data\mstock_mtf_daily_data'
all_files_raw = glob.glob(os.path.join(DATA_DIR, '*.csv'))
random.seed(84)
all_files = random.sample(all_files_raw, 50) if len(all_files_raw) >= 50 else all_files_raw

def calc_dynamic_supertrend(df, target_days=13):
    dyn_period = max(3, int(target_days / 3))
    
    df['Std_Dev'] = df['Close'].rolling(window=dyn_period).std()
    df['Vol_Pct'] = (df['Std_Dev'] / df['Close']) * 100
    df['Dyn_Multiplier'] = 1.5 + df['Vol_Pct'].fillna(0)
    
    df['Prev_Close'] = df['Close'].shift(1)
    tr1 = df['High'] - df['Low']
    tr2 = (df['High'] - df['Prev_Close']).abs()
    tr3 = (df['Low'] - df['Prev_Close']).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    df['ATR_Dyn'] = tr.rolling(window=dyn_period).mean()
    
    basic_ub = ((df['High'] + df['Low']) / 2) + (df['Dyn_Multiplier'] * df['ATR_Dyn'])
    basic_lb = ((df['High'] + df['Low']) / 2) - (df['Dyn_Multiplier'] * df['ATR_Dyn'])
    
    final_ub = np.zeros(len(df))
    final_lb = np.zeros(len(df))
    trend = np.ones(len(df))
    
    for i in range(dyn_period, len(df)):
        if basic_ub.iloc[i] < final_ub[i-1] or df['Close'].iloc[i-1] > final_ub[i-1]:
            final_ub[i] = basic_ub.iloc[i]
        else:
            final_ub[i] = final_ub[i-1]

        if basic_lb.iloc[i] > final_lb[i-1] or df['Close'].iloc[i-1] < final_lb[i-1]:
            final_lb[i] = basic_lb.iloc[i]
        else:
            final_lb[i] = final_lb[i-1]

        if df['Close'].iloc[i] > final_ub[i-1]:
            trend[i] = 1
        elif df['Close'].iloc[i] < final_lb[i-1]:
            trend[i] = -1
        else:
            trend[i] = trend[i-1]
            
    df['SuperTrend'] = trend
    return df


WARMUP_DAYS = 100

trades = []

# 3. Execution Engine
for file_path in all_files:
    try:
        df = pd.read_csv(file_path)
        df['Date'] = pd.to_datetime(df['Date'])
        # We need Open and Close to check the body
        if 'Open' not in df.columns:
            # Fallback if raw data is weird, assume open=close
            df['Open'] = df['Close'] 

        # Calculate Omegas
        df['Omega_5'] = calc_omega_pr(df['Close'], 5)
        df['Omega_13'] = calc_omega_pr(df['Close'], 13)

        # Calculate Dynamic Supertrend
        df = calc_dynamic_supertrend(df, target_days=TIME_STOP_DAYS)
        df['RSI_14'] = calc_rsi(df['Close'], 14)

        # Filter to our backtest window (1 year)
        # Note: We calculated Omega on the whole history so the 200d lookback is valid
        mask = (df['Date'] >= '2023-01-01') & (df['Date'] <= '2023-12-31')
        test_df = df[mask].copy().reset_index(drop=True)

        # Store for charts
        if file_path not in all_chart_data:
            df_chart = test_df.copy()
            df_chart['Date'] = df_chart['Date'].dt.strftime('%Y-%m-%d')
            all_chart_data[os.path.basename(file_path).replace('.csv', '')] = df_chart[['Date', 'Open', 'High', 'Low', 'Close', 'Omega_13', 'Omega_5', 'RSI_14']].to_dict(orient='records')

        # Store original indices to extract chunks from the main df safely
        original_indices = df[mask].index.tolist()

        for i in range(1, len(test_df) - TIME_STOP_DAYS):
            # Check Trigger
            o13_today = test_df.iloc[i]['Omega_13']
            o5_today = test_df.iloc[i]['Omega_5']
            o5_yesterday = test_df.iloc[i-1]['Omega_5']
            st_today = test_df.iloc[i]['SuperTrend']

            if o13_today > 50 and o5_yesterday <= 50 and o5_today > 50 and st_today == 1:
                # WE HAVE A SIGNAL!
                orig_idx = original_indices[i]

                group = "Global Regime"

                entry_date = test_df.iloc[i]['Date']
                entry_price = test_df.iloc[i]['Close']
                target_price = entry_price * (1 + (TARGET_PCT / 100))
                stop_price = entry_price * (1 - (STOP_LOSS_PCT / 100))

                # Fast forward to simulate trade execution
                trade_result = 'TIME_STOP'
                exit_price = 0
                exit_date = None
                days_held = 0
                hold_prices = [entry_price]
                min_hold_price = entry_price

                for j in range(1, TIME_STOP_DAYS + 1):
                    day_idx = i + j
                    candle = test_df.iloc[day_idx]
                    hold_prices.append(candle['Close'])
                    if candle['Low'] < min_hold_price: min_hold_price = candle['Low']

                    # Rule 1: Stop Loss
                    if candle['Low'] <= stop_price:
                        trade_result = 'STOP_LOSS'
                        exit_price = stop_price
                        exit_date = candle['Date']
                        days_held = j
                        break

                    # Rule 2: Target achieved in Open/Close Body
                    body_high = max(candle['Open'], candle['Close'])
                    if body_high >= target_price:
                        trade_result = 'WIN_TARGET'
                        exit_price = target_price # We filled at exactly the target
                        exit_date = candle['Date']
                        days_held = j
                        break

                # If we never hit target or stop, Time Stop at close of day 13
                if trade_result == 'TIME_STOP':
                    exit_candle = test_df.iloc[i + TIME_STOP_DAYS]
                    exit_price = exit_candle['Close']
                    exit_date = exit_candle['Date']
                    days_held = TIME_STOP_DAYS

                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
                max_drawdown = ((min_hold_price - entry_price) / entry_price) * 100

                trades.append({
                    'Stock': os.path.basename(file_path).split('.')[0],
                    'Group': group,
                    'Entry_Date': entry_date,
                    'Entry_Price': entry_price,
                    'Exit_Date': exit_date,
                    'Exit_Price': exit_price,
                    'Result': trade_result,
                    'PnL_Pct': pnl_pct,
                    'Max_Drawdown_Pct': max_drawdown,
                    'Days_Held': days_held,
                    'Hold_Prices': hold_prices
                })
    except Exception as e:
        pass

df_trades = pd.DataFrame(trades)

# 4. Results Output
if len(df_trades) > 0:
    print("=" * 70)
    print("OMEGA STRATEGY RESULTS CLASSIFIED BY BEHAVIOURAL REGIME")
    print("=" * 70)

    # Calculate global metrics
    def calc_metrics(df_sub):
        t = len(df_sub)
        if t == 0: return {}
        wins = df_sub[df_sub['Result'] == 'WIN_TARGET']
        losses = df_sub[df_sub['Result'] != 'WIN_TARGET']
        return {
            'trades': t,
            'win_rate': (len(wins) / t) * 100,
            'avg_net': df_sub['PnL_Pct'].mean(),
            'avg_loss': losses['PnL_Pct'].mean() if len(losses) > 0 else 0,
            'target_hits': (len(wins) / t) * 100,
            'stop_hits': (len(df_sub[df_sub['Result'] == 'STOP_LOSS']) / t) * 100,
            'time_stops': (len(df_sub[df_sub['Result'] == 'TIME_STOP']) / t) * 100,
            'avg_dur_wins': wins['Days_Held'].mean() if len(wins) > 0 else 0,
            'avg_dur_loss': losses['Days_Held'].mean() if len(losses) > 0 else 0,
            'avg_trades_yr': t / (150 * 6) if len(df_sub) == len(df_trades) else t / 6, # 6 years
            'avg_dd': df_sub['Max_Drawdown_Pct'].mean(),
            'med_dd': df_sub['Max_Drawdown_Pct'].median(),
            'max_dd': df_sub['Max_Drawdown_Pct'].min(),
            'return_pa': df_sub['PnL_Pct'].sum() / (df_sub['Stock'].nunique() * 6) if len(df_sub) > 0 else 0
        }

    gm = calc_metrics(df_trades)

    html_out = f'''
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Omega Entry Strategy Report</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            body {{ background-color: #f8fafc; color: #1e293b; font-family: 'Inter', sans-serif; }}
            summary {{ cursor: pointer; list-style: none; }}
            summary::-webkit-details-marker {{ display: none; }}
            .metric-card {{ background: #ffffff; padding: 1rem; border-radius: 0.5rem; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }}
            .metric-label {{ color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 0.25rem; }}
            .metric-value {{ font-size: 1.5rem; font-weight: 700; color: #0f172a; }}
        </style>
        <script src="../library/lightweight-charts.standalone.production.js"></script>
</head>
    <body class="p-8">
        
    <!-- Chart Modal -->
    <div id="chartModal" class="hidden fixed inset-0 bg-black/80 z-50 p-4 flex flex-col">
        <div class="flex justify-between items-center mb-2 bg-slate-800 p-2 rounded text-white">
            <h2 id="chartTitle" class="text-xl font-bold">Chart</h2>
            <button onclick="document.getElementById('chartModal').classList.add('hidden')" class="px-4 py-1 bg-red-500 rounded hover:bg-red-600">Close</button>
        </div>
        <div id="chartContainer" class="flex-1 w-full bg-slate-900 rounded relative flex flex-col">
            <div id="pane1" class="flex-[3] w-full border-b border-slate-700"></div>
            <div id="pane2" class="flex-1 w-full border-b border-slate-700"></div>
            <div id="pane3" class="flex-1 w-full border-b border-slate-700"></div>
            <div id="pane4" class="flex-1 w-full"></div>
        </div>
    </div>

        <div class="max-w-7xl mx-auto">
            <h1 class="text-4xl font-extrabold mb-2 text-blue-600">Omega Backtest Report</h1>
            <p class="text-slate-500 mb-8">Regime: Behavioural Classifier | Entry: Omega 13 > 50 & Omega 5 Cross > 50 | Exit: 5% Body Target, 4% Stop Loss, 8-Day Time Stop</p>

            <h2 class="text-2xl font-bold mb-4 text-slate-800">Global Strategy Performance</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-10">
                <div class="metric-card"><div class="metric-label">Total Trades</div><div class="metric-value">{gm['trades']}</div></div>
                <div class="metric-card"><div class="metric-label">Win Rate</div><div class="metric-value text-emerald-600">{gm['win_rate']:.1f}%</div></div>
                <div class="metric-card"><div class="metric-label">Avg Net Return</div><div class="metric-value">{gm['avg_net']:.2f}%</div></div>
                <div class="metric-card"><div class="metric-label">Avg Loss</div><div class="metric-value text-rose-600">{gm['avg_loss']:.2f}%</div></div>
                <div class="metric-card"><div class="metric-label">Return Per Annum</div><div class="metric-value text-blue-600">+{gm['return_pa']:.1f}%</div></div>
                <div class="metric-card"><div class="metric-label">Avg Trades/Stock/Yr</div><div class="metric-value">{gm['avg_trades_yr']:.2f}</div></div>

                <div class="metric-card"><div class="metric-label">Target Hits (+5%)</div><div class="metric-value text-emerald-600">{gm['target_hits']:.1f}%</div></div>
                <div class="metric-card"><div class="metric-label">Stop Hits</div><div class="metric-value text-rose-600">{gm['stop_hits']:.1f}%</div></div>
                <div class="metric-card"><div class="metric-label">Time Stop Exits</div><div class="metric-value text-yellow-600">{gm['time_stops']:.1f}%</div></div>
                <div class="metric-card"><div class="metric-label">Avg Dur (Wins)</div><div class="metric-value text-emerald-600">{gm['avg_dur_wins']:.1f}d</div></div>
                <div class="metric-card"><div class="metric-label">Avg Dur (Loss)</div><div class="metric-value text-rose-600">{gm['avg_dur_loss']:.1f}d</div></div>
                <div class="metric-card"><div class="metric-label">Avg Drawdown</div><div class="metric-value">{gm['avg_dd']:.2f}%</div></div>
                <div class="metric-card"><div class="metric-label">Max Drawdown</div><div class="metric-value text-rose-600">{gm['max_dd']:.2f}%</div></div>
            </div>

            <h2 class="text-2xl font-bold mb-4 text-slate-800">Performance by Behavioural Group</h2>
    '''

    for group in sorted(df_trades['Group'].unique()):
        group_df = df_trades[df_trades['Group'] == group]
        m = calc_metrics(group_df)

        # Color coding for groups
        border_color = "border-slate-300"
        title_color = "text-slate-800"
        if "HOLY_GRAIL" in group: border_color = "border-yellow-400"
        elif "AGGRESSIVE" in group: border_color = "border-rose-400"
        elif "SAFE" in group: border_color = "border-emerald-400"

        html_out += f'''
            <details class="mb-4 bg-white rounded-xl border {border_color} overflow-hidden shadow-sm" open>
                <summary class="p-6 bg-white hover:bg-slate-50 transition flex justify-between items-center">
                    <div>
                        <h2 class="text-xl font-bold {title_color}">{group}</h2>
                        <div class="flex gap-4 mt-2 text-sm text-slate-500">
                            <span>Trades: <b class="text-slate-800">{m['trades']}</b></span>
                            <span>Win Rate: <b class="text-emerald-600">{m['win_rate']:.1f}%</b></span>
                            <span>Avg Net: <b class="text-slate-800">{m['avg_net']:.2f}%</b></span>
                            <span>Return p.a.: <b class="text-blue-600">+{m['return_pa']:.1f}%</b></span>
                        </div>
                    </div>
                    <div class="text-slate-400">
                        <svg class="w-6 h-6 transform transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                </summary>

                <div class="p-6 border-t border-slate-200 bg-slate-50 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <div class="metric-card"><div class="metric-label">Target Hits</div><div class="metric-value text-emerald-600">{m['target_hits']:.1f}%</div></div>
                    <div class="metric-card"><div class="metric-label">Stop Hits</div><div class="metric-value text-rose-600">{m['stop_hits']:.1f}%</div></div>
                    <div class="metric-card"><div class="metric-label">Time Stops</div><div class="metric-value text-yellow-600">{m['time_stops']:.1f}%</div></div>
                    <div class="metric-card"><div class="metric-label">Avg Dur (Wins)</div><div class="metric-value text-emerald-600">{m['avg_dur_wins']:.1f}d</div></div>
                    <div class="metric-card"><div class="metric-label">Avg Dur (Loss)</div><div class="metric-value text-rose-600">{m['avg_dur_loss']:.1f}d</div></div>
                    <div class="metric-card"><div class="metric-label">Avg Drawdown</div><div class="metric-value">{m['avg_dd']:.2f}%</div></div>
                    <div class="metric-card"><div class="metric-label">Max Drawdown</div><div class="metric-value text-rose-600">{m['max_dd']:.2f}%</div></div>
                </div>

                <div class="px-6 pb-6 overflow-x-auto bg-slate-50">
                    <table class="w-full text-left text-sm text-slate-600">
                        <thead class="text-xs text-slate-500 uppercase bg-slate-200/50">
                            <tr>
                                <th class="px-4 py-3 rounded-tl-lg">Stock</th>
                                <th class="px-4 py-3">Entry Date</th>
                                <th class="px-4 py-3">Exit Date</th>
                                <th class="px-4 py-3">Result</th>
                                <th class="px-4 py-3 text-right">PnL %</th>
                                <th class="px-4 py-3 text-center">Days Held</th>
                                <th class="px-4 py-3 text-right">Max DD %</th>
                                <th class="px-4 py-3">Trade Sparkline</th>
                                <th class="px-4 py-3 rounded-tr-lg">Action</th>
                            </tr>
                        </thead>
                        <tbody>
        '''

        for _, row in group_df.iterrows():
            res_color = "text-emerald-600 font-bold" if row['Result'] == 'WIN_TARGET' else "text-rose-600"
            pnl_color = "text-emerald-600" if row['PnL_Pct'] > 0 else "text-rose-600"
            prices_json = f"[{','.join([str(x) for x in row['Hold_Prices']])}]"

            html_out += f'''
                            <tr class="border-b border-slate-200 hover:bg-white transition">
                                <td class="px-4 py-3 font-medium text-slate-800">{row['Stock']}</td>
                                <td class="px-4 py-3">{row['Entry_Date'].strftime('%Y-%m-%d')}</td>
                                <td class="px-4 py-3">{row['Exit_Date'].strftime('%Y-%m-%d')}</td>
                                <td class="px-4 py-3 {res_color}">{row['Result'].replace('_', ' ')}</td>
                                <td class="px-4 py-3 text-right font-mono {pnl_color}">{row['PnL_Pct']:.2f}%</td>
                                <td class="px-4 py-3 text-center font-mono">{row['Days_Held']}d</td>
                                <td class="px-4 py-3 text-right font-mono text-rose-600">{row['Max_Drawdown_Pct']:.2f}%</td>
                                <td class="px-4 py-3">
                                    <canvas width="120" height="30" data-prices="{prices_json}"></canvas>
                                </td>
                                <td class="px-4 py-3">
                                    <button onclick='openChart("{row["Stock"]}", "{row["Entry_Date"].strftime("%Y-%m-%d")}", "{row["Exit_Date"].strftime("%Y-%m-%d")}", "{row["Result"]}")' class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200">View</button>
                                </td>
                            </tr>
            '''

        html_out += '''
                        </tbody>
                    </table>
                </div>
            </details>
        '''

    html_out += '''
        </div>
        <script>

            const chartData = ''' + json.dumps(all_chart_data) + ''';
            let chart1, chart2, chart3, chart4;
            
            function openChart(stock, entryDate, exitDate, result) {
                document.getElementById('chartModal').classList.remove('hidden');
                document.getElementById('chartTitle').innerText = `${stock} Trade (${entryDate} to ${exitDate}) - ${result}`;
                
                const data = chartData[stock];
                if (!data) return;
                
                const c1 = document.getElementById('pane1');
                const c2 = document.getElementById('pane2');
                const c3 = document.getElementById('pane3');
                const c4 = document.getElementById('pane4');
                
                c1.innerHTML = ''; c2.innerHTML = ''; c3.innerHTML = ''; c4.innerHTML = '';
                
                const chartOpts = { layout: { background: { color: '#0f172a' }, textColor: '#cbd5e1' }, grid: { vertLines: { color: '#334155' }, horzLines: { color: '#334155' } }, timeScale: { timeVisible: true } };
                chart1 = LightweightCharts.createChart(c1, chartOpts);
                chart2 = LightweightCharts.createChart(c2, chartOpts);
                chart3 = LightweightCharts.createChart(c3, chartOpts);
                chart4 = LightweightCharts.createChart(c4, chartOpts);
                
                const candleSeries = chart1.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' });
                const o13Series = chart2.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
                const o5Series = chart3.addLineSeries({ color: '#a855f7', lineWidth: 2 });
                const rsiSeries = chart4.addLineSeries({ color: '#f59e0b', lineWidth: 2 });
                
                const candles = data.map(d => ({ time: d.Date, open: d.Open, high: d.High, low: d.Low, close: d.Close }));
                candleSeries.setData(candles);
                o13Series.setData(data.map(d => ({ time: d.Date, value: d.Omega_13 })));
                o5Series.setData(data.map(d => ({ time: d.Date, value: d.Omega_5 })));
                rsiSeries.setData(data.map(d => ({ time: d.Date, value: d.RSI_14 })));
                
                // Markers
                const markers = [];
                const isWin = result.includes('WIN');
                markers.push({ time: entryDate, position: 'belowBar', color: isWin ? '#22c55e' : '#ef4444', shape: 'arrowUp', text: 'Entry' });
                markers.push({ time: exitDate, position: 'aboveBar', color: isWin ? '#22c55e' : '#ef4444', shape: 'arrowDown', text: 'Exit' });
                
                candleSeries.setMarkers(markers);
                o13Series.setMarkers(markers);
                o5Series.setMarkers(markers);
                rsiSeries.setMarkers(markers);
                
                // Sync charts
                const charts = [chart1, chart2, chart3, chart4];
                charts.forEach(c => {
                    c.timeScale().subscribeVisibleLogicalRangeChange(range => {
                        charts.forEach(other => { if (other !== c) other.timeScale().setVisibleLogicalRange(range); });
                    });
                });
                
                // Ensure proper sizing
                setTimeout(() => {
                    chart1.timeScale().fitContent();
                }, 100);
            }

            // Simple canvas sparkline drawer
            document.querySelectorAll('canvas[data-prices]').forEach(canvas => {
                const ctx = canvas.getContext('2d');
                const prices = JSON.parse(canvas.getAttribute('data-prices'));
                const w = canvas.width;
                const h = canvas.height;

                const minP = Math.min(...prices);
                const maxP = Math.max(...prices);
                const range = maxP - minP || 1;

                ctx.beginPath();
                ctx.strokeStyle = prices[prices.length-1] >= prices[0] ? '#059669' : '#e11d48'; // emerald-600 / rose-600
                ctx.lineWidth = 2;

                prices.forEach((p, i) => {
                    const x = (i / (prices.length - 1)) * w;
                    const y = h - (((p - minP) / range) * (h - 4)) - 2; // 2px padding
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });

                ctx.stroke();
            });

            // Details animation toggle
            document.querySelectorAll('details').forEach((el) => {
                const summary = el.querySelector('summary');
                const icon = summary.querySelector('svg');
                el.addEventListener('toggle', (e) => {
                    if(el.open) {
                        icon.classList.add('rotate-180');
                    } else {
                        icon.classList.remove('rotate-180');
                    }
                });
                // Initialize state
                if(el.open) icon.classList.add('rotate-180');
            });
            
            // Table sorting logic
            document.querySelectorAll('th').forEach(th => {
                th.style.cursor = 'pointer';
                th.title = 'Click to sort';
                
                th.addEventListener('click', () => {
                    const table = th.closest('table');
                    const tbody = table.querySelector('tbody');
                    const rows = Array.from(tbody.querySelectorAll('tr'));
                    const index = Array.from(th.parentNode.children).indexOf(th);
                    const isAscending = th.classList.contains('asc');
                    
                    // Reset all headers
                    table.querySelectorAll('th').forEach(h => {
                        h.classList.remove('asc', 'desc');
                        h.innerHTML = h.innerHTML.replace(' ↑', '').replace(' ↓', '');
                    });
                    
                    th.classList.toggle('asc', !isAscending);
                    th.classList.toggle('desc', isAscending);
                    th.innerHTML += isAscending ? ' ↓' : ' ↑';

                    rows.sort((a, b) => {
                        let valA = a.children[index].innerText.trim();
                        let valB = b.children[index].innerText.trim();
                        
                        // Parse as number if possible (remove % and d)
                        let numA = parseFloat(valA.replace(/[%d\\+,]/g, ''));
                        let numB = parseFloat(valB.replace(/[%d\\+,]/g, ''));
                        
                        if (!isNaN(numA) && !isNaN(numB)) {
                            return isAscending ? numB - numA : numA - numB;
                        }
                        
                        return isAscending ? valB.localeCompare(valA) : valA.localeCompare(valB);
                    });
                    
                    tbody.append(...rows);
                });
            });
        </script>
    </body>
    </html>
    '''

    with open('E:\\github\\ohlcv\\output\\omega_backtest_report.html', 'w', encoding='utf-8') as f:
        f.write(html_out)
    print("Report saved to E:\\github\\ohlcv\\output\\omega_backtest_report.html")

else:
    print("No trades triggered.")

