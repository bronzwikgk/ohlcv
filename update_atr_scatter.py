import nbformat as nbf
import re

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'r') as f:
    nb = nbf.read(f, as_version=4)

# 1. Inject ATR calculation into Cell 1
cell1 = nb.cells[1].source

if "def calc_atr_and_adx" not in cell1:
    atr_func = """def calc_atr_and_adx(df, period=14):
    high = df['High']
    low = df['Low']
    close = df['Close']
    tr1 = high - low
    tr2 = (high - close.shift()).abs()
    tr3 = (low - close.shift()).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    df['ATR_14'] = tr.rolling(period).mean()
    df['ATR_Pct'] = (df['ATR_14'] / close) * 100
    return df

def calc_omega_pr"""
    cell1 = cell1.replace("def calc_omega_pr", atr_func)
    cell1 = cell1.replace("df['Date'] = pd.to_datetime(df['Date'])", "df['Date'] = pd.to_datetime(df['Date'])\n        df = calc_atr_and_adx(df)")
    nb.cells[1].source = cell1


# 2. Rewrite Cell 3 (The plotting cell)
code3_source = """# Cell 3: Extracting and Plotting 21-Day Blocks
BLOCK_SIZE = 21

blocks_34 = []
blocks_21 = []

for symbol in selected_files:
    df = data_dict[symbol]
    
    for i in range(BLOCK_SIZE, len(df)):
        if df.iloc[i]['Omega_34_PR'] > 50:
            block = df.iloc[i - BLOCK_SIZE + 1 : i + 1].copy()
            block['Symbol'] = symbol
            first_close = block['Close'].iloc[0]
            block['Normalized_Close'] = (block['Close'] / first_close) * 100
            blocks_34.append(block)
            
        if df.iloc[i]['Omega_21_PR'] > 50:
            block = df.iloc[i - BLOCK_SIZE + 1 : i + 1].copy()
            block['Symbol'] = symbol
            first_close = block['Close'].iloc[0]
            block['Normalized_Close'] = (block['Close'] / first_close) * 100
            blocks_21.append(block)

summary_df = pd.DataFrame({
    "Regime": ["Omega 34 > 50", "Omega 21 > 50"],
    "Total 21-Day Blocks": [len(blocks_34), len(blocks_21)]
})
from IPython.display import display, HTML
display(HTML("<h3>Block Extraction Summary</h3>"))
display(summary_df)

def plot_blocks_with_atr_and_scatter(block_list, title):
    if len(block_list) == 0: return
    sample_size = min(25, len(block_list))
    sample_blocks = random.sample(block_list, sample_size)
    
    # 1) Grid Plot with Price and ATR
    fig, axes = plt.subplots(10, 5, figsize=(22, 28), gridspec_kw={'height_ratios': [3, 1]*5})
    
    for i in range(25):
        row = (i // 5) * 2
        col = i % 5
        
        ax_price = axes[row, col]
        ax_atr = axes[row+1, col]
        
        if i < len(sample_blocks):
            block = sample_blocks[i]
            days = range(1, BLOCK_SIZE + 1)
            
            # Price Plot
            ax_price.plot(days, block['Normalized_Close'], color='black', linewidth=1.5)
            end_val = block['Normalized_Close'].iloc[-1]
            color = '#22c55e' if end_val > 100 else '#ef4444'
            ax_price.plot(days[-1], end_val, marker='o', markersize=6, color=color)
            ax_price.set_title(f"{block['Symbol'].iloc[0]} ({block['Date'].iloc[-1].strftime('%y-%m-%d')})", fontsize=10)
            ax_price.axhline(100, color='gray', linestyle='--', alpha=0.5)
            ax_price.set_xticks([])
            ax_price.grid(True, alpha=0.3)
            
            # ATR Plot
            ax_atr.plot(days, block['ATR_Pct'], color='#f59e0b', linewidth=1.5)
            ax_atr.set_xticks([])
            ax_atr.grid(True, alpha=0.3)
            ax_atr.set_ylabel("ATR%", fontsize=8)
        else:
            ax_price.axis('off')
            ax_atr.axis('off')
            
    plt.suptitle(f"{title} - Price & ATR Panels", fontsize=18, y=1.01)
    plt.tight_layout()
    plt.show()
    
    # 2) Scatter Plot for these 25 samples
    returns = []
    atrs = []
    labels = []
    for b in sample_blocks:
        start = b['Close'].iloc[0]
        end = b['Close'].iloc[-1]
        ret = (end - start) / start * 100
        atr = b['ATR_Pct'].iloc[-1]
        returns.append(ret)
        atrs.append(atr)
        labels.append(b['Symbol'].iloc[0])
        
    plt.figure(figsize=(10, 6))
    plt.scatter(returns, atrs, color='#3b82f6', s=120, alpha=0.7, edgecolor='black')
    
    for i, label in enumerate(labels):
        plt.annotate(label, (returns[i], atrs[i]), xytext=(5, 5), textcoords='offset points', fontsize=8, alpha=0.7)
        
    plt.axvline(0, color='red', linestyle='--', alpha=0.3)
    plt.title(f'Scatter Plot of the 25 Sampled Blocks ({title})', fontsize=14)
    plt.xlabel('21-Day Return (%)', fontsize=12)
    plt.ylabel('ATR Pct (%) on Day 21', fontsize=12)
    plt.grid(True, alpha=0.3)
    plt.show()

plot_blocks_with_atr_and_scatter(blocks_34, "Omega 34 > 50")
plot_blocks_with_atr_and_scatter(blocks_21, "Omega 21 > 50")
"""

nb.cells[-1].source = code3_source

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'w') as f:
    nbf.write(nb, f)
