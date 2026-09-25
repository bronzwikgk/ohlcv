import nbformat as nbf
import os

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_3.ipynb', 'r') as f:
    nb = nbf.read(f, as_version=4)

new_code = """# Cell 3: Extracting and Saving JPEGs (Blazing Fast)
BLOCK_SIZE = 21

blocks_34 = []
blocks_21 = []

import numpy as np
import pandas as pd
import math
import random
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import os
from IPython.display import display, HTML

# Create output directory for JPEGs
os.makedirs('../output', exist_ok=True)

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
                
                anchor_close = df['Close'].iloc[i - BLOCK_SIZE]
                block['Log_Return_Pct'] = np.log(block['Close'] / anchor_close) * 100
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
                
                anchor_close = df['Close'].iloc[i - BLOCK_SIZE]
                block['Log_Return_Pct'] = np.log(block['Close'] / anchor_close) * 100
                blocks_21.append(block)

total_possible = sum([len(df) - BLOCK_SIZE for df in data_dict.values()])
summary_df = pd.DataFrame({
    "Regime": ["All Possible 21-Day Blocks", "Omega 34 > 50 & 14d Ret >= 3%", "Omega 21 > 50 & 14d Ret >= 3%"],
    "Total Blocks": [total_possible, len(blocks_34), len(blocks_21)]
})
display(HTML("<h3>Block Extraction Summary (Fast JPEG Mode)</h3>"))
display(summary_df)

def save_25_samples_rulebased(block_list, title, filename_prefix):
    if len(block_list) == 0: return
    sample_size = min(25, len(block_list))
    sample_blocks = random.sample(block_list, sample_size)
    
    returns_14d = []
    cdts_14d = []
    labels_text = []
    
    global_min_y = min([b['Log_Return_Pct'].min() for b in sample_blocks])
    global_max_y = max([b['Log_Return_Pct'].max() for b in sample_blocks])
    pad = (global_max_y - global_min_y) * 0.1
    ylim_min = global_min_y - pad
    ylim_max = global_max_y + pad
    
    for b in sample_blocks:
        returns_14d.append(b['Past_14_Return'].iloc[0])
        cdts_14d.append(b['CDT_14d'].iloc[0])
        labels_text.append(b['Symbol'].iloc[0])
        
    x_mid = np.median(returns_14d)
    y_mid = np.median(cdts_14d)
    
    x_spread = max(returns_14d) - min(returns_14d)
    y_spread = max(cdts_14d) - min(cdts_14d)
    
    center_x_min = x_mid - (x_spread * 0.15)
    center_x_max = x_mid + (x_spread * 0.15)
    center_y_min = y_mid - (y_spread * 0.15)
    center_y_max = y_mid + (y_spread * 0.15)
    
    def get_zone(ret, cdt):
        if center_x_min <= ret <= center_x_max and center_y_min <= cdt <= center_y_max:
            return 4 # Center (Average)
        elif ret >= x_mid and cdt <= y_mid:
            return 0 # Bottom-Right (Smooth Breakout)
        elif ret >= x_mid and cdt > y_mid:
            return 1 # Top-Right (Volatile Winner)
        elif ret < x_mid and cdt <= y_mid:
            return 2 # Bottom-Left (Quiet Drifter)
        else:
            return 3 # Top-Left (Dangerous Chop)
            
    zone_labels = []
    for i in range(len(sample_blocks)):
        zone_labels.append(get_zone(returns_14d[i], cdts_14d[i]))
        
    clusters_dict = {0: [], 1: [], 2: [], 3: [], 4: []}
    for i in range(len(sample_blocks)):
        clusters_dict[zone_labels[i]].append({
            'block': sample_blocks[i],
            'ret': returns_14d[i],
            'cdt': cdts_14d[i],
            'label': labels_text[i],
            'global_idx': i + 1
        })
        
    total_rows = sum([max(1, math.ceil(len(items)/3)) for items in clusters_dict.values()])
    
    colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']
    zone_names = [
        "Smooth Breakouts (Bot-Right)", 
        "Volatile Winners (Top-Right)", 
        "Quiet Drifters (Bot-Left)", 
        "Dangerous Chop (Top-Left)", 
        "Neutral Average (Center)"
    ]
    
    # 1) Generate and Save Grid
    fig, axes = plt.subplots(total_rows, 3, figsize=(15, 3.5 * total_rows))
    if total_rows == 1: axes = np.array([axes])
        
    current_row = 0
    for cluster_id in range(5):
        c_color = colors[cluster_id]
        cluster_items = clusters_dict[cluster_id]
        if len(cluster_items) == 0: continue
            
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
            
            ax.set_title(f"[#{idx}] {item['label']}", fontsize=11, color=c_color, weight='bold')
            ax.axhline(0, color='gray', linestyle='--', alpha=0.5)
            ax.set_ylim(ylim_min, ylim_max)
            ax.set_xticks([])
            ax.grid(True, alpha=0.3)
            
            if col_idx == 0:
                ax.set_ylabel(f"{zone_names[cluster_id]}\\nLog Ret %", fontsize=10, color=c_color, weight='bold')
                
            col_idx += 1
            
        while col_idx < 3:
            axes[current_row, col_idx].axis('off')
            col_idx += 1
            
        current_row += 1
                
    plt.suptitle(f"{title} - 5-Zone Rule Based Grouping", fontsize=18, y=1.01)
    plt.tight_layout()
    # SAVE AS JPEG INSTEAD OF SHOWING
    plt.savefig(f'../output/{filename_prefix}_grid.jpg', format='jpeg', bbox_inches='tight')
    plt.close(fig) # Prevent Jupyter from keeping the image in memory!
    
    # 2) Generate and Save Scatter Plot
    plt.figure(figsize=(12, 8))
    plt.axvline(x_mid, color='black', linestyle='--', alpha=0.5)
    plt.axhline(y_mid, color='black', linestyle='--', alpha=0.5)
    ax_scatter = plt.gca()
    center_box = patches.Rectangle((center_x_min, center_y_min), center_x_max - center_x_min, center_y_max - center_y_min, 
                                   linewidth=2, edgecolor='#8b5cf6', facecolor='#8b5cf6', alpha=0.2, label='Center Zone')
    ax_scatter.add_patch(center_box)
    
    for row in range(5):
        c_color = colors[row]
        cluster_items = clusters_dict[row]
        for item in cluster_items:
            plt.scatter(item['ret'], item['cdt'], color=c_color, s=150, alpha=0.9, edgecolor='black', zorder=5)
            plt.annotate(f"[#{item['global_idx']}] {item['label']}", (item['ret'], item['cdt']), xytext=(5, 5), textcoords='offset points', fontsize=9, weight='bold', zorder=6)
            
    plt.title(f'Rule-Based Zone Scatter Plot ({title})', fontsize=14)
    plt.xlabel('Past 14-Day Return (%) on Trigger Day', fontsize=12)
    plt.ylabel('Cumulative Dist Travelled (CDT) % on Trigger Day', fontsize=12)
    plt.text(x_mid + x_spread*0.05, y_mid - y_spread*0.05, 'Smooth Breakouts', color='#22c55e', weight='bold', fontsize=12, ha='left', va='top')
    plt.text(x_mid + x_spread*0.05, y_mid + y_spread*0.05, 'Volatile Winners', color='#3b82f6', weight='bold', fontsize=12, ha='left', va='bottom')
    plt.text(x_mid - x_spread*0.05, y_mid - y_spread*0.05, 'Quiet Drifters', color='#f59e0b', weight='bold', fontsize=12, ha='right', va='top')
    plt.text(x_mid - x_spread*0.05, y_mid + y_spread*0.05, 'Dangerous Chop', color='#ef4444', weight='bold', fontsize=12, ha='right', va='bottom')
    plt.grid(True, alpha=0.3)
    
    # SAVE AS JPEG INSTEAD OF SHOWING
    plt.savefig(f'../output/{filename_prefix}_scatter.jpg', format='jpeg', bbox_inches='tight')
    plt.close() # Close figure to free memory!

save_25_samples_rulebased(blocks_34, "Omega 34 > 50", "omega_34")
save_25_samples_rulebased(blocks_21, "Omega 21 > 50", "omega_21")
print("Finished saving JPEGs to E:/github/ohlcv/output/!")
"""

# Replace cell 3 with the fast savefig code
nb.cells[-1].source = new_code

# Add a new Markdown cell to load the JPEGs directly!
image_loader_cell = nbf.v4.new_markdown_cell("""## Omega 34 Results
<img src="../output/omega_34_grid.jpg" width="100%">
<img src="../output/omega_34_scatter.jpg" width="100%">

## Omega 21 Results
<img src="../output/omega_21_grid.jpg" width="100%">
<img src="../output/omega_21_scatter.jpg" width="100%">""")
nb.cells.append(image_loader_cell)

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_3.ipynb', 'w') as f:
    nbf.write(nb, f)
