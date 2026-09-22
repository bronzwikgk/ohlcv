"use strict";

const assert = require("assert");
const config_module = require("./ohlcv_project_config");
const data_module = require("./ohlcv_data");
const condition_module = require("./ohlcv_conditions");
const backtesting_module = require("./ohlcv_backtesting");
const strategy_module = require("./ohlcv_strategy");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function test_active_roles_and_mining_targets() {
  var config = clone(config_module.ohlcv_project_config);
  config.project.active_roles = ["regime"];
  config.mining.target_periods = [5];
  config.mining.target_thresholds_pct = [3];
  var built = new condition_module.ohlcv_condition_group_builder(config).build();
  assert.strictEqual(built.roles.length, 1);
  assert.strictEqual(built.roles[0].role, "regime");
  assert.deepStrictEqual(built.target_returns.periods, [5]);
  assert.deepStrictEqual(built.target_returns.thresholds_pct, [3]);
}

function test_loaded_month_span_is_inclusive() {
  var loader = new data_module.ohlcv_data_loader(config_module.ohlcv_project_config);
  assert.strictEqual(loader.month_span(new Date("2020-01-15"), new Date("2020-01-20")), 1);
  assert.strictEqual(loader.month_span(new Date("2020-01-15"), new Date("2020-03-01")), 3);
  assert.strictEqual(loader.month_span(new Date("2020-12-31"), new Date("2021-01-01")), 2);
}

function test_rank_uses_training_metrics() {
  var miner = new condition_module.ohlcv_role_miner(config_module.ohlcv_project_config);
  var ranking = { minimum_matching_rows: 1, minimum_coverage_pct: 0, top_n: 2 };
  var ranked = miner.rank([
    { expression: "bad_test_good_train", training_matches: 10, training_density_pct: 60, training_coverage_pct: 10, testing_density_pct: 1, testing_coverage_pct: 1 },
    { expression: "good_test_bad_train", training_matches: 10, training_density_pct: 10, training_coverage_pct: 10, testing_density_pct: 99, testing_coverage_pct: 99 }
  ], ranking);
  assert.strictEqual(ranked[0].expression, "bad_test_good_train");
}

function test_threshold_values_are_data_derived() {
  var miner = new condition_module.ohlcv_role_miner(config_module.ohlcv_project_config);
  var instruction = {
    type: "threshold_compare",
    column: "feature",
    candidate_values: [0],
    derive_from_data: true,
    percentile_cutpoints: [0, 50, 100]
  };
  var rows = [
    { feature: -4, target_adj_close_future_return_pct_5_day: 0 },
    { feature: -2, target_adj_close_future_return_pct_5_day: 1 },
    { feature: 3, target_adj_close_future_return_pct_5_day: 2 },
    { feature: 8, target_adj_close_future_return_pct_5_day: 3 }
  ];
  var values = miner.threshold_values(instruction, rows, "target_adj_close_future_return_pct_5_day");
  assert.deepStrictEqual(values, [-4, 0, 3, 8]);
}

function test_baseline_target_metrics() {
  var miner = new condition_module.ohlcv_role_miner(config_module.ohlcv_project_config);
  var target = { output_prefix: "target", periods: [5], thresholds_pct: [3] };
  var baseline = miner.baseline_results(
    [{ target_5_day: 4 }, { target_5_day: 2 }, { target_5_day: null }],
    [{ target_5_day: 3 }, { target_5_day: 1 }],
    target
  );
  assert.strictEqual(baseline.length, 1);
  assert.strictEqual(baseline[0].training_hits, 1);
  assert.strictEqual(baseline[0].training_rows, 2);
  assert.strictEqual(baseline[0].training_density_pct, 50);
  assert.strictEqual(baseline[0].testing_hits, 1);
  assert.strictEqual(baseline[0].testing_rows, 2);
  assert.strictEqual(baseline[0].testing_density_pct, 50);
}

