import pandas as pd
import numpy as np
import os
from scipy.stats import linregress

def calc_linreg(series, period):
    lr_values = pd.Series(index=series.index, dtype=float)
    lr_slopes = pd.Series(index=series.index, dtype=float)
    x = np.arange(period)
    for i in range(period - 1, len(series)):
        y = series.iloc[i - period + 1 : i + 1].values
        slope, intercept, _, _, _ = linregress(x, y)
        lr_slopes.iloc[i] = slope
        lr_values.iloc[i] = slope * (period - 1) + intercept
    return lr_values, lr_slopes

def calc_roc(series, period=5):
    return series.pct_change(periods=period) * 100

def calc_rsi(series, period=5):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def test_stock(filepath):
    df = pd.read_csv(filepath)
    if 'Date' in df.columns:
        df['time'] = pd.to_datetime(df['Date'])
    elif 'time' in df.columns:
        df['time'] = pd.to_datetime(df['time'])
    else:
        return 0, 0, 0, 0, []
    df = df.sort_values('time').reset_index(drop=True)
    
    # Calculate total years of data
    if len(df) > 0:
        years = (df['time'].iloc[-1] - df['time'].iloc[0]).days / 365.25
    else:
        years = 1
    
    if years == 0: years = 1
    
    df['lr_8_fit'], df['lr_8_slope'] = calc_linreg(df['Close'], 8)
    df['lr_8_roc'] = calc_roc(df['lr_8_fit'], 5)
    df['lr_8_accel'] = df['lr_8_roc'].diff()
    df['rsi_5'] = calc_rsi(df['Close'], 5)
    
    # Momentum Burst Rules
    new_high = df['Close'] == df['Close'].rolling(20).max()
    roc_strong = df['lr_8_roc'] > 4
    accel_positive = df['lr_8_accel'] > 0
    rsi_zone = (df['rsi_5'] > 60) & (df['rsi_5'] < 75)
    
    df['entry_signal'] = new_high & roc_strong & accel_positive & rsi_zone
    
    trade_returns = []
    
    trade_records = []
    in_trade = False
    entry_price = 0
    entry_time = None
    days_held = 0
    
    for i in range(20, len(df)):
        if not in_trade:
            if df.loc[i, 'entry_signal']:
                in_trade = True
                entry_price = df.loc[i, 'Close']
                entry_time = df.loc[i, 'time'].strftime('%Y-%m-%d')
                days_held = 0
        else:
            days_held += 1
            # Hit-and-Run Exit Logic
            if df.loc[i, 'rsi_5'] > 80 or days_held >= 4 or (df.loc[i, 'Close'] < entry_price * 0.97):
                exit_price = df.loc[i, 'Close']
                exit_time = df.loc[i, 'time'].strftime('%Y-%m-%d')
                if entry_price > 0 and not pd.isna(exit_price) and not pd.isna(entry_price):
                    trade_returns.append(exit_price / entry_price - 1)
                    trade_records.append({
                        'entry_time': entry_time,
                        'entry_price': entry_price,
                        'exit_time': exit_time,
                        'exit_price': exit_price,
                        'profit': exit_price / entry_price - 1
                    })
                in_trade = False

    if len(trade_returns) == 0:
        return 0, 0, 0, 0, []
        
    trades = np.array(trade_returns)
    trades = trades[~np.isnan(trades)] # Remove NaNs just in case
    
    if len(trades) == 0:
        return 0, 0, 0, 0, []
        
    win_rate = (trades > 0).mean() * 100
    avg_ret = trades.mean() * 100
    trades_per_year = len(trades) / years
    
    return len(trades), win_rate, avg_ret, trades_per_year, trade_records

if __name__ == '__main__':
    data_dir = r"E:\github\ohlcv\data\market\nse\mstock"
    stocks = ['ABREL.csv', 'AAVAS.csv', 'AJANTPHARM.csv', 'RELIANCE.csv', 'HDFCBANK.csv']
    print("Testing Strategy: Momentum Burst Breakout")
    print(f"{'Stock':<15} | {'Trades':<8} | {'Win Rate':<10} | {'Avg Return':<12} | {'Trades/Yr':<10}")
    print("-" * 75)
    
    total_trades = 0
    total_wins = 0
    sum_rets = 0
    total_tpy = 0
    
    all_trades = {}
    
    for s in stocks:
        fp = os.path.join(data_dir, s)
        stock_name = s.replace('.csv', '')
        trades, wr, ret, tpy, records = test_stock(fp)
        if trades > 0:
            all_trades[stock_name] = records
            print(f"{stock_name:<15} | {trades:<8} | {wr:<9.1f}% | {ret:<10.2f}% | {tpy:<9.1f}")
            total_trades += trades
            total_wins += trades * (wr / 100)
            sum_rets += trades * ret
            total_tpy += tpy
            
    if total_trades > 0:
        print("-" * 75)
        print(f"{'TOTAL/AVG':<15} | {total_trades:<8} | {(total_wins/total_trades)*100:<9.1f}% | {sum_rets/total_trades:<10.2f}% | {total_tpy/len(stocks):<9.1f}")
        
    import json
    out_path = r"E:\github\ohlcv\ohlcv_app\strategy_burst_trades.json"
    with open(out_path, 'w') as f:
        json.dump(all_trades, f)
    print(f"Saved {total_trades} trades to {out_path}")
