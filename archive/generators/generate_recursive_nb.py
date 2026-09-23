import nbformat as nbf
import os

nb = nbf.v4.new_notebook()

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
pd.options.mode.chained_assignment = None

display(HTML("<style>.container { width:100% !important; }</style>"))
plt.rcParams['figure.figsize'] = (24, 8)
sns.set_theme(style="darkgrid")

DATA_DIR = r'D:\\0dot1_Aug_2016_master\\data\\mstock_mtf_daily_data'
""",
    """# 2. Data Loading (Subset for Speed)
def load_all_data():
    all_data = []
    files = glob.glob(os.path.join(DATA_DIR, '*.csv'))
    random.seed(42)
    random.shuffle(files)
    
    for file_path in files:
        if len(all_data) >= 50:
            break
        symbol = os.path.basename(file_path).replace('.csv', '')
        try:
            df = pd.read_csv(file_path)
            df = df.dropna(subset=['Close'])
            
            if len(df) > 0:
                latest_price = df['Close'].iloc[-1]
                if latest_price < 90 or latest_price > 600:
                    continue
                    
            df['Date'] = pd.to_datetime(df['Date'])
            df = df.sort_values('Date').reset_index(drop=True)
            df['Daily_Ret'] = df['Close'].pct_change()
            df = df[(df['Daily_Ret'].isna()) | (df['Daily_Ret'].abs() <= 0.20)]
            df['Symbol'] = symbol
            all_data.append(df)
        except Exception as e:
            pass
            
    print(f"Loaded {len(all_data)} stocks.")
    return pd.concat(all_data, ignore_index=True)

data = load_all_data()
num_stocks = data['Symbol'].nunique()
""",
    """# 3. Multi-Factor Feature Engineering
LOOKBACKS = [13, 21, 34]

def enrich_data(df):
    df = df.copy()
    
    for h in [8, 13]:
        df[f'Fwd_{h}d'] = df['Close'].shift(-h) / df['Close'] - 1
        
    for p in LOOKBACKS:
        # ER
        change = abs(df['Close'] - df['Close'].shift(p))
        volatility = df['Close'].diff().abs().rolling(p).sum()
        df[f'ER_{p}'] = change / volatility
        
        # Cumulative Return
        df[f'CumRet_{p}'] = (df['Close'] - df['Close'].shift(p)) / df['Close'].shift(p)
        
        # WMA Ratio (Close / WMA)
        weights = np.arange(1, p + 1)
        wma = df['Close'].rolling(p).apply(lambda x: np.dot(x, weights) / weights.sum(), raw=True)
        df[f'WMA_Ratio_{p}'] = df['Close'] / wma
        
    return df

print("Pre-computing multi-factor features...")
_data_list = []
for sym, grp in data.groupby('Symbol'):
    _data_list.append(enrich_data(grp))
data = pd.concat(_data_list, ignore_index=True)

test_data = data[data['Date'] >= '2023-01-01']
years = (test_data['Date'].max() - test_data['Date'].min()).days / 365.25
""",
    """# 4. Multi-Factor Grid Search (AND/OR Logic)
er_thresholds = [0.4, 0.5, 0.6]
cum_thresholds = [0.05, 0.10, 0.15]
wma_ratio_thresholds = [1.03, 1.05, 1.10]
hold_days = [8, 13]
logic_types = ['STRICT_AND', 'FLEXIBLE_OR']

results = []

for l_idx, lookback in enumerate(LOOKBACKS):
    er_col = f'ER_{lookback}'
    cum_col = f'CumRet_{lookback}'
    wma_col = f'WMA_Ratio_{lookback}'
    
    for er_t in er_thresholds:
        for cum_t in cum_thresholds:
            for wma_t in wma_ratio_thresholds:
                for logic in logic_types:
                    # Apply WMA Risk Constraint (Always an AND, bound between 0.97 and upper limit)
                    wma_cond = (test_data[wma_col] < wma_t) & (test_data[wma_col] > 0.97)
                    
                    if logic == 'STRICT_AND':
                        trades = test_data[(test_data[er_col] > er_t) & (test_data[cum_col] > cum_t) & wma_cond]
                    else: # FLEXIBLE_OR
                        trades = test_data[((test_data[er_col] > er_t) | (test_data[cum_col] > cum_t)) & wma_cond]
                        
                    num_trades = len(trades)
                    t_per_year = num_trades / num_stocks / years if num_stocks > 0 and years > 0 else 0
                    
                    for hold in hold_days:
                        fwd_col = f'Fwd_{hold}d'
                        valid_trades = trades.dropna(subset=[fwd_col])
                        n_valid = len(valid_trades)
                        
                        if n_valid == 0: continue
                            
                        win_rate = (valid_trades[fwd_col] > 0).mean() * 100
                        avg_ret = valid_trades[fwd_col].mean() * 100
                        
                        if t_per_year < 1.0: # Enforce at least 1 trade per year per stock
                            fitness = 0 
                        else:
                            fitness = (win_rate / 100) * avg_ret * (t_per_year ** 0.5)
                        
                        results.append({
                            'Logic': logic,
                            'Lookback': lookback,
                            'Condition': f"ER>{er_t} {logic[-3:]} CR>{cum_t}",
                            'WMA_Ratio_Avoid': f"0.97 - {wma_t}",
                            'Hold': hold,
                            'T/Yr': round(t_per_year, 1),
                            'WinRate': win_rate,
                            'AvgRet': avg_ret,
                            'Fitness': fitness
                        })

results_df = pd.DataFrame(results)
valid_results = results_df[results_df['Fitness'] > 0].sort_values(by='Fitness', ascending=False).reset_index(drop=True)

print("\\n=== MULTI-FACTOR LEADERBOARD ===")
if len(valid_results) > 0:
    display(valid_results.head(15))
else:
    print("No valid rules found.")
"""
]

nb['cells'] = [nbf.v4.new_code_cell(code) for code in code_cells]
os.makedirs(r'E:\\github\\ohlcv\\notebook', exist_ok=True)
with open(r'E:\\github\\ohlcv\\notebook\\multi_factor_miner.ipynb', 'w', encoding='utf-8') as f:
    nbf.write(nb, f)
