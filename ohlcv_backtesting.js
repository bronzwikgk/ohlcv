"use strict";

class ohlcv_backtester {
  constructor(config) {
    this.config = config;
  }

  run(testing_collection, selected_conditions) {
    if (!this.config.backtesting.enabled) {
      return { enabled: false, trades: [], metrics: {}, selected_conditions: {}, diagnostics: {}, recipe_reports: [] };
    }

    var full_report = this.run_single(testing_collection, selected_conditions);
    full_report.recipe_reports = this.run_recipes(testing_collection, selected_conditions);
    return full_report;
  }

  run_single(testing_collection, selected_conditions) {
    var trades = [];
    var capital = Number(this.config.backtesting.initial_capital);
    var equity = capital;
    var diagnostics = this.strategy_diagnostics(testing_collection, selected_conditions);
    var selected_summary = this.selected_condition_summary(selected_conditions);
    var signals = this.collect_signals(testing_collection, selected_conditions);
    var open_trades = [];

    for (var signal_index = 0; signal_index < signals.length; signal_index += 1) {
      var signal = signals[signal_index];
      open_trades = this.open_trades_after_date(open_trades, signal.entry_row.date);
      if (!this.can_open_trade(open_trades, signal.stock)) continue;

      var trade = this.create_trade(signal.stock, signal.signal_row, signal.rows, signal.entry_index, equity, selected_conditions);
      if (!trade) continue;
      trades.push(trade);
      open_trades.push(trade);
      equity += trade.net_pnl;
    }

    return { enabled: true, trades: trades, metrics: this.metrics(capital, equity, trades), selected_conditions: selected_summary, diagnostics: diagnostics };
  }

  run_recipes(testing_collection, selected_conditions) {
    var recipes = this.config.backtesting.strategy_recipes || [];
    var out = [];
    for (var recipe_index = 0; recipe_index < recipes.length; recipe_index += 1) {
      var recipe = recipes[recipe_index];
      var recipe_selected = this.selected_for_recipe(selected_conditions, recipe);
      var report = this.run_single(testing_collection, recipe_selected);
      out.push({
        name: recipe.name || ("recipe_" + (recipe_index + 1)),
        roles: (recipe.roles || []).join(" + "),
        metrics: report.metrics,
        diagnostics: report.diagnostics,
        selected_conditions: report.selected_conditions
      });
    }
    return out;
  }

  selected_for_recipe(selected_conditions, recipe) {
    var roles = ["regime", "setup", "trigger", "quality", "risk_avoid"];
    var selected = { regime: [], setup: [], trigger: [], quality: [], risk_avoid: [] };
    var recipe_roles = recipe.roles || [];
    for (var role_index = 0; role_index < roles.length; role_index += 1) {
      var role = roles[role_index];
      if (this.role_in_recipe(role, recipe_roles)) selected[role] = (selected_conditions[role] || []).slice(0);
    }
    return selected;
  }

  role_in_recipe(role, recipe_roles) {
    for (var index = 0; index < recipe_roles.length; index += 1) if (recipe_roles[index] === role) return true;
    return false;
  }

  row_passes_strategy(row, selected) {
    if (!this.row_passes_base_conditions(row)) return false;
    if (!this.conditions_pass(row, selected.regime || [], "AND")) return false;
    if (!this.conditions_pass(row, selected.setup || [], "AND")) return false;
    if (!this.conditions_pass(row, selected.trigger || [], "AND")) return false;
    if (!this.conditions_pass(row, selected.quality || [], "AND")) return false;
    if (this.conditions_pass(row, selected.risk_avoid || [], "OR")) return false;
    return true;
  }

  conditions_pass(row, conditions, operator) {
    if (!conditions.length) return operator === "AND";
    for (var index = 0; index < conditions.length; index += 1) {
      var passed = this.row_matches_condition(row, conditions[index]);
      if (operator === "AND" && !passed) return false;
      if (operator === "OR" && passed) return true;
    }
    return operator === "AND";
  }

