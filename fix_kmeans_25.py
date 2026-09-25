import nbformat as nbf
import re

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'r') as f:
    nb = nbf.read(f, as_version=4)

new_code = """# Cell 3: Extracting and Plotting 21-Day Blocks
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

total_possible = sum([len(df) - BLOCK_SIZE for df in data_dict.values()])
summary_df = pd.DataFrame({
    "Regime": ["All Possible 21-Day Blocks", "Omega 34 > 50", "Omega 21 > 50"],
    "Total Blocks": [total_possible, len(blocks_34), len(blocks_21)]
})
from IPython.display import display, HTML
display(HTML("<h3>Block Extraction Summary</h3>"))
display(summary_df)

def plot_25_samples_clustered(block_list, title):
    if len(block_list) == 0: return
    sample_size = min(25, len(block_list))
    sample_blocks = random.sample(block_list, sample_size)
    
    returns = []
    atrs = []
    labels_text = []
    
    for b in sample_blocks:
        start = b['Close'].iloc[0]
        end = b['Close'].iloc[-1]
        ret = (end - start) / start * 100
        atr = b['ATR_Pct'].iloc[-1]
        returns.append(ret)
        atrs.append(atr)
        labels_text.append(b['Symbol'].iloc[0])
        
    from sklearn.cluster import KMeans
    import numpy as np
    X = np.column_stack((returns, atrs))
    kmeans = KMeans(n_clusters=4, random_state=42, n_init=10).fit(X)
    cluster_labels = kmeans.labels_
    centroids = kmeans.cluster_centers_
    
    # Color map for the 4 clusters
    colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b']
    
    # 1) Grid Plot with Price and ATR
    fig, axes = plt.subplots(10, 5, figsize=(22, 28), gridspec_kw={'height_ratios': [3, 1]*5})
    
    for i in range(25):
        row = (i // 5) * 2
        col = i % 5
        
        ax_price = axes[row, col]
        ax_atr = axes[row+1, col]
        
        if i < len(sample_blocks):
            block = sample_blocks[i]
            cluster = cluster_labels[i]
            c_color = colors[cluster % 4]
            
            days = range(1, BLOCK_SIZE + 1)
            
            ax_price.plot(days, block['Normalized_Close'], color='black', linewidth=1.5)
            end_val = block['Normalized_Close'].iloc[-1]
            # Plot the final dot using the Cluster's color
            ax_price.plot(days[-1], end_val, marker='o', markersize=8, color=c_color) 
            
            ax_price.set_title(f"[#{i+1}] {block['Symbol'].iloc[0]} (C{cluster})", fontsize=11, color=c_color, weight='bold')
            ax_price.axhline(100, color='gray', linestyle='--', alpha=0.5)
            ax_price.set_xticks([])
            ax_price.grid(True, alpha=0.3)
            
            ax_atr.plot(days, block['ATR_Pct'], color='#94a3b8', linewidth=1.5)
            ax_atr.set_xticks([])
            ax_atr.grid(True, alpha=0.3)
            ax_atr.set_ylabel("ATR%", fontsize=8)
        else:
            ax_price.axis('off')
            ax_atr.axis('off')
            
    plt.suptitle(f"{title} - Price & ATR Panels (Color Coded by K-Means Cluster)", fontsize=18, y=1.01)
    plt.tight_layout()
    plt.show()
    
    # 2) Scatter Plot for just these 25 samples
    plt.figure(figsize=(10, 6))
    
    for i in range(len(returns)):
        c_color = colors[cluster_labels[i] % 4]
        plt.scatter(returns[i], atrs[i], color=c_color, s=150, alpha=0.8, edgecolor='black')
        plt.annotate(f"[#{i+1}] {labels_text[i]}", (returns[i], atrs[i]), xytext=(5, 5), textcoords='offset points', fontsize=9, weight='bold')
        
    plt.scatter(centroids[:, 0], centroids[:, 1], c='black', s=200, marker='X', label='Cluster Centers')
        
    plt.axvline(0, color='red', linestyle='--', alpha=0.3)
    plt.title(f'K-Means Scatter Plot of the 25 Sampled Blocks ({title})', fontsize=14)
    plt.xlabel('21-Day Return (%)', fontsize=12)
    plt.ylabel('ATR Pct (%) on Day 21', fontsize=12)
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.show()

plot_25_samples_clustered(blocks_34, "Omega 34 > 50")
plot_25_samples_clustered(blocks_21, "Omega 21 > 50")
"""

nb.cells[-1].source = new_code
with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'w') as f:
    nbf.write(nb, f)
