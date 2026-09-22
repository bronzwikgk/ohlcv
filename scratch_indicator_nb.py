import json
import os

nb = {
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "# Dynamic Regime Indicator (Path Length Efficiency)\n",
    "\n",
    "This notebook demonstrates a purely data-driven Regime Filter using the concept of **Cumulative Price Traveled** and **Efficiency Ratio**. \n",
    "\n",
    "Instead of a hardcoded lookback (e.g., 50 days), we mathematically stretch the lookback window backwards in time until the stock has traveled a cumulative absolute distance of `target` (e.g., 50%). We then measure the net directional distance traveled over that dynamic window to score the trend efficiency."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "import os\n",
    "import pandas as pd\n",
    "import numpy as np\n",
    "import matplotlib.pyplot as plt\n",
    "from matplotlib.patches import Rectangle\n",
    "import matplotlib.dates as mdates\n",
    "\n",
    "plt.rcParams['figure.figsize'] = (18, 12)\n",
    "plt.rcParams['axes.grid'] = True"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 1. Load Data for 5 Stocks\n",
    "We randomly sample 5 stocks from our dataset to visualize."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "DATA_DIR = r'D:\\0dot1_Aug_2016_master\\data\\mstock_mtf_daily_data'\n",
    "\n",
    "all_files = [f for f in os.listdir(DATA_DIR) if f.endswith('.csv')]\n",
    "\n",
    "loaded_stocks = {}\n",
    "for file in all_files:\n",
    "    try:\n",
    "        df = pd.read_csv(os.path.join(DATA_DIR, file))\n",
    "        df['Date'] = pd.to_datetime(df['Date'])\n",
    "        df = df.sort_values('Date').reset_index(drop=True)\n",
    "        \n",
    "        if len(df) > 1000:\n",
    "            loaded_stocks[file.replace('.csv', '')] = df\n",
    "            \n",
    "        if len(loaded_stocks) >= 5:\n",
    "            break\n",
    "    except Exception as e:\n",
    "        continue\n",
    "\n",
    "print(f\"Loaded {len(loaded_stocks)} stocks for testing.\")"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 2. Dynamic Indicator Logic\n",
    "Calculates the dynamic lookback length `N` and the resulting `Efficiency Ratio`."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "def calculate_dynamic_regime(data, target=0.50):\n",
    "    data = data.copy()\n",
    "    data['abs_ret'] = data['Close'].pct_change().abs()\n",
    "    \n",
    "    lookbacks = []\n",
    "    distance_travelled = []\n",
    "    efficiency = []\n",
    "    \n",
    "    abs_rets = data['abs_ret'].values\n",
    "    closes = data['Close'].values\n",
    "    \n",
    "    for i in range(len(data)):\n",
    "        if i == 0 or np.isnan(abs_rets[i]):\n",
    "            lookbacks.append(np.nan)\n",
    "            distance_travelled.append(np.nan)\n",
    "            efficiency.append(np.nan)\n",
    "            continue\n",
    "            \n",
    "        cum_sum = 0\n",
    "        j = i\n",
    "        while j >= 0 and cum_sum < target:\n",
    "            if not np.isnan(abs_rets[j]):\n",
    "                cum_sum += abs_rets[j]\n",
    "            j -= 1\n",
    "            \n",
    "        if cum_sum < target:\n",
    "            lookbacks.append(np.nan)\n",
    "            distance_travelled.append(np.nan)\n",
    "            efficiency.append(np.nan)\n",
    "        else:\n",
    "            n_days = i - j\n",
    "            lookbacks.append(n_days)\n",
    "            \n",
    "            # Calculate net return from j to i\n",
    "            # Note: j is the day where cum_sum exceeded target\n",
    "            net_return = (closes[i] - closes[j]) / closes[j]\n",
    "            distance_travelled.append(net_return)\n",
    "            eff = net_return / cum_sum\n",
    "            efficiency.append(eff)\n",
    "            \n",
    "    data['dynamic_lookback'] = lookbacks\n",
    "    data['distance_travelled'] = distance_travelled\n",
    "    data['efficiency_ratio'] = efficiency\n",
    "    return data\n",
    "\n",
    "print(\"Indicator function loaded.\")"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 3. Plotting Logic\n",
    "Plots 3 subplots: Price, Dynamic Lookback, and Efficiency Ratio."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "def plot_regime(data, symbol, start_idx, num_days=63):\n",
    "    end_idx = min(start_idx + num_days, len(data) - 1)\n",
    "    plot_data = data.iloc[start_idx:end_idx+1].copy().reset_index(drop=True)\n",
    "    \n",
    "    if plot_data.empty:\n",
    "        return\n",
    "\n",
    "    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(18, 12), gridspec_kw={'height_ratios': [3, 1, 1]})\n",
    "    width = 0.65\n",
    "    \n",
    "    # 1. Price Plot\n",
    "    ax1.plot(plot_data.index, plot_data['Close'], color='black', linewidth=1.5)\n",
    "    ax1.set_title(f'{symbol} - 3 Month Snapshot ({plot_data.iloc[0][\"Date\"].strftime(\"%Y-%m-%d\")} to {plot_data.iloc[-1][\"Date\"].strftime(\"%Y-%m-%d\")})')\n",
    "    ax1.set_ylabel('Price')\n",
    "    \n",
    "    # 2. Distance Travelled Plot\n",
    "    ax2.plot(plot_data.index, plot_data['distance_travelled'], color='orange', linewidth=2)\n",
    "    ax2.axhline(0, color='black', linestyle='--', linewidth=1)\n",
    "    ax2.set_ylabel('Distance Travelled')\n",
    "    ax2.set_title('Net Distance Travelled over Dynamic Window')\n",
    "    \n",
    "    # 3. Efficiency Ratio Plot\n",
    "    ax3.plot(plot_data.index, plot_data['efficiency_ratio'], color='blue', linewidth=2)\n",
    "    ax3.axhline(0, color='black', linestyle='--', linewidth=1)\n",
    "    ax3.axhline(0.3, color='green', linestyle=':', linewidth=1.5)\n",
    "    ax3.axhline(-0.3, color='red', linestyle=':', linewidth=1.5)\n",
    "    ax3.set_ylabel('Efficiency Ratio')\n",
    "    ax3.set_title('Regime Score (-1 to +1)')\n",
    "    ax3.set_ylim(-1.1, 1.1)\n",
    "\n",
    "    # Formatting X-axis\n",
    "    tick_step = max(1, len(plot_data) // 10)\n",
    "    ticks = list(range(0, len(plot_data), tick_step))\n",
    "    labels = [plot_data.loc[t, 'Date'].strftime('%Y-%m-%d') for t in ticks]\n",
    "    \n",
    "    for ax in [ax1, ax2, ax3]:\n",
    "        ax.set_xticks(ticks)\n",
    "        ax.set_xticklabels(labels if ax == ax3 else [], rotation=45 if ax == ax3 else 0, ha='right')\n",
    "\n",
    "    plt.tight_layout()\n",
    "    plt.show()\n",
    "\n",
    "print(\"Plotting function loaded.\")"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 4. Run Indicator and Render Case Studies\n",
    "We calculate the indicator and plot two 3-month slices per stock."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "# Set threshold to 50% cumulative price travel\n",
    "CUMULATIVE_TARGET = 0.50 \n",
    "\n",
    "for symbol, df in loaded_stocks.items():\n",
    "    print(f\"\\n{'='*50}\")\n",
    "    print(f\"Processing {symbol}...\")\n",
    "    df_processed = calculate_dynamic_regime(df, target=CUMULATIVE_TARGET)\n",
    "    \n",
    "    # Pick two completely arbitrary 3-month (63 trading days) periods that exist in the data\n",
    "    # We'll pick one towards the middle, and one towards the end\n",
    "    total_days = len(df_processed)\n",
    "    if total_days > 400:\n",
    "        slice1_start = total_days // 2\n",
    "        slice2_start = total_days - 100\n",
    "        \n",
    "        print(f\"\\n--- {symbol} Slice 1 ---\")\n",
    "        plot_regime(df_processed, symbol, slice1_start, num_days=63)\n",
    "        \n",
    "        print(f\"\\n--- {symbol} Slice 2 ---\")\n",
    "        plot_regime(df_processed, symbol, slice2_start, num_days=63)\n",
    "    else:\n",
    "        print(f\"Not enough data to plot slices for {symbol}.\")\n"
   ]
  }
 ],
 "metadata": {
  "kernelspec": {
   "display_name": "Python 3",
   "language": "python",
   "name": "python3"
  },
  "language_info": {
   "codemirror_mode": {
    "name": "ipython",
    "version": 3
   },
   "file_extension": ".py",
   "mimetype": "text/x-python",
   "name": "python",
   "nbconvert_exporter": "python",
   "pygments_lexer": "ipython3",
   "version": "3.8.10"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}

import os
os.makedirs(r'E:\github\ohlcv\notebook', exist_ok=True)
with open(r'E:\github\ohlcv\notebook\dynamic_regime_indicator.ipynb', 'w', encoding='utf-8') as f:
    json.dump(nb, f, indent=1)