function test_base_conditions_filter_mining_rows() {
  var config = clone(config_module.ohlcv_project_config);
  config.base_conditions = {
    enabled: true,
    operator: "AND",
    conditions: [
      { type: "relative_pair_compare", left_column: "adj_close", operator: ">", right_column: "adj_close_sma_21_day" }
    ]
  };
  var miner = new condition_module.ohlcv_role_miner(config);
  var rows = miner.flatten({
    TEST: [
      { adj_close: 11, adj_close_sma_21_day: 10, __exclude_from_mining: false },
      { adj_close: 9, adj_close_sma_21_day: 10, __exclude_from_mining: false },
      { adj_close: 12, adj_close_sma_21_day: 10, __exclude_from_mining: true }
    ]
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].adj_close, 11);
}

function test_base_condition_funnel_tracks_full_and_filtered_density() {
  var config = clone(config_module.ohlcv_project_config);
  config.base_conditions = {
    enabled: true,
    operator: "AND",
    conditions: [
      { type: "relative_pair_compare", left_column: "adj_close", operator: ">", right_column: "adj_close_sma_21_day", expression: "close > sma21" },
      { type: "threshold_compare", column: "volume", operator: ">", right_value: 100, expression: "volume > 100" }
    ]
  };
  var miner = new condition_module.ohlcv_role_miner(config);
  var target = { output_prefix: "target", periods: [5], thresholds_pct: [3] };
  var training_rows = [
    { adj_close: 11, adj_close_sma_21_day: 10, volume: 150, target_5_day: 4 },
    { adj_close: 12, adj_close_sma_21_day: 10, volume: 50, target_5_day: 1 },
    { adj_close: 9, adj_close_sma_21_day: 10, volume: 200, target_5_day: 5 }
  ];
  var testing_rows = [
    { adj_close: 11, adj_close_sma_21_day: 10, volume: 150, target_5_day: 2 },
    { adj_close: 8, adj_close_sma_21_day: 10, volume: 150, target_5_day: 4 }
  ];
  var funnel = miner.base_condition_funnel(training_rows, testing_rows, target);
  assert.strictEqual(funnel.length, 3);
  assert.strictEqual(funnel[0].training_rows, 3);
  assert.strictEqual(funnel[0].targets[0].training_density_pct, 66.66666666666666);
  assert.strictEqual(funnel[1].training_rows, 2);
  assert.strictEqual(funnel[2].training_rows, 1);
  assert.strictEqual(funnel[2].targets[0].training_density_pct, 100);
}

function test_structured_condition_matching() {
  var config = clone(config_module.ohlcv_project_config);
  config.base_conditions = { enabled: false, operator: "AND", conditions: [] };
  var selector = new condition_module.ohlcv_condition_selector(config);
  var selected = {
    regime: [{ instruction: { type: "threshold_compare", column: "value", operator: ">", right_value: 0 } }],
    setup: [],
    trigger: [],
    quality: [],
    risk_avoid: [{ instruction: { type: "range", column: "risk", min_value: 10, max_value: 20 } }]
  };
  assert.strictEqual(selector.row_passes_selected({ value: 1, risk: 5 }, selected), true);
  assert.strictEqual(selector.row_passes_selected({ value: 1, risk: 15 }, selected), false);
}

