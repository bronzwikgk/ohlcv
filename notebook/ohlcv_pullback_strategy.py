#!/usr/bin/env python
# coding: utf-8

# # Micro-Pullback Strategy Backtester (Sample & Visualizer)
# # Testing on 5 Stocks over 6 months

# In[1]:


# 1. Imports and Setup
import pandas as pd
import numpy as np
import os
import glob
import matplotlib.pyplot as plt
import seaborn as sns
from IPython.display import display, HTML
import warnings
import base64
import io

warnings.filterwarnings('ignore')
display(HTML("<style>.container { width:100% !important; }</style>"))
sns.set_theme(style="darkgrid")

DATA_DIR = r'D:\0dot1_Aug_2016_master\data\mstock_mtf_daily_data'
OUTPUT_HTML = r'E:\github\ohlcv\notebook\output\pullback_sample_report.html'


# In[2]:


# 2. Indicator Math
def calc_rsi(series, period):
    delta = series.diff()
    up = delta.clip(lower=0)
    down = -1 * delta.clip(upper=0)
    ema_up = up.ewm(com=period-1, adjust=False).mean()
    ema_down = down.ewm(com=period-1, adjust=False).mean()
    rs = ema_up / ema_down
    return 100 - (100 / (1 + rs))

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

def calc_omega_pr(series, period=20, lookback=200):
    daily_returns = series.pct_change()

    def get_omega(ret_window):
        gains = ret_window[ret_window > 0].sum()
        losses = abs(ret_window[ret_window < 0].sum())
        if losses == 0: return np.nan
        return gains / losses

    rolling_omega = daily_returns.rolling(period).apply(get_omega, raw=False)
    pr = rolling_omega.rolling(lookback).apply(lambda x: pd.Series(x).rank(pct=True).iloc[-1] * 100, raw=False)
    return pr
def calc_dynamic_supertrend(df, target_days=10):
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

def calculate_all_indicators(df):
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)

    df['EMA_20'] = df['Close'].ewm(span=20, adjust=False).mean()
    df['EMA_20_Slope'] = df['EMA_20'].diff()

    df['RSI_3'] = calc_rsi(df['Close'], 3)
    df['RSI_21'] = calc_rsi(df['Close'], 21)

    df = calc_atr_and_adx(df)
    df['ADX_14_Slope'] = df['ADX_14'].diff()

    df['Omega_20_PR'] = calc_omega_pr(df['Close'], period=20, lookback=200)
    df = calc_dynamic_supertrend(df, target_days=10)
    df['Daily_Return'] = df['Close'].pct_change() * 100

    df['RSI3_was_below_30'] = df['RSI_3'].shift(1) < 30

    # We calculate everything on the full dataframe so Omega PR has 200 days history.
    # But we return only the last 1 year (approx 252 trading days) for the backtest phase
    df = df.dropna().reset_index(drop=True)
    if len(df) > 252:
        df = df.tail(252).reset_index(drop=True)
    return df


# In[3]:


# 3. Backtest Engine
def backtest_pullback(df, symbol):
    trades = []
    in_trade = False
    entry_price = 0
    entry_date = None
    entry_idx = 0
    days_held = 0
    stop_loss = 0
    target_price = 0

    for i in range(1, len(df)):
        row = df.iloc[i]

        if in_trade:
            days_held += 1
            exit_triggered = False
            exit_reason = ""
            exit_price = 0

            if row['High'] >= target_price:
                exit_triggered = True
                exit_reason = "Take Profit (+5%)"
                exit_price = target_price
            elif row['Low'] <= stop_loss:
                exit_triggered = True
                exit_reason = "Stop Loss (-1.5 ATR)"
                exit_price = stop_loss
            elif row['RSI_3'] > 75:
                exit_triggered = True
                exit_reason = "RSI 3 Exhaustion (>75)"
                exit_price = row['Close']
            elif row['Close'] < row['EMA_20']:
                exit_triggered = True
                exit_reason = "Trend Broken (Close < EMA 20)"
                exit_price = row['Close']
            elif days_held >= 10:
                exit_triggered = True
                exit_reason = "Time Stop (10 Days)"
                exit_price = row['Close']

            if exit_triggered:
                trades.append({
                    'Symbol': symbol,
                    'Entry_Date': entry_date,
                    'Entry_Price': entry_price,
                    'Exit_Date': row['Date'],
                    'Exit_Price': exit_price,
                    'Return': (exit_price - entry_price) / entry_price * 100,
                    'Reason': exit_reason,
                    'Days_Held': days_held,
                    'Entry_Idx': entry_idx,
                    'Exit_Idx': i
                })
                in_trade = False
                days_held = 0

        if not in_trade:
            regime = (row['Close'] > row['EMA_20']) and \
                     (row['EMA_20_Slope'] > 0) and \
                     (row['ADX_14'] > 20 or row['ADX_14_Slope'] > 0) and \
                     (row['Omega_20_PR'] > 50) and \
                     (row['SuperTrend'] == 1)

            avoid = (row['ATR_Pct'] > 5) or (row['Daily_Return'] > 5)

            if regime and not avoid:
                trigger1 = row['RSI3_was_below_30'] and row['RSI_3'] > 30
                trigger2 = (df.iloc[i-1]['RSI_3'] < 50) and (row['RSI_3'] > 50) and (row['RSI_21'] > 50)

                if trigger1 or trigger2:
                    in_trade = True
                    entry_price = row['Close']
                    entry_date = row['Date']
                    entry_idx = i
                    days_held = 0
                    target_price = entry_price * 1.05
                    stop_loss = entry_price - (1.5 * row['ATR_14'])

    return trades


