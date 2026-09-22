import json

notebook_path = r"E:\github\ohlcv\notebook\supply_demand_strategy.ipynb"
with open(notebook_path, 'r', encoding='utf-8') as f:
    nb = json.load(f)

# Find the plotting cell
for cell in nb['cells']:
    if cell['cell_type'] == 'code' and 'def plot_candles_with_zones' in ''.join(cell['source']):
        source = ''.join(cell['source'])
        # Replace head with tail to get the most recent zones instead of the oldest ones
        source = source.replace(".head(max_zones)", ".tail(max_zones)")
        cell['source'] = [line + '\n' for line in source.split('\n')][:-1]

with open(notebook_path, 'w', encoding='utf-8') as f:
    json.dump(nb, f, indent=1)