  strategy_diagnostics(testing_collection, selected) {
    var rows = this.flatten_rows(testing_collection);
    var funnel = [];
    var active_rows = rows;
    funnel.push(this.funnel_row("testing_rows", "All usable testing rows", rows.length, rows.length));

    active_rows = this.filter_by_base_conditions(active_rows);
    funnel.push(this.funnel_row("after_base_conditions", "After base conditions", active_rows.length, rows.length));

    active_rows = this.filter_by_conditions(active_rows, selected.regime || [], "AND", false);
    funnel.push(this.funnel_row("after_regime", "After regime filters", active_rows.length, rows.length));

    active_rows = this.filter_by_conditions(active_rows, selected.setup || [], "AND", false);
    funnel.push(this.funnel_row("after_setup", "After setup filters", active_rows.length, rows.length));

    active_rows = this.filter_by_conditions(active_rows, selected.trigger || [], "AND", false);
    funnel.push(this.funnel_row("after_entry", "After entry filters", active_rows.length, rows.length));

    active_rows = this.filter_by_conditions(active_rows, selected.quality || [], "AND", false);
    funnel.push(this.funnel_row("after_quality", "After quality filters", active_rows.length, rows.length));

    active_rows = this.filter_by_conditions(active_rows, selected.risk_avoid || [], "OR", true);
    funnel.push(this.funnel_row("after_ignore_filters", "After ignore filters", active_rows.length, rows.length));

    return { funnel: funnel, entry_rows: active_rows.length };
  }

  filter_by_base_conditions(rows) {
    var output = [];
    for (var index = 0; index < rows.length; index += 1) {
      if (this.row_passes_base_conditions(rows[index])) output.push(rows[index]);
    }
    return output;
  }

  funnel_row(key, label, remaining, total) {
    return {
      key: key,
      label: label,
      remaining_rows: remaining,
      removed_rows: total - remaining,
      remaining_pct: total ? (remaining / total) * 100 : 0
    };
  }

  filter_by_conditions(rows, conditions, operator, invert) {
    var output = [];
    for (var index = 0; index < rows.length; index += 1) {
      var passed = this.conditions_pass(rows[index], conditions, operator);
      if (invert) passed = !passed;
      if (passed) output.push(rows[index]);
    }
    return output;
  }

  flatten_rows(collection) {
    var rows = [];
    var stock_names = Object.keys(collection || {});
    for (var stock_index = 0; stock_index < stock_names.length; stock_index += 1) {
      var stock_rows = collection[stock_names[stock_index]] || [];
      for (var row_index = 0; row_index < stock_rows.length; row_index += 1) {
        if (stock_rows[row_index].__exclude_from_mining) continue;
        rows.push(stock_rows[row_index]);
      }
    }
    return rows;
  }

  selected_condition_summary(selected) {
    var roles = ["regime", "setup", "trigger", "quality", "risk_avoid"];
    var summary = {};
    summary.base_conditions = this.base_condition_summary();
    for (var role_index = 0; role_index < roles.length; role_index += 1) {
      var role = roles[role_index];
      var conditions = selected[role] || [];
      summary[role] = [];
      for (var condition_index = 0; condition_index < conditions.length; condition_index += 1) {
        summary[role].push({
          role: role,
          family: conditions[condition_index].family || "",
          condition_type: conditions[condition_index].condition_type || "",
          expression: conditions[condition_index].expression || "",
          testing_density_pct: conditions[condition_index].testing_density_pct,
          testing_coverage_pct: conditions[condition_index].testing_coverage_pct,
          training_density_pct: conditions[condition_index].training_density_pct,
          training_coverage_pct: conditions[condition_index].training_coverage_pct
        });
      }
    }
    return summary;
  }

  base_condition_summary() {
    var base = this.config.base_conditions || {};
    var output = [];
    if (!base.enabled) return output;
    var conditions = base.conditions || [];
    for (var index = 0; index < conditions.length; index += 1) {
      output.push({
        role: "base",
        family: "configured",
        condition_type: conditions[index].type || "",
        expression: conditions[index].expression || this.condition_expression(conditions[index])
      });
    }
    return output;
  }

  condition_expression(condition) {
    if (condition.type === "relative_pair_compare") return condition.left_column + " " + condition.operator + " " + condition.right_column;
    if (condition.type === "threshold_compare") return condition.column + " " + condition.operator + " " + condition.right_value;
    if (condition.type === "range" || condition.type === "avoid_range") return condition.column + " between " + condition.min_value + " and " + condition.max_value;
    return "";
  }

