import nbformat as nbf

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'r') as f:
    nb = nbf.read(f, as_version=4)

new_code2 = """# Plot only Price with extracted 21-Day Blocks marked
fig, axes = plt.subplots(len(selected_files), 1, figsize=(15, 6 * len(selected_files)))
if len(selected_files) == 1: axes = [axes]

for i, symbol in enumerate(selected_files):
    df = data_dict[symbol]
    ax = axes[i]
    
    # --- Price Plot ---
    ax.plot(df['Date'], df['Close'], color='black', linewidth=1.5, label='Close')
    ax.plot(df['Date'], df['EMA_8'], color='#3b82f6', linewidth=1, alpha=0.8, label='EMA 8')
    ax.plot(df['Date'], df['EMA_21'], color='#10b981', linewidth=1, alpha=0.8, label='EMA 21')
    ax.plot(df['Date'], df['EMA_55'], color='#f59e0b', linewidth=1.5, alpha=0.9, label='EMA 55')
    ax.plot(df['Date'], df['EMA_144'], color='#ef4444', linewidth=1.5, alpha=0.9, label='EMA 144')
    
    # Find all the valid blocks for Omega 34 to highlight
    BLOCK_SIZE = 21
    for j in range(BLOCK_SIZE, len(df)):
        if df.iloc[j]['Omega_34_PR'] > 50:
            past_14_start = df.iloc[j - 13]['Close']
            past_14_end = df.iloc[j]['Close']
            past_14_return = ((past_14_end - past_14_start) / past_14_start) * 100
            
            if past_14_return >= 3.0:
                start_date = df['Date'].iloc[j - BLOCK_SIZE + 1]
                end_date = df['Date'].iloc[j]
                # Draw a light yellow shaded box for the valid block
                ax.axvspan(start_date, end_date, color='#fef08a', alpha=0.3, lw=0)
                # Mark the exact start and end with vertical lines
                ax.axvline(start_date, color='gray', linestyle=':', alpha=0.5)
                ax.axvline(end_date, color='blue', linestyle='--', alpha=0.5)

    ax.set_title(f'{symbol} - Full Price Action with Extracted Omega 34 Blocks Highlighted (Yellow)')
    ax.legend(loc='upper left')
    ax.grid(True, alpha=0.3)
    ax.tick_params(axis='x', rotation=45)

plt.tight_layout()
plt.show()
"""

nb.cells[2].source = new_code2

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_1.ipynb', 'w') as f:
    nbf.write(nb, f)
