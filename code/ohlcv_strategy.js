"use strict";

const backtesting_module = require("./ohlcv_backtesting");

class ohlcv_strategy_optimizer {
  constructor(config) {
    this.config = config;
  }

  run(mining_collection, testing_collection) {
    var strategy_config = this.active_strategy_config();
    if (!strategy_config || strategy_config.enabled === false) {
      return { enabled: false, strategy_name: "", variants: [] };
    }

    var mining_rows = this.flatten(mining_collection);
    var testing_rows = this.flatten(testing_collection);
    var variants = this.build_variants(strategy_config);
    var target = this.target_config();
    var scored = [];

    for (var index = 0; index < variants.length; index += 1) {
      var variant = variants[index];
      var training = this.score(mining_rows, variant.selected_conditions, target);
      var testing = this.score(testing_rows, variant.selected_conditions, target);
      scored.push({
        name: variant.name,
        concept: strategy_config.description || "",
        parameters: variant.parameters,
        selected_conditions: variant.selected_conditions,
        training_density_pct: training.density_pct,
        testing_density_pct: testing.density_pct,
        training_coverage_pct: training.coverage_pct,
        testing_coverage_pct: testing.coverage_pct,
        training_matches: training.matches,
        testing_matches: testing.matches,
        training_hits: training.hits,
        testing_hits: testing.hits
      });
    }

    scored = this.rank(scored, strategy_config);
    if (strategy_config.backtest_variants === true) this.add_backtests(scored, testing_collection, strategy_config);
    return { enabled: true, strategy_name: this.config.strategies.active_strategy, description: strategy_config.description || "", variants: scored };
  }

  active_strategy_config() {
    var strategies = this.config.strategies || {};
    var definitions = strategies.definitions || {};
    return definitions[strategies.active_strategy];
  }

  target_config() {
    var target = this.config.target_returns;
    var mining = this.config.mining || {};
    return {
      column: target.output_prefix + "_" + (mining.target_periods || target.periods)[0] + "_day",
      threshold: (mining.target_thresholds_pct || target.thresholds_pct)[0]
    };
  }

  build_variants(strategy_config) {
    var parameter_grid = strategy_config.parameter_grid || {};
    var pullback_columns = parameter_grid.pullback_columns || [];
    var pullback_ranges = parameter_grid.pullback_ranges || [];
    var trigger_returns = parameter_grid.trigger_daily_return_gt || [];
    var max_extensions = parameter_grid.max_close_vs_sma21 || [];
    var variants = [];

    for (var column_index = 0; column_index < pullback_columns.length; column_index += 1) {
      for (var range_index = 0; range_index < pullback_ranges.length; range_index += 1) {
        for (var trigger_index = 0; trigger_index < trigger_returns.length; trigger_index += 1) {
          for (var extension_index = 0; extension_index < max_extensions.length; extension_index += 1) {
            var params = {
              pullback_column: pullback_columns[column_index],
              pullback_min: pullback_ranges[range_index][0],
              pullback_max: pullback_ranges[range_index][1],
              trigger_daily_return_gt: trigger_returns[trigger_index],
              max_close_vs_sma21: max_extensions[extension_index]
            };
            variants.push({ name: "sma_pullback_" + (variants.length + 1), parameters: params, selected_conditions: this.conditions_for_params(params) });
          }
        }
      }
    }

    return variants;
  }

  conditions_for_params(params) {
    return {
      regime: [
        this.pair_condition("adj_close_sma_21_day", ">", "adj_close_sma_55_day"),
        this.threshold_condition("adj_close_sma_slope_pct_55_day", ">", 0)
      ],
      setup: [
        this.range_condition(params.pullback_column, params.pullback_min, params.pullback_max)
      ],
      trigger: [
        this.threshold_condition("adj_close_daily_return_pct", ">", params.trigger_daily_return_gt)
      ],
      quality: [],
      risk_avoid: [
        this.threshold_condition("adj_close_vs_sma_pct_21_day", ">", params.max_close_vs_sma21)
      ]
    };
  }

  threshold_condition(column, operator, value) {
    return { expression: column + " " + operator + " " + value, instruction: { type: "threshold_compare", column: column, operator: operator, right_value: value } };
  }

  pair_condition(left_column, operator, right_column) {
    return { expression: left_column + " " + operator + " " + right_column, instruction: { type: "relative_pair_compare", left_column: left_column, operator: operator, right_column: right_column } };
  }

  range_condition(column, min_value, max_value) {
    return { expression: column + " between " + min_value + " and " + max_value, instruction: { type: "range", column: column, min_value: min_value, max_value: max_value } };
  }

