from flask import Flask, jsonify, render_template, request
import pandas as pd
import numpy as np
import os
import glob

app = Flask(__name__)
DATA_DIR = r'D:\0dot1_Aug_2016_master\data\mstock_mtf_daily_data'

def calculate_dynamic_regime(data, target=0.50):
    data = data.copy()
    data['abs_ret'] = data['Close'].pct_change().abs()
    
    lookbacks = []
    distance_travelled = []
    efficiency = []
    
    abs_rets = data['abs_ret'].values
    closes = data['Close'].values
    
    for i in range(len(data)):
        if i == 0 or np.isnan(abs_rets[i]):
            lookbacks.append(np.nan)
            distance_travelled.append(np.nan)
            efficiency.append(np.nan)
            continue
            
        cum_sum = 0
        j = i
        while j >= 0 and cum_sum < target:
            if not np.isnan(abs_rets[j]):
                cum_sum += abs_rets[j]
            j -= 1
            
        if cum_sum < target:
            lookbacks.append(np.nan)
            distance_travelled.append(np.nan)
            efficiency.append(np.nan)
        else:
            n_days = i - j
            lookbacks.append(n_days)
            net_return = (closes[i] - closes[j]) / closes[j]
            distance_travelled.append(net_return)
            eff = net_return / cum_sum
            efficiency.append(eff)
            
    data['dynamic_lookback'] = lookbacks
    data['distance_travelled'] = distance_travelled
    data['efficiency_ratio'] = efficiency
    return data

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/stocks')
def get_stocks():
    files = glob.glob(os.path.join(DATA_DIR, '*.csv'))
    # Extract just the filename without extension
    stocks = [os.path.basename(f).replace('.csv', '') for f in files]
    return jsonify(sorted(stocks))

@app.route('/api/data/<symbol>')
def get_data(symbol):
    file_path = os.path.join(DATA_DIR, f"{symbol}.csv")
    if not os.path.exists(file_path):
        return jsonify({'error': 'Stock not found'}), 404
        
    try:
        df = pd.read_csv(file_path)
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.sort_values('Date').reset_index(drop=True)
        
        # Calculate the dynamic regime across the ENTIRE history
        # This completely eliminates the "warm-up" bias!
        df_processed = calculate_dynamic_regime(df, target=0.50)
        
        # We need to drop NaNs in the dates, but JSON can't handle NaNs well
        df_processed = df_processed.replace({np.nan: None})
        
        # Format date for JSON
        df_processed['Date'] = df_processed['Date'].dt.strftime('%Y-%m-%d')
        
        # Return the lists for plotting
        return jsonify({
            'dates': df_processed['Date'].tolist(),
            'close': df_processed['Close'].tolist(),
            'distance_travelled': df_processed['distance_travelled'].tolist(),
            'efficiency_ratio': df_processed['efficiency_ratio'].tolist()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
