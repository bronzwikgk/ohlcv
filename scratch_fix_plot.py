import json

notebook_path = r"E:\github\ohlcv\notebook\supply_demand_strategy.ipynb"
with open(notebook_path, 'r', encoding='utf-8') as f:
    nb = json.load(f)

# Find the plotting cell
for cell in nb['cells']:
    if cell['cell_type'] == 'code' and 'def plot_candles_with_zones' in ''.join(cell['source']):
        source = ''.join(cell['source'])
        # Replace created_idx with end_idx for plotting the start of the box
        source = source.replace("x0 = max(0, int(z['created_idx'] - min_original_idx))", 
                                "x0 = max(0, int(z['end_idx'] - min_original_idx))")
        cell['source'] = [line + '\n' for line in source.split('\n')][:-1]

with open(notebook_path, 'w', encoding='utf-8') as f:
    json.dump(nb, f, indent=1)
