import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os, glob

# Indicator Functions
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

# Configuration
TARGET_PCT = 5.0
STOP_LOSS_PCT = 4.0
TIME_STOP_DAYS = 8
DATA_DIR = r'D:\0dot1_Aug_2016_master\data\mstock_mtf_daily_data'
all_files = glob.glob(os.path.join(DATA_DIR, '*.csv'))

# Find a stock with good amount of trades
import random
random.seed(42)
random.shuffle(all_files)

test_df = None
trades = []
symbol = ""

for file_path in all_files:
    df = pd.read_csv(file_path)
    if len(df) < 250: continue
    
    df['Date'] = pd.to_datetime(df['Date'])
    if 'Open' not in df.columns: df['Open'] = df['Close'] 
    
    df['Omega_5'] = calc_omega_pr(df['Close'], 5)
    df['Omega_13'] = calc_omega_pr(df['Close'], 13)
    df['RSI_14'] = calc_rsi(df['Close'], 14)
    df = calc_dynamic_supertrend(df, target_days=TIME_STOP_DAYS)
    
    mask = (df['Date'] >= '2022-01-01') & (df['Date'] <= '2023-12-31')
    test_df = df[mask].copy().reset_index(drop=True)
    if len(test_df) < 100: continue
    
    trades = []
    
    for i in range(1, len(test_df) - TIME_STOP_DAYS):
        o13_today = test_df.iloc[i]['Omega_13']
        o5_today = test_df.iloc[i]['Omega_5']
        o5_yesterday = test_df.iloc[i-1]['Omega_5']
        st_today = test_df.iloc[i]['SuperTrend']
        
        if o13_today > 50 and o5_yesterday <= 50 and o5_today > 50 and st_today == 1:
            entry_date = test_df.iloc[i]['Date']
            entry_price = test_df.iloc[i]['Close']
            target_price = entry_price * (1 + (TARGET_PCT / 100))
            stop_price = entry_price * (1 - (STOP_LOSS_PCT / 100))
            
            trade_result = 'TIME_STOP'
            exit_price = 0
            exit_date = None
            
            for j in range(1, TIME_STOP_DAYS + 1):
                day_idx = i + j
                candle = test_df.iloc[day_idx]
                
                if candle['Low'] <= stop_price:
                    trade_result = 'LOSS'
                    exit_price = stop_price
                    exit_date = candle['Date']
                    break
                elif max(candle['Open'], candle['Close']) >= target_price:
                    trade_result = 'WIN'
                    exit_price = target_price
                    exit_date = candle['Date']
                    break
            
            if trade_result == 'TIME_STOP':
                candle = test_df.iloc[i + TIME_STOP_DAYS]
                exit_price = candle['Close']
                exit_date = candle['Date']
                trade_result = 'WIN' if exit_price > entry_price else 'LOSS'
                
            trades.append({
                'entry_idx': i,
                'exit_idx': i + j if trade_result != 'TIME_STOP' else i + TIME_STOP_DAYS,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'result': trade_result
            })
            
    if len(trades) >= 3:
        symbol = os.path.basename(file_path).replace('.csv', '')
        break

if not trades:
    print("Could not find a stock with enough trades.")
    exit()

print(f"Plotting {len(trades)} trades for {symbol}")

# Plotting
fig, axes = plt.subplots(4, 1, figsize=(16, 16), sharex=True, gridspec_kw={'height_ratios': [3, 1, 1, 1]})
fig.subplots_adjust(hspace=0.05)

ax_price, ax_o13, ax_o5, ax_rsi = axes

# 1. Price Panel
ax_price.plot(test_df.index, test_df['Close'], color='black', lw=1.5, label='Close Price')
ax_price.set_title(f"Trade Analysis: {symbol}", fontsize=14, fontweight='bold')
ax_price.set_ylabel("Price")

# Plot trades on all axes
for t in trades:
    c = 'green' if t['result'] == 'WIN' else 'red'
    # Entry
    ax_price.scatter(t['entry_idx'], t['entry_price'], color=c, marker='^', s=150, zorder=5)
    ax_o13.scatter(t['entry_idx'], test_df.iloc[t['entry_idx']]['Omega_13'], color=c, marker='^', s=100, zorder=5)
    ax_o5.scatter(t['entry_idx'], test_df.iloc[t['entry_idx']]['Omega_5'], color=c, marker='^', s=100, zorder=5)
    ax_rsi.scatter(t['entry_idx'], test_df.iloc[t['entry_idx']]['RSI_14'], color=c, marker='^', s=100, zorder=5)
    
    # Exit
    ax_price.scatter(t['exit_idx'], t['exit_price'], color=c, marker='v', s=150, zorder=5)
    ax_o13.scatter(t['exit_idx'], test_df.iloc[t['exit_idx']]['Omega_13'], color=c, marker='v', s=100, zorder=5)
    ax_o5.scatter(t['exit_idx'], test_df.iloc[t['exit_idx']]['Omega_5'], color=c, marker='v', s=100, zorder=5)
    ax_rsi.scatter(t['exit_idx'], test_df.iloc[t['exit_idx']]['RSI_14'], color=c, marker='v', s=100, zorder=5)
    
    # Connecting line on price
    ax_price.plot([t['entry_idx'], t['exit_idx']], [t['entry_price'], t['exit_price']], color=c, lw=2, alpha=0.5)

# 2. Omega 13
ax_o13.plot(test_df.index, test_df['Omega_13'], color='blue', lw=1.2, label='Omega 13 PR')
ax_o13.axhline(50, color='gray', linestyle='--', alpha=0.5)
ax_o13.set_ylabel("Omega 13")

# 3. Omega 5
ax_o5.plot(test_df.index, test_df['Omega_5'], color='purple', lw=1.2, label='Omega 5 PR')
ax_o5.axhline(50, color='gray', linestyle='--', alpha=0.5)
ax_o5.set_ylabel("Omega 5")

# 4. RSI 14
ax_rsi.plot(test_df.index, test_df['RSI_14'], color='orange', lw=1.2, label='RSI 14')
ax_rsi.axhline(70, color='red', linestyle='--', alpha=0.5)
ax_rsi.axhline(30, color='green', linestyle='--', alpha=0.5)
ax_rsi.set_ylabel("RSI 14")

for ax in axes:
    ax.grid(True, alpha=0.3)
    ax.legend(loc='upper left')

plt.xlim(test_df.index[0], test_df.index[-1])
plt.xticks(test_df.index[::20], test_df['Date'].dt.strftime('%Y-%m')[::20], rotation=45)

out_path = r'E:\github\ohlcv\output\trade_analysis_chart.jpg'
plt.savefig(out_path, bbox_inches='tight', dpi=150)
print(f"Chart saved to {out_path}")