  add_backtests(variants, testing_collection, strategy_config) {
    var backtester = new backtesting_module.ohlcv_backtester(this.config);
    var max_backtests = Number(strategy_config.backtest_top_n);
    if (!Number.isFinite(max_backtests) || max_backtests < 1) max_backtests = variants.length;
    for (var index = 0; index < variants.length && index < max_backtests; index += 1) {
      var report = backtester.run_single(testing_collection, variants[index].selected_conditions);
      variants[index].backtest_metrics = report.metrics;
      variants[index].backtest_entry_rows = report.diagnostics.entry_rows;
    }
  }

  rank(variants, strategy_config) {
    var minimum_matches = Number(strategy_config.minimum_training_matches);
    var out = [];
    for (var index = 0; index < variants.length; index += 1) {
      if (Number.isFinite(minimum_matches) && variants[index].training_matches < minimum_matches) continue;
      out.push(variants[index]);
    }
    out.sort(function compare(left, right) {
      if (right.training_density_pct !== left.training_density_pct) return right.training_density_pct - left.training_density_pct;
      return right.training_coverage_pct - left.training_coverage_pct;
    });
    return out.slice(0, Number(strategy_config.top_n || 20));
  }

  score(rows, selected_conditions, target) {
    var matches = 0;
    var hits = 0;
    var total_hits = 0;
    for (var index = 0; index < rows.length; index += 1) {
      var target_value = rows[index][target.column];
      if (target_value === null || target_value === undefined) continue;
      if (Number(target_value) >= Number(target.threshold)) total_hits += 1;
      if (!this.row_passes_strategy(rows[index], selected_conditions)) continue;
      matches += 1;
      if (Number(target_value) >= Number(target.threshold)) hits += 1;
    }
    return { matches: matches, hits: hits, density_pct: this.percent(hits, matches), coverage_pct: this.percent(hits, total_hits) };
  }

  row_passes_strategy(row, selected) {
    if (!this.conditions_pass(row, selected.regime || [], "AND")) return false;
    if (!this.conditions_pass(row, selected.setup || [], "AND")) return false;
    if (!this.conditions_pass(row, selected.trigger || [], "AND")) return false;
    if (!this.conditions_pass(row, selected.quality || [], "AND")) return false;
    if (this.conditions_pass(row, selected.risk_avoid || [], "OR")) return false;
    return true;
  }

  conditions_pass(row, conditions, operator) {
    if (!conditions || !conditions.length) return operator === "AND";
    for (var index = 0; index < conditions.length; index += 1) {
      var passed = this.matches(row, conditions[index].instruction || conditions[index]);
      if (operator === "AND" && !passed) return false;
      if (operator === "OR" && passed) return true;
    }
    return operator === "AND";
  }

  matches(row, instruction) {
    if (instruction.type === "threshold_compare") return this.compare(row[instruction.column], instruction.operator, instruction.right_value);
    if (instruction.type === "relative_pair_compare") return this.compare(row[instruction.left_column], instruction.operator, row[instruction.right_column]);
    if (instruction.type === "range" || instruction.type === "avoid_range") return this.value_between(row[instruction.column], Number(instruction.min_value), Number(instruction.max_value));
    return false;
  }

  value_between(value, min_value, max_value) {
    if (value === null || value === undefined) return false;
    value = Number(value);
    return Number.isFinite(value) && value >= min_value && value <= max_value;
  }

  compare(left, operator, right) {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    left = Number(left);
    right = Number(right);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    if (operator === "<=") return left <= right;
    return left === right;
  }

  flatten(collection) {
    var rows = [];
    var stock_names = Object.keys(collection || {});
    for (var stock_index = 0; stock_index < stock_names.length; stock_index += 1) {
      var stock_rows = collection[stock_names[stock_index]] || [];
      for (var row_index = 0; row_index < stock_rows.length; row_index += 1) {
        if (stock_rows[row_index].__exclude_from_mining) continue;
        if (!this.row_passes_base_conditions(stock_rows[row_index])) continue;
        rows.push(stock_rows[row_index]);
      }
    }
    return rows;
  }

  row_passes_base_conditions(row) {
    var base = this.config.base_conditions || {};
    if (!base.enabled) return true;
    return this.conditions_pass(row, base.conditions || [], base.operator || "AND");
  }

  percent(a, b) {
    return b ? (Number(a) / Number(b)) * 100 : 0;
  }
}

module.exports = { ohlcv_strategy_optimizer: ohlcv_strategy_optimizer };
