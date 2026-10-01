import os
import json
import re

d = r'D:\0dot1_Aug_2016_master\data\mstock_mtf_daily_data'
jsonl_file = r'E:\github\ohlcv\data_list\tickers.jsonl'
html_file = r'E:\github\ohlcv\chart_outline.html'

files = [f.replace('.csv','') for f in os.listdir(d) if f.endswith('.csv')]
files.sort()

# Write JSONL
with open(jsonl_file, 'w', encoding='utf-8') as f:
    for ticker in files:
        f.write(json.dumps({"ticker": ticker}) + '\n')

with open(html_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace static tickers with container
pattern = re.compile(r'(<summary>Tickers</summary>\s*<form>\s*<input type="search" placeholder="Search...">\n).*?(?=\s*</form>)', re.DOTALL)
new_content = pattern.sub(r'\1                <div id="ticker-list-container"><span style="padding: 8px;">Loading...</span></div>\n', content)

# Add JS fetch logic
script_tag = """
    <script>
        document.addEventListener('DOMContentLoaded', async () => {
            try {
                // Fetch the JSONL file
                const response = await fetch('data_list/tickers.jsonl');
                if (!response.ok) throw new Error('Network response was not ok');
                
                const text = await response.text();
                const container = document.getElementById('ticker-list-container');
                container.innerHTML = ''; // Clear 'Loading...'
                
                const lines = text.split('\\n');
                const fragment = document.createDocumentFragment();
                
                lines.forEach(line => {
                    if(!line.trim()) return;
                    try {
                        const data = JSON.parse(line);
                        const label = document.createElement('label');
                        label.innerHTML = `<input type="checkbox" name="stock" value="${data.ticker}"> ${data.ticker}`;
                        fragment.appendChild(label);
                    } catch(e) {
                        console.error("Parse error on line:", line);
                    }
                });
                
                container.appendChild(fragment);
                
                // Add basic search functionality to the input
                const searchInput = container.parentElement.querySelector('input[type="search"]');
                searchInput.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    container.querySelectorAll('label').forEach(label => {
                        const text = label.textContent.toLowerCase();
                        label.style.display = text.includes(term) ? 'flex' : 'none';
                    });
                });

            } catch(error) {
                console.error("Error loading tickers:", error);
                const container = document.getElementById('ticker-list-container');
                if(container) {
                    container.innerHTML = '<span style="padding: 8px; color: red;">Failed to load tickers. (Running via file:// instead of http://?)</span>';
                }
            }
        });
    </script>
</body>"""

if '<script>' not in new_content:
    new_content = new_content.replace('</body>', script_tag)

with open(html_file, 'w', encoding='utf-8') as f:
    f.write(new_content)
