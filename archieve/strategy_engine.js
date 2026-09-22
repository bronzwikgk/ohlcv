// Coding instructions for this folder:
// - Do not use arrow functions.
// - Do not use forEach.
// - Do not use object/property shorthand.
// - Prefer explicit function declarations and plain loops.

import { RuleEngine } from "./rule_engine.js";
import {
  addColumn,
  getColumnIndex,
  setDataFrameValue,
  toNumber,
} from "./utility.js";

export function getStrategyValue(dataframe, rowIndex, columnName) {
  const columnIndex = getColumnIndex(dataframe, columnName);
  const dataRowIndex = rowIndex + 1;

  if (columnIndex === -1) {
    return null;
  }

  if (dataRowIndex < 1 || dataRowIndex >= dataframe.data.length) {
    return null;
  }

  return dataframe.data[dataRowIndex][columnIndex];
}

export function getStrategyNumber(dataframe, rowIndex, columnName) {
  return toNumber(getStrategyValue(dataframe, rowIndex, columnName));
}

export function getStrategyDate(dataframe, rowIndex) {
  const value = getStrategyValue(dataframe, rowIndex, "Date");

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

export function createTrade(strategyConfig, dataframe, entryRowIndex, entryPrice) {
  const trade = {
    strategy_name: strategyConfig.name,
    symbol: dataframe.symbol,
    entry_row_index: entryRowIndex,
    entry_date: getStrategyDate(dataframe, entryRowIndex),
    entry_price: entryPrice,
    exit_row_index: "",
    exit_date: "",
    exit_price: "",
    holding_days: "",
    exit_reason: "",
    change_pct: "",
    stop_price: "",
  };

  if (strategyConfig.stop_loss_type === "previous_low_before_entry") {
    trade.stop_price = getStrategyNumber(dataframe, entryRowIndex - 1, "Low");
  }

  return trade;
}

export function closeTrade(trade, dataframe, exitRowIndex, exitPrice, exitReason) {
  let changePct = null;

  if (trade.entry_price !== 0) {
    changePct = ((exitPrice - trade.entry_price) / trade.entry_price) * 100;
  }

  trade.exit_row_index = exitRowIndex;
  trade.exit_date = getStrategyDate(dataframe, exitRowIndex);
  trade.exit_price = exitPrice;
  trade.holding_days = exitRowIndex - trade.entry_row_index;
  trade.exit_reason = exitReason;
  trade.change_pct = changePct;

  return trade;
}

export function shouldExitOpenTrade(strategyConfig, dataframe, rowIndex, openTrade) {
  const closePrice = getStrategyNumber(dataframe, rowIndex, strategyConfig.exit_price_column);
  let changePct = null;
  let holdingDays = rowIndex - openTrade.entry_row_index;

  if (closePrice === null) {
    return "";
  }

  if (openTrade.entry_price !== 0) {
    changePct = ((closePrice - openTrade.entry_price) / openTrade.entry_price) * 100;
  }

  if (strategyConfig.stop_loss_type === "previous_low_before_entry") {
    if (openTrade.stop_price !== "" && openTrade.stop_price !== null) {
      if (closePrice < openTrade.stop_price) {
        return "previous_low_before_entry_stop";
      }
    }
  }

  if (strategyConfig.stop_rule) {
    const ruleEngine = new RuleEngine(dataframe);

    if (ruleEngine.evaluateRule(strategyConfig.stop_rule, rowIndex)) {
      return "stop_rule";
    }
  }

  if (changePct !== null && changePct >= strategyConfig.profit_target_pct) {
    return "profit_target_pct";
  }

  if (holdingDays >= strategyConfig.max_holding_days) {
    return "max_holding_days";
  }

  return "";
}

export function addStrategyColumns(dataframe, strategyConfig) {
  addColumn(dataframe, strategyConfig.entry_signal_column, 0);
  addColumn(dataframe, strategyConfig.exit_signal_column, 0);
  addColumn(dataframe, strategyConfig.position_column, 0);

  return dataframe;
}

export function applyStrategy(dataframe, strategyConfig) {
  const ruleEngine = new RuleEngine(dataframe);
  const trades = [];
  let openTrade = null;

  addStrategyColumns(dataframe, strategyConfig);

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    if (openTrade !== null) {
      const exitReason = shouldExitOpenTrade(strategyConfig, dataframe, rowIndex, openTrade);

      setDataFrameValue(dataframe, rowIndex, strategyConfig.position_column, 1);

      if (exitReason !== "") {
        const exitPrice = getStrategyNumber(dataframe, rowIndex, strategyConfig.exit_price_column);

        closeTrade(openTrade, dataframe, rowIndex, exitPrice, exitReason);
        trades.push(openTrade);
        setDataFrameValue(dataframe, rowIndex, strategyConfig.exit_signal_column, 1);
        setDataFrameValue(dataframe, rowIndex, strategyConfig.position_column, 0);
        openTrade = null;
      }
    }

    if (openTrade === null) {
      if (ruleEngine.evaluateRule(strategyConfig.entry_rule, rowIndex)) {
        const entryPrice = getStrategyNumber(dataframe, rowIndex, strategyConfig.entry_price_column);

        if (entryPrice !== null) {
          openTrade = createTrade(strategyConfig, dataframe, rowIndex, entryPrice);
          setDataFrameValue(dataframe, rowIndex, strategyConfig.entry_signal_column, 1);
          setDataFrameValue(dataframe, rowIndex, strategyConfig.position_column, 1);
        }
      }
    }
  }

  if (openTrade !== null && strategyConfig.close_open_trade_on_last_row) {
    const lastRowIndex = dataframe.rows.length - 1;
    const lastExitPrice = getStrategyNumber(dataframe, lastRowIndex, strategyConfig.exit_price_column);

    if (lastExitPrice !== null) {
      closeTrade(openTrade, dataframe, lastRowIndex, lastExitPrice, "end_of_data");
      trades.push(openTrade);
      setDataFrameValue(dataframe, lastRowIndex, strategyConfig.exit_signal_column, 1);
      setDataFrameValue(dataframe, lastRowIndex, strategyConfig.position_column, 0);
    }
  }

  return trades;
}

