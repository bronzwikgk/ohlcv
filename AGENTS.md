# AGENTS.md

## Project Context

This repository is an OHLCV role-based signal mining and backtesting project.

The pipeline shape is:

```text
load data -> compute derivatives -> split data -> apply anomaly/base filters -> mine role conditions -> select strategy conditions -> backtest -> write combined report
```

Primary entry point:

```text
node ohlcv_pipeline.js
```

Regression tests:

```text
node ohlcv_tests.js
```

## Current Conventions

- Keep `ohlcv_project_config.js` as the single source of truth.
- Use plain CommonJS JavaScript.
- Follow the existing style:
  - no arrow functions
  - no `forEach`
  - explicit `var`
  - class-based modules
- Prefer small, direct helper methods over new abstractions unless duplication becomes painful.
- Do not hand-edit generated report output unless explicitly requested.

## Data And Mining

- Derivatives are computed on continuous loaded stock history before splitting.
- Splitting happens after derivatives are available, so testing rows retain prior SMA context.
- Anomaly rows are marked and excluded from mining/backtest entry logic, not deleted.
- Base conditions define the mandatory universe for mining, selection, and backtesting.
- Current base condition:

```text
adj_close > adj_close_sma_21_day
```

- Baseline target metrics should be reported before base-condition funnel metrics.
- Base-condition funnel should show full anomaly-clean data first, then rows/density after each base condition.
- Mining currently targets:

```text
1-day future return >= 3%
```

- Threshold conditions should be data-derived from mining data percentiles, while preserving configured anchor values such as `0`.
- Rank mined rules using training/mining metrics only. Testing metrics are validation/reporting only.
- In `strategy_optimize` mode, generic role mining is disabled/hidden in the report. Show baseline, base funnel, concept variants, and the backtest for the best concept variant.

## Roles

Configured role chain:

```text
regime -> setup -> trigger -> quality -> risk_avoid
```

Reports should always render sections for every configured role, even if a role is disabled, not mined, or has no passing results.

The report should include a section after anomaly cleaning that lists regime derivatives, lookbacks/pairs, and created condition instructions.

## Backtesting

Backtesting should:

- enter on the next row after the signal row
- apply slippage, fees, taxes, and minimum cost
- enforce maximum open positions
- enforce no duplicate same-stock open positions when configured
- apply fixed stop loss, trailing stop, take profit, and max holding exit
- include signal date, entry date, exit date, exit reason, costs, and condition details in the report

Backtest should remain present in the combined report even if disabled.

## Reporting

Use one combined report per run, not separate mining/backtest reports.

Current output format:

```text
output/ohlcv_run_report_###.html
output/ohlcv_run_report_latest.html
```

Report templates live in:

```text
report_templates/
```

Templates:

```text
combined_report.html
mining_report.html
backtest_report.html
report.css
```

Refine report layout/styles in templates/CSS instead of embedding large HTML/CSS shells inside JS.

Wide report tables must be horizontally scrollable. Compact metric tables should not stretch across the full page.

## Git And Push Preference

When the user asks to push, commit and push all current workspace changes unless they explicitly request a partial commit.

Current branch used in this work:

```text
wip_dot_ohlcv
```

Remote:

```text
origin https://github.com/bronzwikgk/ohlcv.git
```

Before pushing:

```text
git status --short
node ohlcv_tests.js
```

Then commit all changes and push:

```text
git add -A
git commit -m "<clear message>"
git push origin wip_dot_ohlcv
```