function test_backtester_next_row_entry_and_costs() {
  var config = clone(config_module.ohlcv_project_config);
  config.backtesting.initial_capital = 10000;
  config.backtesting.position_sizing.value = 100;
  config.backtesting.risk.maximum_open_positions = 1;
  config.backtesting.execution.slippage.value = 0;
  config.backtesting.execution.broker_fees.value = 0.01;
  config.backtesting.execution.taxes.buy_value = 0;
  config.backtesting.execution.taxes.sell_value = 0;
  config.backtesting.rule_sets.stop_loss_set.fixed_percent_loss.enabled = false;
  config.backtesting.rule_sets.stop_loss_set.trailing_percent.enabled = false;
  config.backtesting.rule_sets.stop_loss_set.take_profit.enabled = false;
  config.backtesting.holding.max_holding_days = 2;
  config.base_conditions = { enabled: false, operator: "AND", conditions: [] };

  var selected = {
    regime: [{ expression: "signal > 0", instruction: { type: "threshold_compare", column: "signal", operator: ">", right_value: 0 } }],
    setup: [],
    trigger: [],
    quality: [],
    risk_avoid: []
  };
  var rows = [
    { date: new Date("2023-01-02"), adj_close: 100, signal: 1 },
    { date: new Date("2023-01-03"), adj_close: 110, signal: 0 },
    { date: new Date("2023-01-04"), adj_close: 120, signal: 0 }
  ];
  var report = new backtesting_module.ohlcv_backtester(config).run({ TEST: rows }, selected);
  assert.strictEqual(report.trades.length, 1);
  assert.strictEqual(report.trades[0].signal_date, "2023-01-02");
  assert.strictEqual(report.trades[0].entry_date, "2023-01-03");
  assert.strictEqual(report.trades[0].exit_date, "2023-01-04");
  assert.ok(report.trades[0].costs > 0);
  assert.ok(report.trades[0].net_pnl < report.trades[0].gross_pnl);
}

function test_backtester_applies_base_conditions() {
  var config = clone(config_module.ohlcv_project_config);
  config.backtesting.initial_capital = 10000;
  config.backtesting.position_sizing.value = 100;
  config.backtesting.risk.maximum_open_positions = 10;
  config.backtesting.execution.slippage.enabled = false;
  config.backtesting.execution.broker_fees.enabled = false;
  config.backtesting.execution.taxes.enabled = false;
  config.backtesting.rule_sets.stop_loss_set.fixed_percent_loss.enabled = false;
  config.backtesting.rule_sets.stop_loss_set.trailing_percent.enabled = false;
  config.backtesting.rule_sets.stop_loss_set.take_profit.enabled = false;
  config.base_conditions = {
    enabled: true,
    operator: "AND",
    conditions: [
      { type: "relative_pair_compare", left_column: "adj_close", operator: ">", right_column: "adj_close_sma_21_day" }
    ]
  };
  var selected = {
    regime: [{ expression: "signal > 0", instruction: { type: "threshold_compare", column: "signal", operator: ">", right_value: 0 } }],
    setup: [],
    trigger: [],
    quality: [],
    risk_avoid: []
  };
  var rows = [
    { date: new Date("2023-01-02"), adj_close: 9, adj_close_sma_21_day: 10, signal: 1 },
    { date: new Date("2023-01-03"), adj_close: 11, adj_close_sma_21_day: 10, signal: 0 },
    { date: new Date("2023-01-04"), adj_close: 12, adj_close_sma_21_day: 10, signal: 0 }
  ];
  var report = new backtesting_module.ohlcv_backtester(config).run({ TEST: rows }, selected);
  assert.strictEqual(report.trades.length, 0);
}

