"use strict";

class ohlcv_derivative_engine {
  constructor(config) {
    this.config = config;
    this.anomaly_report = this.empty_anomaly_report();
  }

  compute_all(collection) {
    var output = {};
    var stock_names = Object.keys(collection || {});
    this.anomaly_report = this.empty_anomaly_report();

    for (var stock_index = 0; stock_index < stock_names.length; stock_index += 1) {
      var stock = stock_names[stock_index];
      var rows = this.clone_rows(collection[stock]);
      this.add_target_returns(rows);
      this.add_first_order(rows);
      this.add_second_order(rows);
      this.apply_anomaly_cleaning(stock, rows);
      output[stock] = rows;
    }

    return output;
  }

  add_target_returns(rows) {
    var target = this.config.target_returns;
    var periods = target.periods || [];

    for (var period_index = 0; period_index < periods.length; period_index += 1) {
      var period = Number(periods[period_index]);
      var column = target.output_prefix + "_" + period + "_day";

      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        var future = rows[row_index + period];
        rows[row_index][column] = future ? this.percent_change(future[target.input_column], rows[row_index][target.input_column]) : null;
      }
    }
  }

  add_first_order(rows) {
    var derivatives = this.config.feature_registry.first_order_derivatives || [];

    for (var index = 0; index < derivatives.length; index += 1) {
      var derivative = derivatives[index];
      if (derivative.enabled === false) continue;
      if (derivative.family === "sma") this.add_sma(rows, derivative);
    }
  }

  add_second_order(rows) {
    var derivatives = this.config.feature_registry.second_order_derivatives || [];

    for (var index = 0; index < derivatives.length; index += 1) {
      var derivative = derivatives[index];
      if (derivative.enabled === false) continue;

      if (derivative.family === "price_distance_from_sma_pct") {
        this.add_price_distance_from_sma(rows, derivative);
      } else if (derivative.family === "sma_trend_stack_gap_pct") {
        this.add_pair_difference_pct(rows, derivative);
      } else if (derivative.family === "sma_trend_stack_ratio") {
        this.add_pair_ratio(rows, derivative);
      } else if (derivative.family === "sma_momentum_pct") {
        this.add_sma_momentum(rows, derivative);
      } else if (derivative.family === "sma_momentum_spread_pct") {
        this.add_pair_difference_pct(rows, derivative);
      }
    }
  }

  add_sma(rows, derivative) {
    for (var lookback_index = 0; lookback_index < derivative.lookbacks.length; lookback_index += 1) {
      var lookback = Number(derivative.lookbacks[lookback_index]);
      var column = this.lookback_column(derivative.output_prefix, lookback);
      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        rows[row_index][column] = this.sma(rows, derivative.input_column, row_index, lookback);
      }
    }
  }

  add_price_distance_from_sma(rows, derivative) {
    for (var lookback_index = 0; lookback_index < derivative.lookbacks.length; lookback_index += 1) {
      var lookback = Number(derivative.lookbacks[lookback_index]);
      var right_column = this.lookback_column(derivative.right_output_prefix, lookback);
      var output_column = this.lookback_column(derivative.output_prefix, lookback);
      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        rows[row_index][output_column] = this.percent_change(rows[row_index][derivative.left_column], rows[row_index][right_column]);
      }
    }
  }

  add_pair_difference_pct(rows, derivative) {
    var pairs = derivative.comparison_pairs || [];
    for (var pair_index = 0; pair_index < pairs.length; pair_index += 1) {
      var left = this.left_lookback(pairs[pair_index]);
      var right = this.right_lookback(pairs[pair_index]);
      var left_column = this.lookback_column(derivative.left_output_prefix, left);
      var right_column = this.lookback_column(derivative.right_output_prefix, right);
      var output_column = this.pair_column(derivative.output_prefix, left, right);
      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        rows[row_index][output_column] = this.percent_change(rows[row_index][left_column], rows[row_index][right_column]);
      }
    }
  }

  add_pair_ratio(rows, derivative) {
    var pairs = derivative.comparison_pairs || [];
    for (var pair_index = 0; pair_index < pairs.length; pair_index += 1) {
      var left = Number(pairs[pair_index].numerator_lookback);
      var right = Number(pairs[pair_index].denominator_lookback);
      var left_column = this.lookback_column(derivative.numerator_output_prefix, left);
      var right_column = this.lookback_column(derivative.denominator_output_prefix, right);
      var output_column = this.pair_column(derivative.output_prefix, left, right);
      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        rows[row_index][output_column] = this.ratio(rows[row_index][left_column], rows[row_index][right_column]);
      }
    }
  }

  add_sma_momentum(rows, derivative) {
    for (var lookback_index = 0; lookback_index < derivative.lookbacks.length; lookback_index += 1) {
      var lookback = Number(derivative.lookbacks[lookback_index]);
      var input_column = this.lookback_column(derivative.input_output_prefix, lookback);
      var output_column = this.lookback_column(derivative.output_prefix, lookback);
      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        rows[row_index][output_column] = row_index === 0 ? null : this.percent_change(rows[row_index][input_column], rows[row_index - 1][input_column]);
      }
    }
  }

  apply_anomaly_cleaning(stock, rows) {
    var config = this.config.anomaly_cleaning || {};
    if (!config.enabled) return;

    var anomaly_indexes = [];
    var exclude_column = config.exclude_from_mining_column;
    var reason_column = config.anomaly_reason_column;
    this.anomaly_report.stocks[stock] = { anomaly_rows: 0, positive_anomaly_rows: 0, negative_anomaly_rows: 0, rows_excluded_from_mining: 0 };

    for (var row_index = 0; row_index < rows.length; row_index += 1) {
      rows[row_index][exclude_column] = false;
      rows[row_index][reason_column] = "";
      rows[row_index][config.daily_return_column] = row_index === 0 ? null : this.percent_change(rows[row_index][config.input_column], rows[row_index - 1][config.input_column]);
      var value = rows[row_index][config.daily_return_column];
      if (value !== null && value > Number(config.positive_threshold_pct)) {
        anomaly_indexes.push(row_index);
        this.record_anomaly(stock, "positive");
      } else if (value !== null && value < Number(config.negative_threshold_pct)) {
        anomaly_indexes.push(row_index);
        this.record_anomaly(stock, "negative");
      }
    }

    for (var anomaly_index = 0; anomaly_index < anomaly_indexes.length; anomaly_index += 1) {
      var center = anomaly_indexes[anomaly_index];
      var start = Math.max(0, center - Number(config.exclude_rows_before_anomaly));
      var end = Math.min(rows.length - 1, center + Number(config.exclude_rows_after_anomaly));
      for (var exclude_index = start; exclude_index <= end; exclude_index += 1) {
        if (!config.exclude_anomaly_row && exclude_index === center) continue;
        if (!rows[exclude_index][exclude_column]) {
          rows[exclude_index][exclude_column] = true;
          rows[exclude_index][reason_column] = "near_daily_return_anomaly";
          this.anomaly_report.rows_excluded_from_mining += 1;
          this.anomaly_report.stocks[stock].rows_excluded_from_mining += 1;
        }
      }
    }
  }

  record_anomaly(stock, direction) {
    this.anomaly_report.anomaly_rows += 1;
    this.anomaly_report.stocks[stock].anomaly_rows += 1;
    if (direction === "positive") {
      this.anomaly_report.positive_anomaly_rows += 1;
      this.anomaly_report.stocks[stock].positive_anomaly_rows += 1;
    } else {
      this.anomaly_report.negative_anomaly_rows += 1;
      this.anomaly_report.stocks[stock].negative_anomaly_rows += 1;
    }
  }

  empty_anomaly_report() {
    return { anomaly_rows: 0, positive_anomaly_rows: 0, negative_anomaly_rows: 0, rows_excluded_from_mining: 0, stocks: {} };
  }

  sma(rows, column, row_index, lookback) {
    if (row_index + 1 < lookback) return null;
    var total = 0;
    for (var index = row_index - lookback + 1; index <= row_index; index += 1) {
      if (rows[index][column] === null || rows[index][column] === undefined) return null;
      total += Number(rows[index][column]);
    }
    return total / lookback;
  }

  percent_change(current, previous) {
    if (current === null || current === undefined || previous === null || previous === undefined || Number(previous) === 0) return null;
    return ((Number(current) - Number(previous)) / Number(previous)) * 100;
  }

  ratio(left, right) {
    if (left === null || left === undefined || right === null || right === undefined || Number(right) === 0) return null;
    return Number(left) / Number(right);
  }

  left_lookback(pair) {
    if (pair.left_lookback !== undefined) return Number(pair.left_lookback);
    return Number(pair.numerator_lookback);
  }

  right_lookback(pair) {
    if (pair.right_lookback !== undefined) return Number(pair.right_lookback);
    return Number(pair.denominator_lookback);
  }

  lookback_column(prefix, lookback) {
    return prefix + "_" + lookback + "_day";
  }

  pair_column(prefix, left, right) {
    return prefix + "_" + left + "_day_vs_" + right + "_day";
  }

  clone_rows(rows) {
    var output = [];
    for (var row_index = 0; row_index < rows.length; row_index += 1) {
      var row = {};
      var keys = Object.keys(rows[row_index]);
      for (var key_index = 0; key_index < keys.length; key_index += 1) row[keys[key_index]] = rows[row_index][keys[key_index]];
      output.push(row);
    }
    return output;
  }
}

module.exports = { ohlcv_derivative_engine: ohlcv_derivative_engine };
