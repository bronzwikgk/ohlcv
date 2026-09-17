# OHLCV Role-Based Signal Mining

## Objective

This project finds short-term stock trading conditions from OHLCV-style daily data. The current target is configurable future return mining, for example:

```text
future return over 1, 3, 5, or 8 trading days >= 3%
```

The larger goal is to move from exploratory condition mining into a repeatable strategy workflow:

```text
load data -> calculate derivatives -> mine role conditions -> select rules -> backtest -> report
```

## Core Idea

Conditions should not all compete in one flat list. Each condition should have a role:

| Role | Purpose |
|---|---|
| `regime` | Broad state where trading is allowed |
| `setup` | Pre-entry structure, such as pullback or compression |
| `trigger` | Entry timing signal |
| `quality` | Noise and cleanliness filter |
| `risk_avoid` | Exclusion filter |

This avoids mixing broad filters, entry rules, and ignore rules as if they have the same job.

## Current Feature Scope

The clean version intentionally focuses on SMA-derived features first:

| Family | Meaning |
|---|---|
| `sma` | First-order simple moving average |
| `price_distance_from_sma_pct` | Close distance from SMA |
| `sma_trend_stack_gap_pct` | Percent gap between fast and slow SMA |
| `sma_trend_stack_ratio` | Ratio between fast and slow SMA, disabled by default |
| `sma_momentum_pct` | SMA slope/momentum |
| `sma_momentum_spread_pct` | Short SMA momentum versus long SMA momentum |

## Target Returns

`target_returns` defines labels used for mining:

```js
periods: [1, 3, 5, 8]
thresholds_pct: [3]
```

This creates target columns:

```text
target_adj_close_future_return_pct_1_day
target_adj_close_future_return_pct_3_day
target_adj_close_future_return_pct_5_day
target_adj_close_future_return_pct_8_day
```

A hit means the target return is greater than or equal to the threshold. For example:

```text
target_adj_close_future_return_pct_5_day >= 3
```

## Anomaly Handling

Daily return anomalies are marked, not deleted.

Default rule:

```text
daily return > +20% or < -20%
```

The anomaly row, 5 rows before, and 2 rows after are excluded from mining. Raw rows remain available for audit and later backtesting decisions.

## Pipeline Modes

The current pipeline runs the full flow:

```text
data -> derivatives -> mining -> selection -> backtest -> reports
```

Later we can add browser/API modes:

| Mode | Use |
|---|---|
| `mine_only` | Generate candidate rules |
| `backtest_only` | Test manually selected rules |
| `all` | Run full pipeline |
| `interactive` | Browser-based threshold tweaking |

## Components

| File | Responsibility |
|---|---|
| `ohlcv_project_config.js` | Single source of truth |
| `ohlcv_data.js` | Data loading, CSV parsing, seeded selection, split |
| `ohlcv_derivatives.js` | Target returns, SMA features, anomaly flags |
| `ohlcv_conditions.js` | Condition group builder, role miner, condition selector |
| `ohlcv_backtesting.js` | Simple strategy backtester |
| `ohlcv_reports.js` | Indexed HTML reports |
| `ohlcv_pipeline.js` | Orchestrates full run |

## Conflict-Free Config Rules

1. Feature families are defined once in `feature_registry`.
2. Roles reference feature families; roles do not redefine formulas.
3. Condition types are defined once in `condition_type_library`.
4. Disabled feature families are not calculated or mined.
5. Disabled roles are not mined.
6. Backtesting uses selected conditions, not every mined condition.
7. Reports are indexed so historical runs are not overwritten.

## Backtesting Role

Backtesting starts after condition selection.

Mining may produce many candidate rules. The selector chooses a small strategy set:

```text
regime + setup + trigger + quality - risk_avoid
```

The backtester then simulates entries on testing data, applies costs and stops, and writes metrics/trade logs.

## First Production Use Case

Find and validate short-term setups where:

```text
future return >= 3% within 5 trading days
```

Then convert selected conditions into a backtested strategy on held-out testing rows.