function test_backtester_strategy_recipes_ablate_roles() {
  var config = clone(config_module.ohlcv_project_config);
  config.project.default_run_mode = "mine";
  config.backtesting.initial_capital = 10000;
  config.backtesting.position_sizing.value = 100;
  config.backtesting.risk.maximum_open_positions = 10;
  config.backtesting.execution.slippage.enabled = false;
  config.backtesting.execution.broker_fees.enabled = false;
  config.backtesting.execution.taxes.enabled = false;
  config.backtesting.rule_sets.stop_loss_set.fixed_percent_loss.enabled = false;
  config.backtesting.rule_sets.stop_loss_set.trailing_percent.enabled = false;
  config.backtesting.rule_sets.stop_loss_set.take_profit.enabled = false;
  config.backtesting.strategy_recipes = [
    { name: "regime_only", roles: ["regime"] },
    { name: "regime_setup", roles: ["regime", "setup"] }
  ];
  config.base_conditions = { enabled: false, operator: "AND", conditions: [] };

  var selected = {
    regime: [{ expression: "signal > 0", instruction: { type: "threshold_compare", column: "signal", operator: ">", right_value: 0 } }],
    setup: [{ expression: "setup > 0", instruction: { type: "threshold_compare", column: "setup", operator: ">", right_value: 0 } }],
    trigger: [],
    quality: [],
    risk_avoid: []
  };
  var rows = [
    { date: new Date("2023-01-02"), adj_close: 100, signal: 1, setup: -1 },
    { date: new Date("2023-01-03"), adj_close: 110, signal: 0, setup: -1 },
    { date: new Date("2023-01-04"), adj_close: 120, signal: 0, setup: -1 }
  ];
  var report = new backtesting_module.ohlcv_backtester(config).run({ TEST: rows }, selected);
  assert.strictEqual(report.recipe_reports.length, 2);
  assert.strictEqual(report.recipe_reports[0].metrics.total_trades, 1);
  assert.strictEqual(report.recipe_reports[1].metrics.total_trades, 0);
}

function test_strategy_optimizer_builds_concept_variants() {
  var config = clone(config_module.ohlcv_project_config);
  config.base_conditions = { enabled: false, operator: "AND", conditions: [] };
  config.strategies.definitions.sma_pullback_continuation.parameter_grid = {
    pullback_columns: ["adj_close_vs_sma_pct_3_day"],
    pullback_ranges: [[-3, 3]],
    trigger_daily_return_gt: [0],
    max_close_vs_sma21: [8]
  };
  config.strategies.definitions.sma_pullback_continuation.minimum_training_matches = 1;
  config.strategies.definitions.sma_pullback_continuation.top_n = 5;
  config.strategies.definitions.sma_pullback_continuation.backtest_top_n = 1;
  config.backtesting.execution.slippage.enabled = false;
  config.backtesting.execution.broker_fees.enabled = false;
  config.backtesting.execution.taxes.enabled = false;

  var row = {
    date: new Date("2023-01-02"),
    adj_close: 100,
    adj_close_sma_21_day: 99,
    adj_close_sma_55_day: 90,
    adj_close_sma_slope_pct_55_day: 0.5,
    adj_close_vs_sma_pct_3_day: 1,
    adj_close_vs_sma_pct_21_day: 4,
    adj_close_daily_return_pct: 1,
    target_adj_close_future_return_pct_1_day: 4
  };
  var next_row = {
    date: new Date("2023-01-03"),
    adj_close: 104,
    adj_close_sma_21_day: 99,
    adj_close_sma_55_day: 90,
    adj_close_sma_slope_pct_55_day: 0.5,
    adj_close_vs_sma_pct_3_day: 1,
    adj_close_vs_sma_pct_21_day: 4,
    adj_close_daily_return_pct: 1,
    target_adj_close_future_return_pct_1_day: null
  };
  var report = new strategy_module.ohlcv_strategy_optimizer(config).run({ TEST: [row, next_row] }, { TEST: [row, next_row] });
  assert.strictEqual(report.enabled, true);
  assert.strictEqual(report.variants.length, 1);
  assert.strictEqual(report.variants[0].training_matches, 1);
  assert.strictEqual(report.variants[0].training_density_pct, 100);
}

test_active_roles_and_mining_targets();
test_loaded_month_span_is_inclusive();
test_rank_uses_training_metrics();
test_threshold_values_are_data_derived();
test_baseline_target_metrics();
test_base_conditions_filter_mining_rows();
test_base_condition_funnel_tracks_full_and_filtered_density();
test_structured_condition_matching();
test_backtester_next_row_entry_and_costs();
test_backtester_applies_base_conditions();
test_backtester_strategy_recipes_ablate_roles();
test_strategy_optimizer_builds_concept_variants();

console.log("ohlcv tests passed");
