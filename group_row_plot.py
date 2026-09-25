import nbformat as nbf
import numpy as np

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'r') as f:
    nb = nbf.read(f, as_version=4)

new_code = """# Cell 3: Extracting and Plotting 21-Day Blocks
BLOCK_SIZE = 21

blocks_34 = []
blocks_21 = []

import numpy as np

for symbol in selected_files:
    df = data_dict[symbol]
    
    for i in range(BLOCK_SIZE, len(df)):
        if df.iloc[i]['Omega_34_PR'] > 50:
            past_14_start = df.iloc[i - 13]['Close']
            past_14_end = df.iloc[i]['Close']
            past_14_return = ((past_14_end - past_14_start) / past_14_start) * 100
            
            if past_14_return >= 3.0:
                block = df.iloc[i - BLOCK_SIZE + 1 : i + 1].copy()
                block['Symbol'] = symbol
                block['Past_14_Return'] = past_14_return
                
                first_close = block['Close'].iloc[0]
                # Log returns % (centered at 0)
                block['Log_Return_Pct'] = np.log(block['Close'] / first_close) * 100
                blocks_34.append(block)
            
        if df.iloc[i]['Omega_21_PR'] > 50:
            past_14_start = df.iloc[i - 13]['Close']
            past_14_end = df.iloc[i]['Close']
            past_14_return = ((past_14_end - past_14_start) / past_14_start) * 100
            
            if past_14_return >= 3.0:
                block = df.iloc[i - BLOCK_SIZE + 1 : i + 1].copy()
                block['Symbol'] = symbol
                block['Past_14_Return'] = past_14_return
                
                first_close = block['Close'].iloc[0]
                block['Log_Return_Pct'] = np.log(block['Close'] / first_close) * 100
                blocks_21.append(block)

total_possible = sum([len(df) - BLOCK_SIZE for df in data_dict.values()])
summary_df = pd.DataFrame({
    "Regime": ["All Possible 21-Day Blocks", "Omega 34 > 50 & 14d Ret >= 3%", "Omega 21 > 50 & 14d Ret >= 3%"],
    "Total Blocks": [total_possible, len(blocks_34), len(blocks_21)]
})
from IPython.display import display, HTML
display(HTML("<h3>Block Extraction Summary</h3>"))
display(summary_df)

def plot_25_samples_clustered(block_list, title):
    if len(block_list) == 0: return
    sample_size = min(25, len(block_list))
    import random
    sample_blocks = random.sample(block_list, sample_size)
    
    returns_14d = []
    atrs_14d = []
    labels_text = []
    
    for b in sample_blocks:
        ret_14 = b['Past_14_Return'].iloc[0] 
        atr_14 = b['ATR_Pct'].iloc[-1]       
        
        returns_14d.append(ret_14)
        atrs_14d.append(atr_14)
        labels_text.append(b['Symbol'].iloc[0])
        
    from sklearn.cluster import KMeans
    X = np.column_stack((returns_14d, atrs_14d))
    kmeans = KMeans(n_clusters=4, random_state=42, n_init=10).fit(X)
    cluster_labels = kmeans.labels_
    centroids = kmeans.cluster_centers_
    
    # Group the blocks by their assigned cluster
    clusters_dict = {0: [], 1: [], 2: [], 3: []}
    for i in range(len(sample_blocks)):
        clusters_dict[cluster_labels[i]].append({
            'block': sample_blocks[i],
            'ret': returns_14d[i],
            'atr': atrs_14d[i],
            'label': labels_text[i],
            'global_idx': i + 1
        })
        
    # Find the max number of items in any single cluster to define grid columns
    max_cols = max([len(items) for items in clusters_dict.values()])
    max_cols = max(max_cols, 1) # avoid 0
    
    colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b']
    
    import matplotlib.pyplot as plt
    # 1 Row per cluster, max_cols columns
    fig, axes = plt.subplots(4, max_cols, figsize=(3.5 * max_cols, 4 * 4))
    
    # Ensure axes is 2D even if max_cols == 1
    if max_cols == 1:
        axes = axes.reshape(4, 1)
        
    for row in range(4):
        c_color = colors[row]
        cluster_items = clusters_dict[row]
        
        for col in range(max_cols):
            ax = axes[row, col]
            
            if col < len(cluster_items):
                item = cluster_items[col]
                block = item['block']
                idx = item['global_idx']
                
                days = range(1, BLOCK_SIZE + 1)
                ax.plot(days, block['Log_Return_Pct'], color='black', linewidth=1.5)
                end_val = block['Log_Return_Pct'].iloc[-1]
                ax.plot(days[-1], end_val, marker='o', markersize=8, color=c_color) 
                
                ax.set_title(f"[#{idx}] {item['label']} (C{row})", fontsize=11, color=c_color, weight='bold')
                ax.axhline(0, color='gray', linestyle='--', alpha=0.5) # Baseline is now 0%
                ax.set_xticks([])
                ax.grid(True, alpha=0.3)
                
                if col == 0:
                    ax.set_ylabel(f"Cluster {row}\\nLog Ret %", fontsize=12, color=c_color, weight='bold')
            else:
                ax.axis('off')
                
    plt.suptitle(f"{title} - Log Returns % (1 Row per Cluster)", fontsize=18, y=1.01)
    plt.tight_layout()
    plt.show()
    
    # 2) Scatter Plot
    plt.figure(figsize=(10, 6))
    for row in range(4):
        c_color = colors[row]
        cluster_items = clusters_dict[row]
        for item in cluster_items:
            plt.scatter(item['ret'], item['atr'], color=c_color, s=150, alpha=0.8, edgecolor='black')
            plt.annotate(f"[#{item['global_idx']}] {item['label']}", (item['ret'], item['atr']), xytext=(5, 5), textcoords='offset points', fontsize=9, weight='bold')
            
    plt.scatter(centroids[:, 0], centroids[:, 1], c='black', s=200, marker='X', label='Cluster Centers')
    plt.axvline(0, color='red', linestyle='--', alpha=0.3)
    plt.title(f'K-Means Scatter Plot using Past 14-Day Indicators ({title})', fontsize=14)
    plt.xlabel('Past 14-Day Return (%) on Trigger Day', fontsize=12)
    plt.ylabel('Past 14-Day ATR (%) on Trigger Day', fontsize=12)
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.show()

plot_25_samples_clustered(blocks_34, "Omega 34 > 50")
plot_25_samples_clustered(blocks_21, "Omega 21 > 50")
"""

nb.cells[-1].source = new_code
with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'w') as f:
    nbf.write(nb, f)