  row_passes_base_conditions(row) {
    var base = this.config.base_conditions || {};
    if (!base.enabled) return true;
    return this.conditions_pass(row, base.conditions || [], base.operator || "AND");
  }

  row_matches_condition(row, condition) {
    var instruction = condition.instruction || condition;
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
    left = Number(left); right = Number(right);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    if (operator === "<=") return left <= right;
    return left === right;
  }

  collect_signals(testing_collection, selected_conditions) {
    var signals = [];
    var stock_names = Object.keys(testing_collection || {});
    for (var stock_index = 0; stock_index < stock_names.length; stock_index += 1) {
      var stock = stock_names[stock_index];
      var rows = testing_collection[stock] || [];
      for (var row_index = 0; row_index < rows.length - 1; row_index += 1) {
        if (rows[row_index].__exclude_from_mining) continue;
        if (!this.row_passes_strategy(rows[row_index], selected_conditions)) continue;
        signals.push({ stock: stock, rows: rows, signal_row: rows[row_index], entry_row: rows[row_index + 1], entry_index: row_index + 1 });
      }
    }
    signals.sort(function compare(left, right) {
      return left.entry_row.date - right.entry_row.date;
    });
    return signals;
  }

  open_trades_after_date(open_trades, date) {
    var output = [];
    for (var index = 0; index < open_trades.length; index += 1) {
      if (new Date(open_trades[index].exit_date) > date) output.push(open_trades[index]);
    }
    return output;
  }

  can_open_trade(open_trades, stock) {
    var risk = this.config.backtesting.risk || {};
    if (open_trades.length >= Number(risk.maximum_open_positions)) return false;
    if (risk.allow_multiple_entries_same_stock === false) {
      for (var index = 0; index < open_trades.length; index += 1) if (open_trades[index].stock === stock) return false;
    }
    return true;
  }

  create_trade(stock, signal_row, rows, entry_index, equity, selected_conditions) {
    var entry_row = rows[entry_index];
    if (!entry_row) return null;
    var exit = this.find_exit(rows, entry_index);
    if (!exit) return null;
    var allocation = this.trade_allocation(equity, stock);
    var entry_price = this.apply_slippage(Number(entry_row.adj_close), "buy");
    var exit_price = this.apply_slippage(Number(exit.row.adj_close), "sell");
    if (!Number.isFinite(entry_price) || entry_price <= 0 || !Number.isFinite(exit_price)) return null;
    var shares = Math.floor(allocation / entry_price);
    if (shares <= 0) return null;
    var buy_value = entry_price * shares;
    var sell_value = exit_price * shares;
    var gross_pnl = (exit_price - entry_price) * shares;
    var costs = this.trade_costs(buy_value, sell_value);
    var net_pnl = gross_pnl - costs;
    var pnl_pct = entry_price ? ((exit_price - entry_price) / entry_price) * 100 : 0;
    return { stock: stock, signal_date: this.date_text(signal_row.date), entry_date: this.date_text(entry_row.date), exit_date: this.date_text(exit.row.date), entry_price: entry_price, exit_price: exit_price, shares: shares, gross_pnl: gross_pnl, costs: costs, net_pnl: net_pnl, pnl_pct: pnl_pct, exit_reason: exit.reason, condition_details: this.condition_details(signal_row, selected_conditions) };
  }

  trade_allocation(equity, stock) {
    var sizing = this.config.backtesting.position_sizing || {};
    var risk = this.config.backtesting.risk || {};
    var allocation = equity * (Number(sizing.value) / 100);
    var max_stock_allocation = equity * (Number(risk.maximum_allocation_per_stock_pct) / 100);
    if (Number.isFinite(max_stock_allocation) && max_stock_allocation > 0 && allocation > max_stock_allocation) allocation = max_stock_allocation;
    return allocation;
  }