# In[4]:


# 4. Run Strategy on Max 5 Stocks
all_trades = []
stock_dfs = {} # Save dataframes for plotting later

files = glob.glob(os.path.join(DATA_DIR, "*.csv"))
sample_files = files[:5] 

print(f"Processing {len(sample_files)} stocks over 1-year period...")
for file in sample_files:
    symbol = os.path.basename(file).split('.')[0]
    df = pd.read_csv(file)
    if len(df) < 250: # Ensure enough data for 200d Omega PR
        continue

    try:
        df = calculate_all_indicators(df)
        stock_dfs[symbol] = df
        stock_trades = backtest_pullback(df, symbol)
        all_trades.extend(stock_trades)
    except Exception as e:
        print(f"Error processing {symbol}: {e}")

trades_df = pd.DataFrame(all_trades)
if len(trades_df) > 0:
    print(f"\nFound {len(trades_df)} total trades.")
else:
    print("No trades found.")


# In[5]:


# 5. Generate Trade Plots & HTML Report
def plot_to_base64(trade, df):
    # Plot 10 days before entry and 5 days after exit
    start_idx = max(0, trade['Entry_Idx'] - 10)
    end_idx = min(len(df)-1, trade['Exit_Idx'] + 5)

    sub_df = df.iloc[start_idx:end_idx+1]

    fig, ax = plt.subplots(figsize=(6, 3), dpi=100)
    ax.plot(sub_df['Date'], sub_df['Close'], color='black', linewidth=1.5, label='Close')
    ax.plot(sub_df['Date'], sub_df['EMA_20'], color='blue', linestyle='--', linewidth=1, label='EMA 20')

    # Entry
    ax.scatter(trade['Entry_Date'], trade['Entry_Price'], color='green', marker='^', s=150, zorder=5)
    # Exit
    exit_color = 'green' if trade['Return'] > 0 else 'red'
    ax.scatter(trade['Exit_Date'], trade['Exit_Price'], color=exit_color, marker='v', s=150, zorder=5)

    # Connecting line
    ax.plot([trade['Entry_Date'], trade['Exit_Date']], [trade['Entry_Price'], trade['Exit_Price']], 
            color=exit_color, linestyle=':', alpha=0.5, zorder=4)

    ax.set_title(f"{trade['Symbol']} | {trade['Return']:.2f}% | {trade['Reason']}", fontsize=10)
    ax.axis('off')

    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')

html_content = """
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f3f4f6; color: #1f2937; margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 20px; }
        h1 { margin-top: 0; color: #111827; }
        .metrics { display: flex; gap: 20px; margin-bottom: 20px; }
        .metric-card { background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); flex: 1; text-align: center; }
        .metric-value { font-size: 24px; font-weight: bold; color: #4f46e5; }
        .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
        .trade-list { display: flex; flex-direction: column; gap: 20px; }
        .trade-card { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); display: flex; }
        .trade-info { padding: 20px; flex: 1; }
        .trade-plot { flex: 1; background: #fafafa; display: flex; align-items: center; justify-content: center; padding: 10px;}
        .trade-plot img { max-width: 100%; height: auto; border-radius: 8px;}
        .win { border-left: 6px solid #10b981; }
        .loss { border-left: 6px solid #ef4444; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Micro-Pullback Strategy Report</h1>
            <p><strong>Sample Size:</strong> 5 Stocks | <strong>Period:</strong> Last 6 Months</p>
        </div>
"""

if len(trades_df) > 0:
    wins = trades_df[trades_df['Return'] > 0]
    win_rate = len(wins)/len(trades_df)*100
    avg_ret = trades_df['Return'].mean()

    html_content += f"""
        <div class="metrics">
            <div class="metric-card"><div class="metric-label">Total Trades</div><div class="metric-value">{len(trades_df)}</div></div>
            <div class="metric-card"><div class="metric-label">Win Rate</div><div class="metric-value">{win_rate:.1f}%</div></div>
            <div class="metric-card"><div class="metric-label">Avg Return</div><div class="metric-value">{avg_ret:.2f}%</div></div>
        </div>
        <div class="trade-list">
    """

    for idx, trade in trades_df.iterrows():
        b64_plot = plot_to_base64(trade, stock_dfs[trade['Symbol']])
        card_class = "win" if trade['Return'] > 0 else "loss"
        color = "#10b981" if trade['Return'] > 0 else "#ef4444"

        html_content += f"""
            <div class="trade-card {card_class}">
                <div class="trade-info">
                    <h2 style="margin-top:0;">{trade['Symbol']}</h2>
                    <p><strong>Entry:</strong> {trade['Entry_Date'].strftime('%Y-%m-%d')} @ ₹{trade['Entry_Price']:.2f}</p>
                    <p><strong>Exit:</strong> {trade['Exit_Date'].strftime('%Y-%m-%d')} @ ₹{trade['Exit_Price']:.2f}</p>
                    <p><strong>Return:</strong> <span style="color:{color}; font-weight:bold;">{trade['Return']:.2f}%</span></p>
                    <p><strong>Held:</strong> {trade['Days_Held']} Days</p>
                    <p><strong>Reason:</strong> {trade['Reason']}</p>
                </div>
                <div class="trade-plot">
                    <img src="data:image/png;base64,{b64_plot}" />
                </div>
            </div>
        """

    html_content += "</div></div></body></html>"

    os.makedirs('output', exist_ok=True)
    with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"HTML Report generated at {OUTPUT_HTML}")
else:
    print("No trades found to generate report.")

