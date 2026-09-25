import nbformat as nbf
import os

nb = nbf.v4.new_notebook()

# Cell 1: Description
markdown_1 = """# Dynamic Fractal Architecture & Full Trade Pipeline
This notebook implements the fully dynamic, target-driven classification system and defines the entire trading pipeline from start to finish. Everything is derived from a single "Base Unit" (The Target Horizon). 

**The Full Pipeline Flow:**
1. **Target Unit ($T$):** The core goal (e.g., 14 days, 10% Return).
2. **Regime Role:** Macro context using a large multiplier (e.g., `10x T = 140 days`). (Bull, Bear, Chop).
3. **Setup Role:** Micro return distribution using a smaller multiplier (e.g., `2x T = 28 days`). (Steady Grinder, Serial Exploder).
4. **Trigger Role:** The exact entry signal inside a valid setup (e.g., Omega short-term cross).
5. **Quality Role:** Final filter before execution (e.g., avoiding earnings week, or liquidity checks).
6. **Risk Avoid / Exit:** Dynamic stop-loss (e.g., Volatility trailing stop) and Target Profit taking.
"""
nb.cells.append(nbf.v4.new_markdown_cell(markdown_1))

# Cell 2: The Core Logic
code_1 = """
import pandas as pd
import numpy as np
import glob, os, random
import matplotlib.pyplot as plt

# --- 1. DYNAMIC BASE UNITS & MULTIPLIERS ---
TARGET_HORIZON_DAYS = 14

# Multipliers
REGIME_MULT = 10
SETUP_MULT = 2

# Derived Lookbacks
REGIME_LOOKBACK = TARGET_HORIZON_DAYS * REGIME_MULT  # 140 days
SETUP_LOOKBACK = TARGET_HORIZON_DAYS * SETUP_MULT    # 28 days

print(f"Target Horizon: {TARGET_HORIZON_DAYS} Days")
print(f"Regime Lookback: {REGIME_LOOKBACK} Days (Macro Context)")
print(f"Setup Lookback: {SETUP_LOOKBACK} Days (Micro Return Profile)")

# --- 2. LOAD SAMPLE DATA ---
DATA_DIR = r'D:\\0dot1_Aug_2016_master\\data\\mstock_mtf_daily_data'
files = glob.glob(os.path.join(DATA_DIR, '*.csv'))
random.seed(42)
random.shuffle(files)
selected_files = files[:5] # Small sample of 5 stocks

data_dict = {}
for f in selected_files:
    symbol = os.path.basename(f).split('.')[0]
    df = pd.read_csv(f)
    df['Date'] = pd.to_datetime(df['Date'])
    
    # Calculate Daily Log Returns
    df['Log_Ret'] = np.log(df['Close'] / df['Close'].shift(1)) * 100
    df = df.dropna()
    data_dict[symbol] = df
    
print(f"Loaded {len(selected_files)} stocks for testing.")
"""
nb.cells.append(nbf.v4.new_code_cell(code_1))

# Cell 3: Classification Logic
code_2 = """
def classify_regime(df, index):
    # Extracts the Macro Regime block (140 days)
    if index < REGIME_LOOKBACK:
        return "Unknown"
        
    block = df.iloc[index - REGIME_LOOKBACK : index]
    
    # Macro Metrics
    total_ret = (block['Close'].iloc[-1] / block['Close'].iloc[0]) - 1
    volatility = block['Log_Ret'].std()
    
    # Simple Regime Logic
    if total_ret > 0.10 and volatility < 3.0:
        return "Bull_Expansion"
    elif total_ret < -0.10:
        return "Bear_Contraction"
    else:
        return "Chop"

def classify_setup_profile(df, index):
    # Extracts the Micro Setup block (28 days)
    if index < SETUP_LOOKBACK:
        return "Unknown", 0, 0
        
    block = df.iloc[index - SETUP_LOOKBACK : index]
    
    # Micro Metrics (The DNA)
    positive_returns = block[block['Log_Ret'] > 0]['Log_Ret'].sum()
    negative_returns = abs(block[block['Log_Ret'] < 0]['Log_Ret'].sum())
    
    # Calculate Omega manually for the block (Ratio of Pos/Neg variance)
    omega = (positive_returns / negative_returns * 100) if negative_returns != 0 else 100
    
    volatility = block['Log_Ret'].std()
    high_freq_days = len(block[block['Log_Ret'] > 3.0]) # Days > 3% jump
    
    # Simple Return Profile Logic
    if omega > 150 and high_freq_days == 0 and volatility < 1.5:
        profile = "Steady_Grinder"
    elif omega > 120 and high_freq_days >= 2:
        profile = "Serial_Exploder"
    elif omega < 80:
        profile = "Bleeder"
    else:
        profile = "Neutral_Noise"
        
    return profile, omega, volatility

# Run the Classification Engine
results = []

for symbol, df in data_dict.items():
    # Only test a small 1-year window for speed (e.g., 2021)
    df_test = df[(df['Date'] >= '2021-01-01') & (df['Date'] <= '2021-12-31')]
    
    for i in range(len(df_test)):
        # We need the global index to look back properly
        global_idx = df_test.index[i]
        
        if global_idx >= REGIME_LOOKBACK:
            regime = classify_regime(df, global_idx)
            setup_profile, omega, vol = classify_setup_profile(df, global_idx)
            
            results.append({
                'Symbol': symbol,
                'Date': df_test['Date'].iloc[i],
                'Close': df_test['Close'].iloc[i],
                'Regime': regime,
                'Setup_Profile': setup_profile,
                'Omega_Score': round(omega, 1),
                'Volatility': round(vol, 2)
            })

results_df = pd.DataFrame(results)
print("Engine finished classifying blocks!")
"""
nb.cells.append(nbf.v4.new_code_cell(code_2))

# Cell 4: View the Matrix
code_3 = """
from IPython.display import display

# Let's see how many blocks fell into each combination of Regime + Setup!
matrix = pd.crosstab(results_df['Regime'], results_df['Setup_Profile'])

print("CLASSIFICATION MATRIX (Regime vs Setup Profile):")
display(matrix)

print("\\n\\nEXAMPLE: 'Steady Grinders' inside a 'Bull Expansion' Regime:")
bull_grinders = results_df[(results_df['Regime'] == 'Bull_Expansion') & (results_df['Setup_Profile'] == 'Steady_Grinder')]
display(bull_grinders.head(10))
"""
nb.cells.append(nbf.v4.new_code_cell(code_3))

with open('E:\\github\\ohlcv\\notebook\\dynamic_architecture.ipynb', 'w') as f:
    nbf.write(nb, f)
