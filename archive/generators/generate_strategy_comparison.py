import nbformat as nbf
import os

nb = nbf.v4.new_notebook()

markdown_cell = nbf.v4.new_markdown_cell("""# Master Backtester: Strategy Comparison
# max stocks: 50
# Price Bracket: 90- 600
# max year: 1
# DATA_DIR = 'D:\\0dot1_Aug_2016_master\\data\\mstock_mtf_daily_data'
# Seed : 5""")

code_cells = [
    """# 1. Imports and Setup
import pandas as pd
import numpy as np
import os
import glob
import random
import matplotlib.pyplot as plt
import seaborn as sns
from IPython.display import display, HTML
import warnings

warnings.filterwarnings('ignore')
display(HTML("<style>.container { width:100% !important; }</style>"))
sns.set_theme(style="darkgrid")

DATA_DIR = r'D:\\0dot1_Aug_2016_master\\data\\mstock_mtf_daily_data'
""",
    """# 2. Data Loading
all_data = []
files = glob.glob(os.path.join(DATA_DIR, '*.csv'))
random.seed(5) 
random.shuffle(files)

loaded = 0
for file_path in files:
    if loaded >= 50: 
        break
    symbol = os.path.basename(file_path).replace('.csv', '')
    try:
        df = pd.read_csv(file_path).dropna(subset=['Close'])
        df['Date'] = pd.to_datetime(df['Date'])
        
        df = df.sort_values('Date').reset_index(drop=True)
        if len(df) < 300: # Need enough history for 200 SMA
            continue
            
        latest_price = df['Close'].iloc[-1]
        if not (90 <= latest_price <= 600):
            continue
            
        df['Symbol'] = symbol
        all_data.append(df)
        loaded += 1
    except Exception as e:
        pass

data = pd.concat(all_data, ignore_index=True)
print(f"Loaded {len(data['Symbol'].unique())} stocks for the Master Backtest.")
""",
    """# 3. Strategy Indicator Calculations
def calc_rsi(series, period=2):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))

enriched_data = []
symbols = data['Symbol'].unique()

for symbol in symbols:
    df = data[data['Symbol'] == symbol].copy()
    
    # Simple Moving Averages
    df['SMA_200'] = df['Close'].rolling(200).mean()
    df['SMA_20'] = df['Close'].rolling(20).mean()
    df['SMA_5'] = df['Close'].rolling(5).mean()
    
    # RSI(2)
    df['RSI_2'] = calc_rsi(df['Close'], 2)
    
    # Internal Bar Strength (IBS)
    df['IBS'] = (df['Close'] - df['Low']) / (df['High'] - df['Low'])
    df['IBS'] = df['IBS'].replace([np.inf, -np.inf], np.nan).fillna(0.5)
    
    # Volatility Squeeze (Bollinger Bands & Keltner Channels)
    df['StdDev_20'] = df['Close'].rolling(20).std()
    df['BB_Upper'] = df['SMA_20'] + (2 * df['StdDev_20'])
    df['BB_Lower'] = df['SMA_20'] - (2 * df['StdDev_20'])
    
    df['TR'] = np.maximum(df['High'] - df['Low'], 
                          np.maximum(abs(df['High'] - df['Close'].shift(1)), 
                                     abs(df['Low'] - df['Close'].shift(1))))
    df['ATR_20'] = df['TR'].rolling(20).mean()
    df['KC_Upper'] = df['SMA_20'] + (1.5 * df['ATR_20'])
    df['KC_Lower'] = df['SMA_20'] - (1.5 * df['ATR_20'])
    
    df['Squeeze_On'] = (df['BB_Upper'] < df['KC_Upper']) & (df['BB_Lower'] > df['KC_Lower'])
    
    # Volume Average
    if 'Volume' in df.columns:
        df['Vol_Avg_20'] = df['Volume'].rolling(20).mean()
    else:
        df['Volume'] = 0
        df['Vol_Avg_20'] = 1
    
    # Filter to last 250 days for backtest period
    if len(df) > 250:
        df = df.tail(250).reset_index(drop=True)
        
    enriched_data.append(df)

data = pd.concat(enriched_data, ignore_index=True)
print("Calculated all Indicators.")
""",
    """# 4. Strategy Backtesting Engines
def run_strategy(data, strategy_name):
    trades = []
    
    for symbol in data['Symbol'].unique():
        df = data[data['Symbol'] == symbol].reset_index(drop=True)
        
        in_trade = False
        entry_price = 0
        entry_date = None
        days_held = 0
        
        for i, row in df.iterrows():
            if pd.isna(row['SMA_200']):
                continue
                
            # Manage Open Trades
            if in_trade:
                days_held += 1
                exit_triggered = False
                exit_reason = ""
                
                # Check Strategy Exits
                if strategy_name == 'RSI2':
                    if row['Close'] > row['SMA_5']:
                        exit_triggered = True
                        exit_reason = "Close > 5 SMA"
                elif strategy_name == 'IBS':
                    if row['IBS'] > 0.85 or days_held >= 2:
                        exit_triggered = True
                        exit_reason = "IBS > 0.85 or Max Hold"
                elif strategy_name == 'Squeeze':
                    # Fixed 5 day hold for squeeze momentum or stop loss
                    profit_pct = (row['Close'] - entry_price) / entry_price
                    if profit_pct <= -0.05:
                        exit_triggered = True
                        exit_reason = "Stop Loss (-5%)"
                    elif days_held >= 5:
                        exit_triggered = True
                        exit_reason = "Time Exit (5 Days)"
                
                # Failsafe Stops
                if not exit_triggered:
                    profit_pct = (row['Close'] - entry_price) / entry_price
                    if strategy_name in ['RSI2', 'IBS'] and profit_pct <= -0.08:
                        exit_triggered = True
                        exit_reason = "Hard Stop (-8%)"
                
                if exit_triggered:
                    profit_pct = (row['Close'] - entry_price) / entry_price
                    trades.append({
                        'Strategy': strategy_name,
                        'Symbol': symbol,
                        'Entry_Date': entry_date,
                        'Exit_Date': row['Date'],
                        'Entry_Price': entry_price,
                        'Exit_Price': row['Close'],
                        'Profit_Pct': profit_pct * 100,
                        'Days_Held': days_held,
                        'Reason': exit_reason
                    })
                    in_trade = False
                    days_held = 0
                    
            # Look for Entries (Only if Macro Trend is UP)
            if not in_trade and row['Close'] > row['SMA_200']:
                if strategy_name == 'RSI2':
                    if row['RSI_2'] < 10:
                        in_trade = True
                        entry_price = row['Close']
                        entry_date = row['Date']
                
                elif strategy_name == 'IBS':
                    if row['IBS'] < 0.15:
                        in_trade = True
                        entry_price = row['Close']
                        entry_date = row['Date']
                        
                elif strategy_name == 'Squeeze':
                    # Look for volume spike breakout from squeeze
                    if row['Squeeze_On'] and row['Close'] > row['BB_Upper'] and row['Volume'] > (2 * row['Vol_Avg_20']):
                        in_trade = True
                        entry_price = row['Close']
                        entry_date = row['Date']

    return pd.DataFrame(trades)

# Run all 3
df_rsi2 = run_strategy(data, 'RSI2')
df_squeeze = run_strategy(data, 'Squeeze')
df_ibs = run_strategy(data, 'IBS')

all_trades = pd.concat([df_rsi2, df_squeeze, df_ibs], ignore_index=True)
print("Backtesting Complete.")
""",
    """# 5. The Scoreboard (Comparative Analysis)
summary = []

for strat in ['RSI2', 'Squeeze', 'IBS']:
    strat_trades = all_trades[all_trades['Strategy'] == strat]
    if len(strat_trades) > 0:
        total = len(strat_trades)
        winners = strat_trades[strat_trades['Profit_Pct'] > 0]
        win_rate = len(winners) / total * 100
        avg_profit = strat_trades['Profit_Pct'].mean()
        avg_win = winners['Profit_Pct'].mean() if len(winners) > 0 else 0
        avg_hold = strat_trades['Days_Held'].mean()
        
        summary.append({
            'Strategy': strat,
            'Total Trades': total,
            'Win Rate %': round(win_rate, 2),
            'Avg Net Profit %': round(avg_profit, 2),
            'Avg Win %': round(avg_win, 2),
            'Avg Hold (Days)': round(avg_hold, 1)
        })
    else:
         summary.append({
            'Strategy': strat,
            'Total Trades': 0,
            'Win Rate %': 0,
            'Avg Net Profit %': 0,
            'Avg Win %': 0,
            'Avg Hold (Days)': 0
        })

summary_df = pd.DataFrame(summary).sort_values('Avg Net Profit %', ascending=False)

html = '''
<h1 style="color: #2e6c80;">Master Backtest: Strategy Comparison</h1>
<p>Tested across 50 random stocks over the last 1 year of data.</p>
'''
display(HTML(html))
display(summary_df.style.background_gradient(cmap='viridis', subset=['Win Rate %', 'Avg Net Profit %']))
"""
]

nb['cells'] = [markdown_cell] + [nbf.v4.new_code_cell(code) for code in code_cells]
os.makedirs(r'E:\\github\\ohlcv\\notebook', exist_ok=True)
with open(r'E:\\github\\ohlcv\\notebook\\ohlcv_strategy_comparison.ipynb', 'w', encoding='utf-8') as f:
    nbf.write(nb, f)
