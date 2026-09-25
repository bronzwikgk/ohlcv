import nbformat as nbf

nb = nbf.v4.new_notebook()

markdown = """# CUSUM (Cumulative Sum) Structural Break Filter
This notebook demonstrates how a CUSUM filter mathematically detects the true start of a trend while ignoring standard daily volatility. 

**How the math works:**
1. It calculates the **20-Day Volatility** (Standard Deviation) of the stock.
2. If today's return is higher than normal volatility (e.g., `0.5 * Vol`), it adds the excess to a running `Pos_CUSUM` tally.
3. Once the running tally crosses the limit (e.g., `2.0 * Vol`), it triggers an **Upward Break**, flags the chart, and resets the tally back to 0. 
4. The exact reverse happens for downward trends (`Neg_CUSUM`).
"""
nb.cells.append(nbf.v4.new_markdown_cell(markdown))

code = """
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import glob, os, random
from IPython.display import Image, display

# 1. Load Data
DATA_DIR = r'D:\\0dot1_Aug_2016_master\\data\\mstock_mtf_daily_data'
files = glob.glob(os.path.join(DATA_DIR, '*.csv'))
random.seed(15) # Pick a static seed
random.shuffle(files)
selected = files[:2] # Pick 2 random stocks to visualize

def symmetric_cusum(df, threshold_mult=0.5, limit_mult=2.0):
    # Calculate daily log returns
    df['Log_Ret'] = np.log(df['Close'] / df['Close'].shift(1))
    
    # Calculate 20-day rolling volatility (standard deviation of log returns)
    df['Vol_20'] = df['Log_Ret'].rolling(20).std()
    
    pos_cusum = np.zeros(len(df))
    neg_cusum = np.zeros(len(df))
    events = np.zeros(len(df)) # 1 for Up break, -1 for Down break
    
    # Calculate CUSUM sequentially
    for i in range(20, len(df)):
        vol = df['Vol_20'].iloc[i]
        ret = df['Log_Ret'].iloc[i]
        
        if np.isnan(vol) or vol == 0: continue
            
        # Accumulate deviation beyond the threshold (e.g., 0.5 * Volatility)
        # We only accumulate 'excess' return. If it's just normal noise, it returns 0.
        pos_cusum[i] = max(0, pos_cusum[i-1] + ret - (vol * threshold_mult))
        neg_cusum[i] = min(0, neg_cusum[i-1] + ret + (vol * threshold_mult))
        
        # Check if cumulative sum exceeds the Limit (e.g., 2.0 * Volatility)
        if pos_cusum[i] > (vol * limit_mult):
            events[i] = 1
            pos_cusum[i] = 0 # Reset tally after trigger
            
        elif neg_cusum[i] < -(vol * limit_mult):
            events[i] = -1
            neg_cusum[i] = 0 # Reset tally after trigger
            
    df['Pos_CUSUM'] = pos_cusum
    df['Neg_CUSUM'] = neg_cusum
    df['CUSUM_Event'] = events
    return df

os.makedirs('../output', exist_ok=True)

for f in selected:
    symbol = os.path.basename(f).split('.')[0]
    df = pd.read_csv(f)
    df['Date'] = pd.to_datetime(df['Date'])
    
    # Run the CUSUM Filter!
    df = symmetric_cusum(df, threshold_mult=0.5, limit_mult=2.0)
    
    # Filter for a 1-year window (2020) so we can see the micro-structure clearly
    df_plot = df[(df['Date'] >= '2020-01-01') & (df['Date'] <= '2020-12-31')].copy()
    
    if len(df_plot) == 0: continue
        
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(15, 8), gridspec_kw={'height_ratios': [3, 1]})
    
    # --- Top Chart: Price and Trigger Events ---
    ax1.plot(df_plot['Date'], df_plot['Close'], color='black', label='Close Price')
    
    # Mark Up Events (Green Triangles)
    up_events = df_plot[df_plot['CUSUM_Event'] == 1]
    ax1.scatter(up_events['Date'], up_events['Close'], color='#22c55e', s=150, marker='^', zorder=5, label='Upward Break (CUSUM Trigger)')
    
    # Mark Down Events (Red Triangles)
    down_events = df_plot[df_plot['CUSUM_Event'] == -1]
    ax1.scatter(down_events['Date'], down_events['Close'], color='#ef4444', s=150, marker='v', zorder=5, label='Downward Break (CUSUM Trigger)')
    
    ax1.set_title(f"CUSUM Structural Break Detection - {symbol}", fontsize=16, weight='bold')
    ax1.grid(True, alpha=0.3)
    ax1.legend(loc='upper left')
    
    # --- Bottom Chart: The Internal CUSUM Engine ---
    ax2.plot(df_plot['Date'], df_plot['Pos_CUSUM'], color='#22c55e', alpha=0.8, linewidth=2, label='Positive Tally')
    ax2.plot(df_plot['Date'], df_plot['Neg_CUSUM'], color='#ef4444', alpha=0.8, linewidth=2, label='Negative Tally')
    ax2.axhline(0, color='black', linestyle='--')
    ax2.set_title("The CUSUM Running Tally (Drops to 0 when it triggers an event)", fontsize=10)
    ax2.grid(True, alpha=0.3)
    ax2.legend(loc='upper left')
    
    plt.tight_layout()
    filename = f'../output/cusum_{symbol}.jpg'
    
    # Using our new Blazing Fast JPEG technique!
    plt.savefig(filename, format='jpeg', bbox_inches='tight')
    plt.close()
    
    display(Image(filename=filename))
"""
nb.cells.append(nbf.v4.new_code_cell(code))

with open('E:\\github\\ohlcv\\notebook\\cusum_exploration.ipynb', 'w') as f:
    nbf.write(nb, f)
