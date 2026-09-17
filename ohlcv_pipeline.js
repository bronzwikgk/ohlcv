"use strict";

const config_module = require("./ohlcv_project_config");
const data_module = require("./ohlcv_data");
const derivative_module = require("./ohlcv_derivatives");
const condition_module = require("./ohlcv_conditions");
const backtesting_module = require("./ohlcv_backtesting");
const report_module = require("./ohlcv_reports");
const strategy_module = require("./ohlcv_strategy");

class ohlcv_pipeline {
  constructor(config) {
    this.config = config || config_module.ohlcv_project_config;
  }

  run() {
    var run_started_at = Date.now();
    var loader = new data_module.ohlcv_data_loader(this.config);
    var loaded = loader.load();
    this.print_elapsed("load", run_started_at);

    var derivative_engine = new derivative_module.ohlcv_derivative_engine(this.config);
    var derived = derivative_engine.compute_all(loaded);
    this.print_elapsed("derivatives", run_started_at);
    var splitter = new data_module.ohlcv_data_splitter(this.config);
    var split = splitter.split(derived);
    var mining = split.mining;
    var testing = split.testing;
    var mining_anomaly_report = this.anomaly_report_for_collection(mining);
    var testing_anomaly_report = this.anomaly_report_for_collection(testing);

    var builder = new condition_module.ohlcv_condition_group_builder(this.config);
    var built = builder.build();
    var miner = new condition_module.ohlcv_role_miner(this.config);
    var mining_report = this.run_mode() === "strategy_optimize" ? this.strategy_mode_mining_report(miner, built, mining, testing) : miner.mine(built, mining, testing);
    this.print_elapsed("mining", run_started_at);
    var selector = new condition_module.ohlcv_condition_selector(this.config);
    var selected_conditions = this.run_mode() === "strategy_optimize" ? { regime: [], setup: [], trigger: [], quality: [], risk_avoid: [] } : selector.select(mining_report, mining);
    var strategy_optimizer = new strategy_module.ohlcv_strategy_optimizer(this.config);
    var strategy_report = strategy_optimizer.run(mining, testing);
    if (this.run_mode() === "strategy_optimize" && strategy_report.enabled && strategy_report.variants.length > 0) selected_conditions = strategy_report.variants[0].selected_conditions;
    this.print_elapsed("strategy optimization", run_started_at);
    var backtester = new backtesting_module.ohlcv_backtester(this.config);
    var backtest_report = backtester.run(testing, selected_conditions);
    this.print_elapsed("backtesting", run_started_at);

    var result = {
      loaded_report: loader.report,
      built_condition_groups: built,
      mining_report: mining_report,
      selected_conditions: selected_conditions,
      backtest_report: backtest_report,
      strategy_report: strategy_report,
      anomaly_report: {
        mining: mining_anomaly_report,
        testing: testing_anomaly_report
      }
    };

    var writer = new report_module.ohlcv_report_writer(this.config);
    result.report_paths = writer.write_all(result);
    this.print_summary(result);
    return result;
  }

  run_mode() {
    return this.config.project.default_run_mode || "mine";
  }

  strategy_mode_mining_report(miner, built, mining_collection, testing_collection) {
    var full_mining_rows = miner.flatten_without_base_conditions(mining_collection);
    var full_testing_rows = miner.flatten_without_base_conditions(testing_collection);
    var mining_rows = miner.apply_base_conditions(full_mining_rows);
    var testing_rows = miner.apply_base_conditions(full_testing_rows);
    return {
      full_mining_row_count: full_mining_rows.length,
      full_testing_row_count: full_testing_rows.length,
      mining_row_count: mining_rows.length,
      testing_row_count: testing_rows.length,
      base_condition_funnel: miner.base_condition_funnel(full_mining_rows, full_testing_rows, built.target_returns),
      baseline: miner.baseline_results(mining_rows, testing_rows, built.target_returns),
      roles: []
    };
  }

  print_elapsed(label, started_at) {
    console.log(label + " finished in " + ((Date.now() - started_at) / 1000).toFixed(2) + "s");
  }

  anomaly_report_for_collection(collection) {
    var config = this.config.anomaly_cleaning || {};
    var exclude_column = config.exclude_from_mining_column || "__exclude_from_mining";
    var daily_return_column = config.daily_return_column || "adj_close_daily_return_pct";
    var report = { anomaly_rows: 0, positive_anomaly_rows: 0, negative_anomaly_rows: 0, rows_excluded_from_mining: 0, stocks: {} };
    var stock_names = Object.keys(collection || {});

    for (var stock_index = 0; stock_index < stock_names.length; stock_index += 1) {
      var stock = stock_names[stock_index];
      var rows = collection[stock] || [];
      report.stocks[stock] = { anomaly_rows: 0, positive_anomaly_rows: 0, negative_anomaly_rows: 0, rows_excluded_from_mining: 0 };

      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        var row = rows[row_index];
        var daily_return = row[daily_return_column];
        if (daily_return !== null && daily_return !== undefined && Number(daily_return) > Number(config.positive_threshold_pct)) {
          report.anomaly_rows += 1;
          report.positive_anomaly_rows += 1;
          report.stocks[stock].anomaly_rows += 1;
          report.stocks[stock].positive_anomaly_rows += 1;
        } else if (daily_return !== null && daily_return !== undefined && Number(daily_return) < Number(config.negative_threshold_pct)) {
          report.anomaly_rows += 1;
          report.negative_anomaly_rows += 1;
          report.stocks[stock].anomaly_rows += 1;
          report.stocks[stock].negative_anomaly_rows += 1;
        }
        if (row[exclude_column] === true) {
          report.rows_excluded_from_mining += 1;
          report.stocks[stock].rows_excluded_from_mining += 1;
        }
      }
    }

    return report;
  }

  print_summary(result) {
    console.log("ohlcv pipeline finished");
    console.log("stocks loaded: " + result.loaded_report.total_number_of_stocks);
    console.log("mining rows: " + result.mining_report.mining_row_count);
    console.log("testing rows: " + result.mining_report.testing_row_count);
    console.log("mining anomaly rows: " + result.anomaly_report.mining.anomaly_rows + " excluded: " + result.anomaly_report.mining.rows_excluded_from_mining);
    console.log("testing anomaly rows: " + result.anomaly_report.testing.anomaly_rows + " excluded: " + result.anomaly_report.testing.rows_excluded_from_mining);
    for (var role_index = 0; role_index < result.mining_report.roles.length; role_index += 1) {
      var role = result.mining_report.roles[role_index];
      console.log("role " + role.role + " results: " + role.results.length);
      if (role.results.length > 0) console.log("  best: " + role.results[0].expression + " training_density=" + role.results[0].training_density_pct.toFixed(2) + " testing_density=" + role.results[0].testing_density_pct.toFixed(2));
    }
    if (result.strategy_report && result.strategy_report.enabled) {
      console.log("strategy " + result.strategy_report.strategy_name + " variants: " + result.strategy_report.variants.length);
      if (result.strategy_report.variants.length > 0) console.log("  best variant: " + result.strategy_report.variants[0].name + " training_density=" + result.strategy_report.variants[0].training_density_pct.toFixed(2) + " testing_density=" + result.strategy_report.variants[0].testing_density_pct.toFixed(2));
    }
    console.log("run report: " + result.report_paths.combined_report_path);
  }
}

module.exports = { ohlcv_pipeline: ohlcv_pipeline };

if (require.main === module) {
  var pipeline = new ohlcv_pipeline();
  pipeline.run();
}
