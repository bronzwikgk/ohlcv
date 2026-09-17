"use strict";

const config_module = require("./ohlcv_project_config");
const data_module = require("./ohlcv_data");
const derivative_module = require("./ohlcv_derivatives");
const condition_module = require("./ohlcv_conditions");
const backtesting_module = require("./ohlcv_backtesting");
const report_module = require("./ohlcv_reports");

class ohlcv_pipeline {
  constructor(config) {
    this.config = config || config_module.ohlcv_project_config;
  }

  run() {
    var loader = new data_module.ohlcv_data_loader(this.config);
    var loaded = loader.load();
    var splitter = new data_module.ohlcv_data_splitter(this.config);
    var split = splitter.split(loaded);

    var mining_derivatives = new derivative_module.ohlcv_derivative_engine(this.config);
    var mining = mining_derivatives.compute_all(split.mining);
    var mining_anomaly_report = mining_derivatives.anomaly_report;

    var testing_derivatives = new derivative_module.ohlcv_derivative_engine(this.config);
    var testing = testing_derivatives.compute_all(split.testing);
    var testing_anomaly_report = testing_derivatives.anomaly_report;

    var builder = new condition_module.ohlcv_condition_group_builder(this.config);
    var built = builder.build();
    var miner = new condition_module.ohlcv_role_miner(this.config);
    var mining_report = miner.mine(built, mining, testing);
    var selector = new condition_module.ohlcv_condition_selector(this.config);
    var selected_conditions = selector.select(mining_report);
    var backtester = new backtesting_module.ohlcv_backtester(this.config);
    var backtest_report = backtester.run(testing, selected_conditions);

    var result = {
      loaded_report: loader.report,
      built_condition_groups: built,
      mining_report: mining_report,
      selected_conditions: selected_conditions,
      backtest_report: backtest_report,
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
      if (role.results.length > 0) console.log("  best: " + role.results[0].expression + " density=" + role.results[0].testing_density_pct.toFixed(2) + " coverage=" + role.results[0].testing_coverage_pct.toFixed(2));
    }
    console.log("mining report: " + result.report_paths.mining_report_path);
    console.log("backtest report: " + result.report_paths.backtest_report_path);
  }
}

module.exports = { ohlcv_pipeline: ohlcv_pipeline };

if (require.main === module) {
  var pipeline = new ohlcv_pipeline();
  pipeline.run();
}
