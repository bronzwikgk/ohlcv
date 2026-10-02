import pandas as pd
import numpy as np
from scipy.stats import linregress
import matplotlib.pyplot as plt
import warnings
import os
warnings.filterwarnings('ignore')

def calc_rsi(series, period=5):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def calc_linreg(series, period):
    lr_values = pd.Series(index=series.index, dtype=float)
    lr_slopes = pd.Series(index=series.index, dtype=float)
    x = np.arange(period)
    for i in range(period - 1, len(series)):
        y = series.iloc[i - period + 1 : i + 1].values
        slope, intercept, _, _, _ = linregress(x, y)
        lr_slopes.iloc[i] = slope
        lr_values.iloc[i] = slope * (period - 1) + intercept
    return lr_values, lr_slopes

def calc_roc(series, period=5):
    return series.pct_change(periods=period) * 100

def generate_signals(df):
    df['rsi_5'] = calc_rsi(df['Close'], 5)
    df['lr_8_fit'], df['lr_8_slope'] = calc_linreg(df['Close'], 8)
    df['lr_34_fit'], df['lr_34_slope'] = calc_linreg(df['Close'], 34)
    df['lr_8_roc'] = calc_roc(df['lr_8_fit'], 5)
    df['lr_34_roc'] = calc_roc(df['lr_34_fit'], 5)
    df['lr_8_accel'] = df['lr_8_roc'].diff()
    
    # Macro trend must be decidedly up
    macro_trend = df['lr_34_slope'] > 0
    
    # RSI(5) must have dipped below 40 recently and is now hooking up
    rsi_primer = (df['rsi_5'].rolling(3).min() < 40) & (df['rsi_5'] > df['rsi_5'].shift(1))
    
    # Acceleration crossing above 0
    accel_cross_up = (df['lr_8_accel'] > 0) & (df['lr_8_accel'].shift(1) <= 0)
    
    short_trend = df['lr_8_roc'] > 0
    
    df['entry_signal'] = macro_trend & accel_cross_up & short_trend & rsi_primer
    
    accel_cross_down = (df['lr_8_accel'] < 0) & (df['lr_8_accel'].shift(1) >= 0)
    rsi_exhaustion = (df['rsi_5'].shift(1) > 85) & (df['rsi_5'] < df['rsi_5'].shift(1))
    df['exit_signal'] = accel_cross_down | rsi_exhaustion
    
    return df

def plot_trade(df, symbol, entry_date, exit_date, pnl, idx):
    # Plot a window around the trade (20 days before, 10 days after)
    start_idx = max(0, df.index.get_loc(entry_date) - 20)
    end_idx = min(len(df) - 1, df.index.get_loc(exit_date) + 10)
    
    window_df = df.iloc[start_idx:end_idx+1]
    
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 10), gridspec_kw={'height_ratios': [3, 1, 1]})
    
    # Panel 1: Price
    ax1.plot(window_df.index, window_df['Close'], label='Close', color='black', linewidth=1.5)
    ax1.plot(window_df.index, window_df['lr_8_fit'], label='LR(8) Fast', color='blue', alpha=0.7)
    ax1.plot(window_df.index, window_df['lr_34_fit'], label='LR(34) Slow', color='orange', alpha=0.7)
    
    ax1.scatter([entry_date], [df.loc[entry_date, 'Close']], marker='^', color='green', s=200, label='Entry', zorder=5)
    ax1.scatter([exit_date], [df.loc[exit_date, 'Close']], marker='v', color='red', s=200, label='Exit', zorder=5)
    
    ax1.set_title(f'{symbol} Trade (PnL: {pnl}%)')
    ax1.legend(loc='upper left')
    ax1.grid(True, alpha=0.3)
    
    # Panel 2: Accel
    ax2.plot(window_df.index, window_df['lr_8_accel'], label='LR(8) Acceleration', color='blue')
    ax2.axhline(0, color='black', linewidth=1)
    ax2.legend(loc='upper left')
    ax2.grid(True, alpha=0.3)
    
    # Panel 3: RSI
    ax3.plot(window_df.index, window_df['rsi_5'], label='RSI(5)', color='purple')
    ax3.axhline(40, color='green', linestyle='--', alpha=0.5)
    ax3.axhline(85, color='red', linestyle='--', alpha=0.5)
    ax3.legend(loc='upper left')
    ax3.grid(True, alpha=0.3)
    
    plt.tight_layout()
    os.makedirs('plots', exist_ok=True)
    plt.savefig(f'plots/{symbol}_trade_{idx}.png')
    plt.close()

def backtest(df, symbol):
    in_trade = False
    entry_price = 0
    entry_date = None
    trades = []
    trade_idx = 1
    
    for i in range(len(df)):
        row = df.iloc[i]
        date = df.index[i]
        
        # Only take entries in 2019
        if not in_trade and row['entry_signal'] and date.year == 2019:
            in_trade = True
            entry_price = row['Close']
            entry_date = date
            
        elif in_trade:
            current_pnl = (row['Close'] - entry_price) / entry_price * 100
            if current_pnl <= -2.5 or row['exit_signal']:
                in_trade = False
                exit_price = row['Close']
                pnl = (exit_price - entry_price) / entry_price * 100
                hold_days = (date - entry_date).days
                trades.append({
                    'Symbol': symbol,
                    'Entry Date': entry_date.strftime('%Y-%m-%d'),
                    'Exit Date': date.strftime('%Y-%m-%d'),
                    'Entry Price': round(entry_price, 2),
                    'Exit Price': round(exit_price, 2),
                    'Hold Days': hold_days,
                    'PnL %': round(pnl, 2),
                    'Exit Reason': 'Stop Loss' if current_pnl <= -2.5 else 'Velocity/RSI'
                })
                plot_trade(df, symbol, entry_date, date, round(pnl, 2), trade_idx)
                trade_idx += 1
            
    return trades

stocks = ['AAVAS', 'CROMPTON', 'BATAINDIA', 'AJANTPHARM', 'LALPATHLAB']
data_dir = r"D:\0dot1_Aug_2016_master\data\mstock_mtf_daily_data"

all_trades = []

print("Running Backtest for 2019 on selected Mid-Caps...")
for stock in stocks:
    file_path = os.path.join(data_dir, f"{stock}.csv")
    if os.path.exists(file_path):
        df = pd.read_csv(file_path)
        
        # Clean column names in case they have spaces
        df.columns = [c.strip() for c in df.columns]
        
        if 'Adj Close' in df.columns:
            df['Close'] = df['Adj Close']
            
        df['Close'] = pd.to_numeric(df['Close'], errors='coerce')
        df.dropna(subset=['Close'], inplace=True)
            
        if 'Date' not in df.columns and 'date' in df.columns:
            df['Date'] = df['date']
            
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.sort_values('Date')
        df.set_index('Date', inplace=True)
        
        # Filter dates
        df = df[(df.index >= '2018-01-01') & (df.index <= '2019-12-31')]
        
        if len(df) > 50: # Need enough data for lookbacks
            df = generate_signals(df)
            trades = backtest(df, stock)
            all_trades.extend(trades)

results_df = pd.DataFrame(all_trades)
if not results_df.empty:
    print(results_df.to_string(index=False))
    print("-" * 50)
    print(f"Total Trades in 2019: {len(results_df)}")
    wins = len(results_df[results_df['PnL %'] > 0])
    print(f"Win Rate: {wins/len(results_df)*100:.2f}%")
    print(f"Average PnL per trade: {results_df['PnL %'].mean():.2f}%")
    print(f"Average Hold Days: {results_df['Hold Days'].mean():.2f}")
else:
    print("No trades found.")
