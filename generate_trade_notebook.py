import nbformat as nbf
import os

nb = nbf.v4.new_notebook()

markdown_1 = """# Short-Term Momentum Burst Backtest
Testing the Zero-Cross Acceleration with RSI Exhaustion Strategy on NSE Stocks.
"""

code_1 = """import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from scipy.stats import linregress
import os
import warnings
warnings.filterwarnings('ignore')
"""

code_2 = """def calc_linreg(series, period):
    lr_values = pd.Series(index=series.index, dtype=float)
    x = np.arange(period)
    for i in range(period - 1, len(series)):
        y = series.iloc[i - period + 1 : i + 1].values
        slope, intercept, _, _, _ = linregress(x, y)
        lr_values.iloc[i] = slope * (period - 1) + intercept
    return lr_values

def calc_roc(series, period=5):
    return series.pct_change(periods=period) * 100

def calc_rsi(series, period=5):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))
"""

code_3 = """def test_and_plot(filepath):
    stock_name = os.path.basename(filepath).replace('.csv', '')
    df = pd.read_csv(filepath)
    if 'Date' in df.columns:
        df['time'] = pd.to_datetime(df['Date'])
    elif 'time' in df.columns:
        df['time'] = pd.to_datetime(df['time'])
    
    df = df.sort_values('time').reset_index(drop=True)
    df.set_index('time', inplace=True)
    
    # Use last 2 years for plotting
    df = df.last('2Y')
    
    df['lr_8_fit'] = calc_linreg(df['Close'], 8)
    df['lr_8_roc'] = calc_roc(df['lr_8_fit'], 5)
    df['lr_8_accel'] = df['lr_8_roc'].diff()
    df['rsi_5'] = calc_rsi(df['Close'], 5)
    
    recent_drop = df['lr_8_roc'].rolling(15).min() < -3
    cross_zero = (df['lr_8_roc'] > 0) & (df['lr_8_roc'].shift(1) <= 0)
    with_accel = df['lr_8_accel'] > 0
    df['entry_signal'] = recent_drop & cross_zero & with_accel
    
    trade_returns = []
    entries = []
    exits = []
    
    in_trade = False
    entry_price = 0
    days_held = 0
    entry_time = None
    
    for i in range(15, len(df)):
        if not in_trade:
            if df['entry_signal'].iloc[i]:
                in_trade = True
                entry_price = df['Close'].iloc[i]
                entry_time = df.index[i]
                entries.append((entry_time, entry_price))
                days_held = 0
        else:
            days_held += 1
            if df['rsi_5'].iloc[i] > 80 or days_held >= 8:
                exit_price = df['Close'].iloc[i]
                exit_time = df.index[i]
                exits.append((exit_time, exit_price))
                if entry_price > 0:
                    trade_returns.append(exit_price / entry_price - 1)
                in_trade = False

    # Plot
    if len(entries) > 0:
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(15, 8), gridspec_kw={'height_ratios': [3, 1]})
        fig.suptitle(f'{stock_name} - Momentum Burst Trades', fontsize=14, fontweight='bold')
        
        ax1.plot(df.index, df['Close'], color='black', linewidth=1)
        ax1.plot(df.index, df['lr_8_fit'], color='blue', alpha=0.5, label='LR(8)')
        
        for e in entries:
            ax1.scatter(e[0], e[1], color='green', marker='^', s=150, zorder=5)
        for e in exits:
            ax1.scatter(e[0], e[1], color='red', marker='v', s=150, zorder=5)
            
        ax1.set_ylabel('Price')
        ax1.grid(True, alpha=0.3)
        ax1.legend()
        
        ax2.plot(df.index, df['rsi_5'], color='purple', label='RSI(5)')
        ax2.axhline(80, color='red', linestyle='--', alpha=0.5)
        ax2.axhline(20, color='green', linestyle='--', alpha=0.5)
        ax2.set_ylabel('RSI')
        ax2.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.show()
        
        print(f"{stock_name}: {len(entries)} trades in last 2 years")
"""

code_4 = """data_dir = r"E:\\github\\ohlcv\\data\\market\\nse\\mstock"
stocks = ['ABREL.csv', 'AAVAS.csv', 'AJANTPHARM.csv', 'RELIANCE.csv', 'HDFCBANK.csv']

for s in stocks:
    test_and_plot(os.path.join(data_dir, s))
"""

nb.cells = [
    nbf.v4.new_markdown_cell(markdown_1),
    nbf.v4.new_code_cell(code_1),
    nbf.v4.new_code_cell(code_2),
    nbf.v4.new_code_cell(code_3),
    nbf.v4.new_code_cell(code_4)
]

with open('E:/github/ohlcv/momentum_exhaustion_charts.ipynb', 'w') as f:
    nbf.write(nb, f)
print("Notebook created.")
