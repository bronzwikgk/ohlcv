"use strict";

class ohlcv_backtester {
  constructor(config) {
    this.config = config;
  }

  run(testing_collection, selected_conditions) {
    if (!this.config.backtesting.enabled) {
      return { enabled: false, trades: [], metrics: {} };
    }

    var trades = [];
    var stock_names = Object.keys(testing_collection || {});
    var capital = Number(this.config.backtesting.initial_capital);
    var equity = capital;

    for (var stock_index = 0; stock_index < stock_names.length; stock_index += 1) {
      var stock = stock_names[stock_index];
      var rows = testing_collection[stock];

      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        if (!this.row_passes_strategy(rows[row_index], selected_conditions)) continue;
        var exit_index = Math.min(rows.length - 1, row_index + Number(this.config.backtesting.holding.max_holding_days));
        if (exit_index <= row_index) continue;
        var trade = this.create_trade(stock, rows[row_index], rows[exit_index], equity);
        trades.push(trade);
        equity += trade.net_pnl;
      }
    }

    return { enabled: true, trades: trades, metrics: this.metrics(capital, equity, trades) };
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
    if (!conditions.length) return operator === "AND";
    for (var index = 0; index < conditions.length; index += 1) {
      var passed = this.row_matches_expression(row, conditions[index]);
      if (operator === "AND" && !passed) return false;
      if (operator === "OR" && passed) return true;
    }
    return operator === "AND";
  }

  row_matches_expression(row, condition) {
    var expression = condition.expression || "";
    var parts;
    if (expression.indexOf(" between ") !== -1) {
      parts = expression.split(" ");
      var column = parts[0];
      var min_value = Number(parts[2]);
      var max_value = Number(parts[4]);
      return row[column] !== null && row[column] !== undefined && Number(row[column]) >= min_value && Number(row[column]) <= max_value;
    }
    parts = expression.split(" ");
    if (parts.length !== 3) return false;
    var left = row[parts[0]];
    var right = row[parts[2]];
    if (right === undefined) right = Number(parts[2]);
    return this.compare(left, parts[1], right);
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

  create_trade(stock, entry_row, exit_row, equity) {
    var allocation = equity * (Number(this.config.backtesting.position_sizing.value) / 100);
    var entry_price = Number(entry_row.adj_close);
    var exit_price = Number(exit_row.adj_close);
    var shares = Math.floor(allocation / entry_price);
    var gross_pnl = (exit_price - entry_price) * shares;
    var pnl_pct = entry_price ? ((exit_price - entry_price) / entry_price) * 100 : 0;
    return { stock: stock, entry_date: this.date_text(entry_row.date), exit_date: this.date_text(exit_row.date), entry_price: entry_price, exit_price: exit_price, shares: shares, gross_pnl: gross_pnl, net_pnl: gross_pnl, pnl_pct: pnl_pct, exit_reason: "max_holding_days" };
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
    return { initial_capital: initial_capital, final_equity: final_equity, total_return_pct: initial_capital ? ((final_equity - initial_capital) / initial_capital) * 100 : 0, total_trades: trades.length, win_rate_pct: trades.length ? (wins / trades.length) * 100 : 0, profit_factor: gross_loss ? gross_profit / gross_loss : 0 };
  }

  date_text(date) {
    if (!(date instanceof Date)) return String(date);
    return date.toISOString().slice(0, 10);
  }
}

module.exports = { ohlcv_backtester: ohlcv_backtester };
