import re
import json

# Fix python script
with open('E:\\github\\ohlcv\\notebook\\omega_backtest.py', 'r', encoding='utf-8') as f:
    py_content = f.read()

py_content = py_content.replace('const chartData = {json.dumps(all_chart_data)};', "const chartData = ''' + json.dumps(all_chart_data) + ''';")

# Ensure it didn't mess up
with open('E:\\github\\ohlcv\\notebook\\omega_backtest.py', 'w', encoding='utf-8') as f:
    f.write(py_content)

# Fix HTML report directly so user sees it now
with open('E:\\github\\ohlcv\\output\\omega_backtest_report.html', 'r', encoding='utf-8') as f:
    html_content = f.read()

# Since the python script failed to dump the JSON, we need to run python to actually load the data.
# Or better yet, we just re-run the python script to regenerate the HTML properly!
