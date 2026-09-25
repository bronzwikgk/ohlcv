import nbformat as nbf

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'r') as f:
    nb = nbf.read(f, as_version=4)

code3_source = nb.cells[-1].source

# Add code to plot the total scatter plots at the very end
total_scatter_code = """
def plot_total_scatter(block_list, title):
    if len(block_list) == 0: return
    returns = []
    atrs = []
    
    for b in block_list:
        start = b['Close'].iloc[0]
        end = b['Close'].iloc[-1]
        ret = (end - start) / start * 100
        atr = b['ATR_Pct'].iloc[-1]
        returns.append(ret)
        atrs.append(atr)
        
    plt.figure(figsize=(10, 6))
    plt.scatter(returns, atrs, color='#8b5cf6', s=20, alpha=0.3, edgecolor='none')
    
    plt.axvline(0, color='red', linestyle='--', alpha=0.5)
    plt.title(f'Total Universe Scatter Plot: All {len(block_list)} Blocks ({title})', fontsize=14)
    plt.xlabel('21-Day Return (%)', fontsize=12)
    plt.ylabel('ATR Pct (%) on Day 21', fontsize=12)
    plt.grid(True, alpha=0.3)
    plt.show()

plot_total_scatter(blocks_34, "Omega 34 > 50")
plot_total_scatter(blocks_21, "Omega 21 > 50")
"""

if "def plot_total_scatter" not in code3_source:
    nb.cells[-1].source = code3_source + "\n" + total_scatter_code

# Also update the summary table to show the absolute total possible blocks
if "total_possible =" not in nb.cells[-1].source:
    new_source = nb.cells[-1].source.replace(
        'summary_df = pd.DataFrame({\n    "Regime": ["Omega 34 > 50", "Omega 21 > 50"],\n    "Total 21-Day Blocks": [len(blocks_34), len(blocks_21)]\n})',
        'total_possible = sum([len(df) - BLOCK_SIZE for df in data_dict.values()])\nsummary_df = pd.DataFrame({\n    "Regime": ["All Possible 21-Day Blocks (No Filter)", "Omega 34 > 50", "Omega 21 > 50"],\n    "Total Blocks": [total_possible, len(blocks_34), len(blocks_21)]\n})'
    )
    nb.cells[-1].source = new_source

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'w') as f:
    nbf.write(nb, f)