export function applyStrategies(dataframe, strategiesArray) {
  const allTrades = [];

  if (!Array.isArray(strategiesArray)) {
    return allTrades;
  }

  for (let strategyIndex = 0; strategyIndex < strategiesArray.length; strategyIndex += 1) {
    const trades = applyStrategy(dataframe, strategiesArray[strategyIndex]);

    for (let tradeIndex = 0; tradeIndex < trades.length; tradeIndex += 1) {
      allTrades.push(trades[tradeIndex]);
    }
  }

  return allTrades;
}

export function getMonthNumber(dateText) {
  const text = String(dateText || "");
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return null;
  }

  return year * 12 + month;
}

export function getDataFrameMonthCount(dataframe) {
  let firstMonthNumber = null;
  let lastMonthNumber = null;

  if (dataframe.rows.length === 0) {
    return 0;
  }

  firstMonthNumber = getMonthNumber(getStrategyDate(dataframe, 0));
  lastMonthNumber = getMonthNumber(getStrategyDate(dataframe, dataframe.rows.length - 1));

  if (firstMonthNumber === null || lastMonthNumber === null) {
    return 0;
  }

  return lastMonthNumber - firstMonthNumber + 1;
}

export function createStrategyReport(dataframe, trades) {
  let totalTrades = trades.length;
  let winningTrades = 0;
  let losingTrades = 0;
  let totalReturnPct = 0;
  let averageReturnPerTrade = 0;
  let accuracy = 0;
  let monthCount = getDataFrameMonthCount(dataframe);
  let avgReturnPerMonth = 0;
  let avgReturnPerAnnum = 0;
  let maxGainPct = null;
  let maxLossPct = null;
  const exitReasons = {};

  for (let tradeIndex = 0; tradeIndex < trades.length; tradeIndex += 1) {
    const trade = trades[tradeIndex];
    const changePct = toNumber(trade.change_pct);

    if (exitReasons[trade.exit_reason] === undefined) {
      exitReasons[trade.exit_reason] = 0;
    }

    exitReasons[trade.exit_reason] += 1;

    if (changePct === null) {
      continue;
    }

    totalReturnPct += changePct;

    if (changePct > 0) {
      winningTrades += 1;
    } else {
      losingTrades += 1;
    }

    if (maxGainPct === null || changePct > maxGainPct) {
      maxGainPct = changePct;
    }

    if (maxLossPct === null || changePct < maxLossPct) {
      maxLossPct = changePct;
    }
  }

  if (totalTrades > 0) {
    accuracy = winningTrades / totalTrades;
    averageReturnPerTrade = totalReturnPct / totalTrades;
  }

  if (monthCount > 0) {
    avgReturnPerMonth = totalReturnPct / monthCount;
    avgReturnPerAnnum = avgReturnPerMonth * 12;
  }

  return {
    total_trades: totalTrades,
    winning_trades: winningTrades,
    losing_trades: losingTrades,
    accuracy: accuracy,
    accuracy_pct: accuracy * 100,
    total_return_pct: totalReturnPct,
    average_return_per_trade_pct: averageReturnPerTrade,
    avg_return_per_month_pct: avgReturnPerMonth,
    avg_return_per_annum_pct: avgReturnPerAnnum,
    max_gain_pct: maxGainPct,
    max_loss_pct: maxLossPct,
    calendar_month_count: monthCount,
    exit_reasons: exitReasons,
  };
}
