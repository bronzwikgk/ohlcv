import nbformat as nbf
import math

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_2.ipynb', 'r') as f:
    nb = nbf.read(f, as_version=4)

new_code = """# Cell 3: Extracting and Plotting 21-Day Blocks
BLOCK_SIZE = 21

blocks_34 = []
blocks_21 = []

import numpy as np
import pandas as pd
import math
import random
from sklearn.cluster import KMeans
import matplotlib.pyplot as plt
from IPython.display import display, HTML

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
                
                past_14_close = df['Close'].iloc[i - 13 : i + 1]
                block['CDT_14d'] = past_14_close.pct_change().abs().sum() * 100
                
                first_close = block['Close'].iloc[0]
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
                
                past_14_close = df['Close'].iloc[i - 13 : i + 1]
                block['CDT_14d'] = past_14_close.pct_change().abs().sum() * 100
                
                first_close = block['Close'].iloc[0]
                block['Log_Return_Pct'] = np.log(block['Close'] / first_close) * 100
                blocks_21.append(block)

total_possible = sum([len(df) - BLOCK_SIZE for df in data_dict.values()])
summary_df = pd.DataFrame({
    "Regime": ["All Possible 21-Day Blocks", "Omega 34 > 50 & 14d Ret >= 3%", "Omega 21 > 50 & 14d Ret >= 3%"],
    "Total Blocks": [total_possible, len(blocks_34), len(blocks_21)]
})
display(HTML("<h3>Block Extraction Summary (CDT 14d Version)</h3>"))
display(summary_df)

def plot_25_samples_clustered(block_list, title):
    if len(block_list) == 0: return
    sample_size = min(25, len(block_list))
    sample_blocks = random.sample(block_list, sample_size)
    
    returns_14d = []
    cdts_14d = []
    labels_text = []
    
    # Calculate global min/max for standardized Y axis
    global_min_y = min([b['Log_Return_Pct'].min() for b in sample_blocks])
    global_max_y = max([b['Log_Return_Pct'].max() for b in sample_blocks])
    pad = (global_max_y - global_min_y) * 0.1
    ylim_min = global_min_y - pad
    ylim_max = global_max_y + pad
    
    for b in sample_blocks:
        ret_14 = b['Past_14_Return'].iloc[0] 
        cdt_14 = b['CDT_14d'].iloc[0]       
        
        returns_14d.append(ret_14)
        cdts_14d.append(cdt_14)
        labels_text.append(b['Symbol'].iloc[0])
        
    X = np.column_stack((returns_14d, cdts_14d))
    kmeans = KMeans(n_clusters=4, random_state=42, n_init=10).fit(X)
    cluster_labels = kmeans.labels_
    centroids = kmeans.cluster_centers_
    
    # Group the blocks by their assigned cluster
    clusters_dict = {0: [], 1: [], 2: [], 3: []}
    for i in range(len(sample_blocks)):
        clusters_dict[cluster_labels[i]].append({
            'block': sample_blocks[i],
            'ret': returns_14d[i],
            'cdt': cdts_14d[i],
            'label': labels_text[i],
            'global_idx': i + 1
        })
        
    total_rows = sum([max(1, math.ceil(len(items)/3)) for items in clusters_dict.values()])
    
    colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b']
    
    fig, axes = plt.subplots(total_rows, 3, figsize=(15, 3.5 * total_rows))
    
    if total_rows == 1:
        axes = np.array([axes])
        
    current_row = 0
    
    for cluster_id in range(4):
        c_color = colors[cluster_id]
        cluster_items = clusters_dict[cluster_id]
        
        if len(cluster_items) == 0:
            for col in range(3):
                axes[current_row, col].axis('off')
            current_row += 1
            continue
            
        col_idx = 0
        for i, item in enumerate(cluster_items):
            if col_idx == 3:
                col_idx = 0
                current_row += 1
                
            ax = axes[current_row, col_idx]
            block = item['block']
            idx = item['global_idx']
            
            days = range(1, BLOCK_SIZE + 1)
            ax.plot(days, block['Log_Return_Pct'], color='black', linewidth=1.5)
            end_val = block['Log_Return_Pct'].iloc[-1]
            ax.plot(days[-1], end_val, marker='o', markersize=8, color=c_color) 
            
            ax.set_title(f"[#{idx}] {item['label']} (C{cluster_id})", fontsize=11, color=c_color, weight='bold')
            ax.axhline(0, color='gray', linestyle='--', alpha=0.5)
            ax.set_ylim(ylim_min, ylim_max)
            ax.set_xticks([])
            ax.grid(True, alpha=0.3)
            
            if col_idx == 0:
                ax.set_ylabel(f"Cluster {cluster_id}\\nLog Ret %", fontsize=12, color=c_color, weight='bold')
                
            col_idx += 1
            
        # Turn off remaining axes in this row
        while col_idx < 3:
            axes[current_row, col_idx].axis('off')
            col_idx += 1
            
        current_row += 1
                
    plt.suptitle(f"{title} - Log Returns % (Standardized Y-Axis)", fontsize=18, y=1.01)
    plt.tight_layout()
    plt.show()
    
    # 2) Scatter Plot
    plt.figure(figsize=(10, 6))
    for row in range(4):
        c_color = colors[row]
        cluster_items = clusters_dict[row]
        for item in cluster_items:
            plt.scatter(item['ret'], item['cdt'], color=c_color, s=150, alpha=0.8, edgecolor='black')
            plt.annotate(f"[#{item['global_idx']}] {item['label']}", (item['ret'], item['cdt']), xytext=(5, 5), textcoords='offset points', fontsize=9, weight='bold')
            
    plt.scatter(centroids[:, 0], centroids[:, 1], c='black', s=200, marker='X', label='Cluster Centers')
    plt.axvline(0, color='red', linestyle='--', alpha=0.3)
    plt.title(f'K-Means Scatter Plot using Past 14-Day Indicators ({title})', fontsize=14)
    plt.xlabel('Past 14-Day Return (%) on Trigger Day', fontsize=12)
    plt.ylabel('Cumulative Dist Travelled (CDT) % on Trigger Day', fontsize=12)
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.show()

plot_25_samples_clustered(blocks_34, "Omega 34 > 50")
plot_25_samples_clustered(blocks_21, "Omega 21 > 50")
"""

nb.cells[-1].source = new_code
with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_2.ipynb', 'w') as f:
    nbf.write(nb, f)