  find_exit(rows, entry_index) {
    var holding = this.config.backtesting.holding || {};
    var stop_set = this.config.backtesting.rule_sets.stop_loss_set || {};
    var max_holding_days = Number(holding.max_holding_days);
    var entry_price = Number(rows[entry_index].adj_close);
    var highest_price = entry_price;
    var end_index = Math.min(rows.length - 1, entry_index + max_holding_days);

    for (var index = entry_index + 1; index <= end_index; index += 1) {
      var price = Number(rows[index].adj_close);
      if (!Number.isFinite(price)) continue;
      if (price > highest_price) highest_price = price;
      if (stop_set.fixed_percent_loss && stop_set.fixed_percent_loss.enabled && price <= entry_price * (1 - Number(stop_set.fixed_percent_loss.value) / 100)) return { row: rows[index], reason: "stop_loss" };
      if (stop_set.take_profit && stop_set.take_profit.enabled && price >= entry_price * (1 + Number(stop_set.take_profit.value) / 100)) return { row: rows[index], reason: "take_profit" };
      if (stop_set.trailing_percent && stop_set.trailing_percent.enabled && price <= highest_price * (1 - Number(stop_set.trailing_percent.trail_value) / 100)) return { row: rows[index], reason: "trailing_stop" };
    }

    if (end_index <= entry_index) return null;
    return { row: rows[end_index], reason: "max_holding_days" };
  }

  apply_slippage(price, side) {
    var slippage = this.config.backtesting.execution.slippage || {};
    if (!slippage.enabled || slippage.mode !== "bps") return price;
    var multiplier = Number(slippage.value) / 10000;
    if (side === "buy") return price * (1 + multiplier);
    return price * (1 - multiplier);
  }

  trade_costs(buy_value, sell_value) {
    var execution = this.config.backtesting.execution || {};
    var cost = 0;
    if (execution.broker_fees && execution.broker_fees.enabled && execution.broker_fees.mode === "percent_per_side") {
      cost += buy_value * Number(execution.broker_fees.value);
      cost += sell_value * Number(execution.broker_fees.value);
    }
    if (execution.taxes && execution.taxes.enabled && execution.taxes.mode === "percent") {
      cost += buy_value * Number(execution.taxes.buy_value);
      cost += sell_value * Number(execution.taxes.sell_value);
    }
    if (Number(execution.per_trade_minimum_cost) > cost) cost = Number(execution.per_trade_minimum_cost);
    return cost;
  }

  condition_details(row, selected) {
    var roles = ["regime", "setup", "trigger", "quality", "risk_avoid"];
    var details = [];
    for (var role_index = 0; role_index < roles.length; role_index += 1) {
      var role = roles[role_index];
      var conditions = selected[role] || [];
      for (var condition_index = 0; condition_index < conditions.length; condition_index += 1) {
        details.push({
          role: role,
          expression: conditions[condition_index].expression || "",
          values: this.condition_values(row, conditions[condition_index])
        });
      }
    }
    return details;
  }

  condition_values(row, condition) {
    var values = [];
    var instruction = condition.instruction || condition;
    if (instruction.column) {
      values.push({ column: instruction.column, value: row[instruction.column] });
      return values;
    }
    if (instruction.left_column) {
      values.push({ column: instruction.left_column, value: row[instruction.left_column] });
      values.push({ column: instruction.right_column, value: row[instruction.right_column] });
    }
    return values;
  }

  metrics(initial_capital, final_equity, trades) {
    var wins = 0;
    var gross_profit = 0;
    var gross_loss = 0;
    for (var index = 0; index < trades.length; index += 1) {
      if (trades[index].net_pnl >= 0) {
        wins += 1; gross_profit += trades[index].net_pnl;
      } else {
        gross_loss += Math.abs(trades[index].net_pnl);
      }
    }
    return { initial_capital: initial_capital, final_equity: final_equity, total_return_pct: initial_capital ? ((final_equity - initial_capital) / initial_capital) * 100 : 0, total_trades: trades.length, win_rate_pct: trades.length ? (wins / trades.length) * 100 : 0, profit_factor: gross_loss ? gross_profit / gross_loss : 0, statistically_significant: trades.length >= 30 };
  }

  date_text(date) {
    if (!(date instanceof Date)) return String(date);
    return date.toISOString().slice(0, 10);
  }
}

module.exports = { ohlcv_backtester: ohlcv_backtester };
