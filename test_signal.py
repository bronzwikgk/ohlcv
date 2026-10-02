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
        return 0, 0, 0, 0
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
    
    # User Requested Rules:
    cross_zero = (df['lr_8_roc'] > 0) & (df['lr_8_roc'].shift(1) <= 0)
    
    # 1. Simple Pullback Filter
    df['valley'] = df['lr_8_roc'].rolling(15).min()
    valid_valley = df['valley'] < -2
    
    # Feature engineering for analysis and filters
    df['vol_sma_20'] = df['Volume'].rolling(20).mean()
    df['vol_ratio'] = df['Volume'] / df['vol_sma_20']
    df['sma_50'] = df['Close'].rolling(50).mean()
    df['dist_sma_50'] = (df['Close'] / df['sma_50']) - 1
    
    # 2. Simple Macro Uptrend with EXHAUSTION CEILING
    # Must be > 0 (in uptrend) but < 9% extended (avoid blow-off tops)
    macro_uptrend = (df['dist_sma_50'] > 0) & (df['dist_sma_50'] < 0.09)
    
    # 3. Volume Ceiling (Avoid psychotic volume spikes indicative of institutional dumping)
    vol_ceiling = df['vol_ratio'] < 1.5
    
    # Simple, logical rules
    df['entry_signal'] = cross_zero & valid_valley & macro_uptrend & vol_ceiling
    
    trade_returns = []
    
    trade_records = []
    in_trade = False
    entry_price = 0
    entry_time = None
    days_held = 0
    
    for i in range(15, len(df)):
        if not in_trade:
            if df.loc[i, 'entry_signal']:
                in_trade = True
                entry_price = df.loc[i, 'Close']
                entry_time = df.loc[i, 'time'].strftime('%Y-%m-%d')
                days_held = 0
                lowest_price = entry_price
                
                # Snapshot features exactly at time of ENTRY
                trade_entry_rsi = df.loc[i, 'rsi_5']
                trade_entry_valley = df.loc[i, 'valley']
                trade_entry_vol_ratio = df.loc[i, 'vol_ratio']
                trade_entry_dist_sma_50 = df.loc[i, 'dist_sma_50']
        else:
            days_held += 1
            if 'Low' in df.columns:
                lowest_price = min(lowest_price, df.loc[i, 'Low'])
            else:
                lowest_price = min(lowest_price, df.loc[i, 'Close'])
            exit_reason = None
            if df.loc[i, 'Close'] < entry_price * 0.97:
                exit_reason = 'stop_loss'
            elif df.loc[i, 'rsi_5'] > 65:
                exit_reason = 'take_profit'
            elif days_held >= 8:
                exit_reason = 'time_out'
                
            if exit_reason:
                exit_price = df.loc[i, 'Close']
                exit_time = df.loc[i, 'time'].strftime('%Y-%m-%d')
                if entry_price > 0 and not pd.isna(exit_price) and not pd.isna(entry_price):
                    trade_returns.append(exit_price / entry_price - 1)
                    trade_records.append({
                        'entry_time': entry_time,
                        'entry_price': entry_price,
                        'exit_time': exit_time,
                        'exit_price': exit_price,
                        'profit': exit_price / entry_price - 1,
                        'drawdown': lowest_price / entry_price - 1,
                        'exit_reason': exit_reason,
                        'entry_rsi': trade_entry_rsi,
                        'entry_valley': trade_entry_valley,
                        'entry_vol_ratio': trade_entry_vol_ratio,
                        'entry_dist_sma_50': trade_entry_dist_sma_50
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
    
    losses = trades[trades < 0]
    avg_loss = losses.mean() * 100 if len(losses) > 0 else 0
    
    drawdowns = [t['drawdown'] for t in trade_records]
    avg_drawdown = np.mean(drawdowns) * 100 if len(drawdowns) > 0 else 0
    
    trades_per_year = len(trades) / years
    
    return len(trades), win_rate, avg_ret, avg_loss, avg_drawdown, trade_records

if __name__ == '__main__':
    data_dir = r"E:\github\ohlcv\data\market\nse\mstock"
    import random
    all_stocks = [f for f in os.listdir(data_dir) if f.endswith('.csv')]
    random.seed(42)
    stocks = random.sample(all_stocks, min(50, len(all_stocks)))
    print(f"Testing Strategy: Momentum Valley Pullback on a RANDOM SUBSET OF {len(stocks)} STOCKS")
    print("-" * 75)
    
    total_trades = 0
    total_tp = 0
    sum_tp_profit = 0
    total_wins = 0
    sum_rets = 0
    
    all_trades = {}
    stock_stats = []
    
    for i, s in enumerate(stocks):
        fp = os.path.join(data_dir, s)
        stock_name = s.replace('.csv', '')
        try:
            trades, wr, ret, loss, dd, records = test_stock(fp)
            if trades > 0:
                all_trades[stock_name] = records
                targets = [r for r in records if r['exit_reason'] == 'take_profit']
                t_count = len(targets)
                t_profit = np.mean([r['profit'] for r in targets]) * 100 if t_count > 0 else 0
                
                total_trades += trades
                total_tp += t_count
                sum_tp_profit += t_count * t_profit
                total_wins += trades * (wr / 100)
                sum_rets += trades * ret
                
                # Save individual stock performance
                stock_stats.append({
                    'name': stock_name,
                    'trades': trades,
                    'win_rate': wr,
                    'avg_return': ret
                })
        except Exception:
            pass
            
        if (i+1) % 100 == 0:
            print(f"Processed {i+1}/{len(stocks)} stocks...")
            
    if total_trades > 0:
        print("-" * 75)
        print(f"{'TOTAL PORTFOLIO STATS:':<25}")
        print(f"Total Stocks Traded : {len(all_trades)} / {len(stocks)}")
        print(f"Total Trades Taken  : {total_trades}")
        print(f"Overall Win Rate    : {(total_wins/total_trades)*100:.1f}%")
        print(f"Average Return      : {sum_rets/total_trades:.2f}%")
        
        print("\n=========================================================")
        print(" TOP 5 STOCKS BY WIN RATE (Min 30 Trades) ")
        print("=========================================================")
        # Filter for min 30 trades so 1/1 100% win rate doesn't win
        valid_stocks = [s for s in stock_stats if s['trades'] >= 30]
        
        top_wr = sorted(valid_stocks, key=lambda x: x['win_rate'], reverse=True)[:5]
        for s in top_wr:
            print(f"{s['name']:<15} | Trades: {s['trades']:<5} | Win Rate: {s['win_rate']:>5.1f}% | Avg Ret: {s['avg_return']:>5.2f}%")
            
        print("\n=========================================================")
        print(" TOP 5 STOCKS BY AVG RETURN (Min 30 Trades) ")
        print("=========================================================")
        top_ret = sorted(valid_stocks, key=lambda x: x['avg_return'], reverse=True)[:5]
        for s in top_ret:
            print(f"{s['name']:<15} | Trades: {s['trades']:<5} | Win Rate: {s['win_rate']:>5.1f}% | Avg Ret: {s['avg_return']:>5.2f}%")
        
        # FEATURE ANALYSIS: Winners vs Losers
        all_recs = []
        for s in all_trades.values():
            all_recs.extend(s)
            
        winners = [r for r in all_recs if r['profit'] > 0]
        losers = [r for r in all_recs if r['profit'] < 0]
        
        print("\n=========================================================")
        print(" FEATURE ANALYSIS: WINNERS vs LOSERS AT TIME OF ENTRY ")
        print("=========================================================")
        print(f"{'Indicator @ Entry':<20} | {'WINNING TRADES':<15} | {'LOSING TRADES':<15}")
        print("-" * 55)
        
        if winners and losers:
            w_rsi = np.nanmean([r['entry_rsi'] for r in winners])
            l_rsi = np.nanmean([r['entry_rsi'] for r in losers])
            print(f"{'Entry RSI (5-day)':<20} | {w_rsi:<15.1f} | {l_rsi:<15.1f}")
            
            w_val = np.nanmean([r['entry_valley'] for r in winners])
            l_val = np.nanmean([r['entry_valley'] for r in losers])
            print(f"{'Valley Depth ROC':<20} | {w_val:<15.2f} | {l_val:<15.2f}")
            
            w_vol = np.nanmean([r['entry_vol_ratio'] for r in winners])
            l_vol = np.nanmean([r['entry_vol_ratio'] for r in losers])
            print(f"{'Volume Ratio (x avg)':<20} | {w_vol:<15.2f} | {l_vol:<15.2f}")
            
            w_sma = np.nanmean([r['entry_dist_sma_50'] for r in winners]) * 100
            l_sma = np.nanmean([r['entry_dist_sma_50'] for r in losers]) * 100
            print(f"{'Dist from 50 SMA':<20} | {w_sma:>6.1f}%          | {l_sma:>6.1f}%")
        
    import json
    out_path = r"E:\github\ohlcv\ohlcv_app\strategy_trades.json"
    with open(out_path, 'w') as f:
        json.dump(all_trades, f)
    print(f"Saved {total_trades} trades to {out_path}")
