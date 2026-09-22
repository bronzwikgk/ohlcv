// Coding instructions for this folder:
// - Do not use arrow functions.
// - Do not use forEach.
// - Do not use object/property shorthand.
// - Prefer explicit function declarations and plain loops.

import {
  createDataFrame,
  dataFrameToCsv,
  getColumnIndex,
  toNumber,
} from "./utility.js";
import {
  applyStrategy,
  createStrategyReport,
} from "./strategy_engine.js";
import { RuleEngine } from "./rule_engine.js";

export function getDataFrameValue(dataframe, rowIndex, columnName) {
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

export function isRelativeBaseMiningColumn(columnName) {
  if (columnName.indexOf("_difference_pct") !== -1) {
    return true;
  }

  if (columnName.indexOf("_ratio") !== -1) {
    return true;
  }

  if (columnName.indexOf("_slope_pct") !== -1) {
    return true;
  }

  if (columnName.indexOf("_volatility_") !== -1) {
    return true;
  }

  if (columnName.indexOf("_range_") !== -1) {
    return true;
  }

  if (columnName.indexOf("_spread_pct") !== -1) {
    return true;
  }

  if (columnName.indexOf("_change_pct") !== -1 && columnName !== "target_change_pct") {
    return true;
  }

  if (columnName.indexOf("_state") !== -1) {
    return true;
  }

  if (columnName.indexOf("_score") !== -1) {
    return true;
  }

  return false;
}

export function isNumericBaseMiningColumn(dataframe, columnName) {
  let numericCount = 0;

  if (!isRelativeBaseMiningColumn(columnName)) {
    return false;
  }

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    if (toNumber(getDataFrameValue(dataframe, rowIndex, columnName)) !== null) {
      numericCount += 1;
    }

    if (numericCount >= 5) {
      return true;
    }
  }

  return false;
}

export function getBaseMiningFeatureColumns(dataframe) {
  const featureColumns = [];

  for (let columnIndex = 0; columnIndex < dataframe.columns.length; columnIndex += 1) {
    const columnName = dataframe.columns[columnIndex];

    if (isNumericBaseMiningColumn(dataframe, columnName)) {
      featureColumns.push(columnName);
    }
  }

  return featureColumns;
}

export function calculateForwardChangePct(dataframe, rowIndex, priceColumn, forwardRows) {
  const currentPrice = toNumber(getDataFrameValue(dataframe, rowIndex, priceColumn));
  const futurePrice = toNumber(getDataFrameValue(dataframe, rowIndex + forwardRows, priceColumn));

  if (currentPrice === null || futurePrice === null) {
    return null;
  }

  if (currentPrice === 0) {
    return null;
  }

  return ((futurePrice - currentPrice) / currentPrice) * 100;
}

export function buildBaseEntryCaseRows(dataframe, configObject, featureColumns) {
  const rows = [];
  const targetConfig = configObject.target_labeling;
  const ruleEngine = new RuleEngine(dataframe);
  let priceColumn = "Close";
  const forwardRows = targetConfig.target_time;
  let caseFilterRule = null;

  if (targetConfig.price_column !== undefined) {
    priceColumn = targetConfig.price_column;
  }

  if (configObject.base_entry_miner !== undefined && configObject.base_entry_miner.case_filter_rule !== undefined) {
    caseFilterRule = configObject.base_entry_miner.case_filter_rule;
  }

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    const targetLabel = getDataFrameValue(dataframe, rowIndex, targetConfig.target_label_column);
    const forwardChangePct = calculateForwardChangePct(dataframe, rowIndex, priceColumn, forwardRows);

    if (caseFilterRule !== null && !ruleEngine.evaluateRule(caseFilterRule, rowIndex)) {
      continue;
    }

    if (forwardChangePct === null) {
      continue;
    }

    const caseRow = {
      row_index: rowIndex,
      date: String(getDataFrameValue(dataframe, rowIndex, "Date")),
      forward_change_pct: forwardChangePct,
      is_win: 0,
      is_loss: 1,
    };

    if (String(targetLabel) === "1") {
      caseRow.is_win = 1;
      caseRow.is_loss = 0;
    }

    for (let featureIndex = 0; featureIndex < featureColumns.length; featureIndex += 1) {
      const featureName = featureColumns[featureIndex];
      caseRow[featureName] = getDataFrameValue(dataframe, rowIndex, featureName);
    }

    rows.push(caseRow);
  }

  return rows;
}

export function collectFeatureValues(rows, featureName) {
  const values = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const value = toNumber(rows[rowIndex][featureName]);

    if (value !== null) {
      values.push(value);
    }
  }

  values.sort(function(leftValue, rightValue) {
    return leftValue - rightValue;
  });

  return values;
}

export function getQuantileValue(sortedValues, quantile) {
  let index = 0;

  if (sortedValues.length === 0) {
    return null;
  }

  index = Math.floor((sortedValues.length - 1) * quantile);

  if (index < 0) {
    index = 0;
  }

  if (index >= sortedValues.length) {
    index = sortedValues.length - 1;
  }

  return sortedValues[index];
}

export function thresholdExists(thresholds, value) {
  for (let thresholdIndex = 0; thresholdIndex < thresholds.length; thresholdIndex += 1) {
    if (thresholds[thresholdIndex] === value) {
      return true;
    }
  }

  return false;
}

export function buildThresholds(values) {
  const thresholds = [];
  const quantiles = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90];

  for (let quantileIndex = 0; quantileIndex < quantiles.length; quantileIndex += 1) {
    const threshold = getQuantileValue(values, quantiles[quantileIndex]);

    if (threshold !== null && !thresholdExists(thresholds, threshold)) {
      thresholds.push(threshold);
    }
  }

  return thresholds;
}

export function conditionMatches(row, condition) {
  const value = toNumber(row[condition.feature]);

  if (value === null) {
    return false;
  }

  if (condition.operator === ">=") {
    return value >= condition.threshold;
  }

  if (condition.operator === "<=") {
    return value <= condition.threshold;
  }

  return false;
}

export function groupMatches(row, conditions) {
  for (let conditionIndex = 0; conditionIndex < conditions.length; conditionIndex += 1) {
    if (!conditionMatches(row, conditions[conditionIndex])) {
      return false;
    }
  }

  return true;
}

export function scoreConditionGroup(rows, conditions) {
  let matchedCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let totalReturnPct = 0;
  let winRate = 0;
  let averageReturnPct = 0;
  let maxLossPct = null;
  let maxGainPct = null;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (!groupMatches(rows[rowIndex], conditions)) {
      continue;
    }

    matchedCount += 1;
    totalReturnPct += rows[rowIndex].forward_change_pct;

    if (rows[rowIndex].is_win === 1) {
      winCount += 1;
    } else {
      lossCount += 1;
    }

    if (maxLossPct === null || rows[rowIndex].forward_change_pct < maxLossPct) {
      maxLossPct = rows[rowIndex].forward_change_pct;
    }

    if (maxGainPct === null || rows[rowIndex].forward_change_pct > maxGainPct) {
      maxGainPct = rows[rowIndex].forward_change_pct;
    }
  }

  if (matchedCount > 0) {
    winRate = winCount / matchedCount;
    averageReturnPct = totalReturnPct / matchedCount;
  }

  return {
    matched_count: matchedCount,
    win_count: winCount,
    loss_count: lossCount,
    win_rate: winRate,
    win_rate_pct: winRate * 100,
    total_return_pct: totalReturnPct,
    average_return_pct: averageReturnPct,
    max_loss_pct: maxLossPct,
    max_gain_pct: maxGainPct,
  };
}

export function calculateBaseEntryBaseline(rows) {
  let totalCount = rows.length;
  let winCount = 0;
  let lossCount = 0;
  let winRate = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex].is_win === 1) {
      winCount += 1;
    } else {
      lossCount += 1;
    }
  }

  if (totalCount > 0) {
    winRate = winCount / totalCount;
  }

  return {
    total_count: totalCount,
    win_count: winCount,
    loss_count: lossCount,
    win_rate: winRate,
    win_rate_pct: winRate * 100,
  };
}

export function getBaseEntryMinerNumber(configObject, keyName, defaultValue) {
  if (configObject.base_entry_miner[keyName] !== undefined) {
    return Number(configObject.base_entry_miner[keyName]);
  }

  return defaultValue;
}

export function enrichBaseRuleCandidate(candidate, baseline, configObject) {
  const totalCases = baseline.total_count;
  const minimumWinRateLiftPct = getBaseEntryMinerNumber(configObject, "minimum_win_rate_lift_pct", 5);
  let matchRate = 0;
  let winRateLiftPct = 0;
  let broadnessPenalty = 0;
  let lossPenalty = 0;
  let baseScore = 0;

  if (totalCases > 0) {
    matchRate = candidate.matched_count / totalCases;
  }

  winRateLiftPct = candidate.win_rate_pct - baseline.win_rate_pct;

  if (matchRate > getBaseEntryMinerNumber(configObject, "maximum_match_rate", 0.55)) {
    broadnessPenalty = (matchRate - getBaseEntryMinerNumber(configObject, "maximum_match_rate", 0.55)) * 100;
  }

  lossPenalty = candidate.loss_count * 0.05;

  baseScore = 0;
  baseScore += candidate.win_count * 2;
  baseScore += winRateLiftPct * 5;
  baseScore += candidate.average_return_pct * 3;
  baseScore -= broadnessPenalty * 10;
  baseScore -= lossPenalty;

  if (winRateLiftPct < minimumWinRateLiftPct) {
    baseScore -= (minimumWinRateLiftPct - winRateLiftPct) * 20;
  }

  candidate.baseline_win_rate_pct = baseline.win_rate_pct;
  candidate.match_rate = matchRate;
  candidate.match_rate_pct = matchRate * 100;
  candidate.win_rate_lift_pct = winRateLiftPct;
  candidate.broadness_penalty = broadnessPenalty;
  candidate.loss_penalty = lossPenalty;
  candidate.base_score = baseScore;

  return candidate;
}

export function isUsefulBaseCandidate(candidate, baseline, configObject) {
  const maximumMatchRate = getBaseEntryMinerNumber(configObject, "maximum_match_rate", 0.55);
  const minimumWinRateLiftPct = getBaseEntryMinerNumber(configObject, "minimum_win_rate_lift_pct", 5);
  const minimumAverageReturnPct = getBaseEntryMinerNumber(configObject, "minimum_average_return_pct", 0);

  enrichBaseRuleCandidate(candidate, baseline, configObject);

  if (candidate.matched_count < configObject.base_entry_miner.minimum_count) {
    return false;
  }

  if (candidate.match_rate > maximumMatchRate) {
    return false;
  }

  if (candidate.win_rate_lift_pct < minimumWinRateLiftPct) {
    return false;
  }

  if (candidate.average_return_pct < minimumAverageReturnPct) {
    return false;
  }

  return true;
}

export function createCondition(featureName, operator, threshold) {
  return {
    feature: featureName,
    operator: operator,
    threshold: threshold,
    condition: featureName + " " + operator + " " + String(threshold),
  };
}

export function mineSingleBaseConditions(rows, featureColumns, configObject, baseline) {
  const conditions = [];

  for (let featureIndex = 0; featureIndex < featureColumns.length; featureIndex += 1) {
    const featureName = featureColumns[featureIndex];
    const values = collectFeatureValues(rows, featureName);
    const thresholds = buildThresholds(values);

    for (let thresholdIndex = 0; thresholdIndex < thresholds.length; thresholdIndex += 1) {
      const threshold = thresholds[thresholdIndex];
      const greaterCondition = createCondition(featureName, ">=", threshold);
      const lesserCondition = createCondition(featureName, "<=", threshold);
      const greaterScore = scoreConditionGroup(rows, [greaterCondition]);
      const lesserScore = scoreConditionGroup(rows, [lesserCondition]);

      const greaterCandidate = createBaseRuleCandidate([greaterCondition], greaterScore, 1);
      const lesserCandidate = createBaseRuleCandidate([lesserCondition], lesserScore, 1);

      if (greaterScore.win_count > 0 && isUsefulBaseCandidate(greaterCandidate, baseline, configObject)) {
        conditions.push(greaterCandidate);
      }

      if (lesserScore.win_count > 0 && isUsefulBaseCandidate(lesserCandidate, baseline, configObject)) {
        conditions.push(lesserCandidate);
      }
    }
  }

  sortBaseRuleCandidates(conditions);

  return limitBaseRuleCandidates(conditions, configObject.base_entry_miner.single_candidate_limit);
}

export function createBaseRuleCandidate(conditions, score, depth) {
  return {
    rule_id: "",
    parent_rule_id: "",
    generation: 0,
    depth: depth,
    condition_count: conditions.length,
    rule_text: conditionsToText(conditions),
    conditions: copyConditions(conditions),
    matched_count: score.matched_count,
    win_count: score.win_count,
    loss_count: score.loss_count,
    win_rate: score.win_rate,
    win_rate_pct: score.win_rate_pct,
    total_return_pct: score.total_return_pct,
    average_return_pct: score.average_return_pct,
    max_loss_pct: score.max_loss_pct,
    max_gain_pct: score.max_gain_pct,
    baseline_win_rate_pct: "",
    match_rate: "",
    match_rate_pct: "",
    win_rate_lift_pct: "",
    broadness_penalty: "",
    loss_penalty: "",
    base_score: "",
  };
}

export function conditionsToText(conditions) {
  let text = "";

  for (let conditionIndex = 0; conditionIndex < conditions.length; conditionIndex += 1) {
    if (conditionIndex > 0) {
      text += " AND ";
    }

    text += conditions[conditionIndex].condition;
  }

  return text;
}

export function copyConditions(conditions) {
  const outputConditions = [];

  for (let conditionIndex = 0; conditionIndex < conditions.length; conditionIndex += 1) {
    outputConditions.push({
      feature: conditions[conditionIndex].feature,
      operator: conditions[conditionIndex].operator,
      threshold: conditions[conditionIndex].threshold,
      condition: conditions[conditionIndex].condition,
    });
  }

  return outputConditions;
}

export function sortBaseRuleCandidates(candidates) {
  candidates.sort(function(leftCandidate, rightCandidate) {
    if (safeNumber(rightCandidate.base_score) !== safeNumber(leftCandidate.base_score)) {
      return safeNumber(rightCandidate.base_score) - safeNumber(leftCandidate.base_score);
    }

    if (rightCandidate.win_count !== leftCandidate.win_count) {
      return rightCandidate.win_count - leftCandidate.win_count;
    }

    if (safeNumber(rightCandidate.win_rate_lift_pct) !== safeNumber(leftCandidate.win_rate_lift_pct)) {
      return safeNumber(rightCandidate.win_rate_lift_pct) - safeNumber(leftCandidate.win_rate_lift_pct);
    }

    if (rightCandidate.strategy_avg_return_per_annum_pct !== leftCandidate.strategy_avg_return_per_annum_pct) {
      return safeNumber(rightCandidate.strategy_avg_return_per_annum_pct) - safeNumber(leftCandidate.strategy_avg_return_per_annum_pct);
    }

    if (rightCandidate.dominant_exit_count !== leftCandidate.dominant_exit_count) {
      return safeNumber(rightCandidate.dominant_exit_count) - safeNumber(leftCandidate.dominant_exit_count);
    }

    if (rightCandidate.win_rate !== leftCandidate.win_rate) {
      return rightCandidate.win_rate - leftCandidate.win_rate;
    }

    if (rightCandidate.average_return_pct !== leftCandidate.average_return_pct) {
      return rightCandidate.average_return_pct - leftCandidate.average_return_pct;
    }

    if (rightCandidate.matched_count !== leftCandidate.matched_count) {
      return rightCandidate.matched_count - leftCandidate.matched_count;
    }

    return leftCandidate.condition_count - rightCandidate.condition_count;
  });
}

export function safeNumber(value) {
  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    return 0;
  }

  return numberValue;
}

export function limitBaseRuleCandidates(candidates, limit) {
  const outputCandidates = [];
  let activeLimit = limit;

  if (activeLimit === undefined || activeLimit === null) {
    activeLimit = candidates.length;
  }

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    if (candidateIndex >= activeLimit) {
      break;
    }

    outputCandidates.push(candidates[candidateIndex]);
  }

  return outputCandidates;
}

export function conditionAlreadySelected(selectedConditions, condition) {
  for (let conditionIndex = 0; conditionIndex < selectedConditions.length; conditionIndex += 1) {
    if (selectedConditions[conditionIndex].condition === condition.condition) {
      return true;
    }
  }

  return false;
}

export function hasRedundantSameFeatureCondition(selectedConditions, condition) {
  let sameFeatureCount = 0;
  let hasGreaterOrEqual = false;
  let hasLessOrEqual = false;

  for (let conditionIndex = 0; conditionIndex < selectedConditions.length; conditionIndex += 1) {
    if (selectedConditions[conditionIndex].feature !== condition.feature) {
      continue;
    }

    sameFeatureCount += 1;

    if (selectedConditions[conditionIndex].operator === ">=") {
      hasGreaterOrEqual = true;
    }

    if (selectedConditions[conditionIndex].operator === "<=") {
      hasLessOrEqual = true;
    }
  }

  if (sameFeatureCount === 0) {
    return false;
  }

  if (condition.operator === ">=" && hasLessOrEqual && !hasGreaterOrEqual) {
    return false;
  }

  if (condition.operator === "<=" && hasGreaterOrEqual && !hasLessOrEqual) {
    return false;
  }

  return true;
}

export function recursiveMineBaseGroups(rows, seedConditions, selectedConditions, startIndex, depth, state) {
  if (depth >= state.max_depth) {
    return state;
  }

  for (let conditionIndex = startIndex; conditionIndex < seedConditions.length; conditionIndex += 1) {
    const condition = seedConditions[conditionIndex].conditions[0];
    const nextSelectedConditions = copyConditions(selectedConditions);

    if (conditionAlreadySelected(nextSelectedConditions, condition)) {
      continue;
    }

    if (hasRedundantSameFeatureCondition(nextSelectedConditions, condition)) {
      continue;
    }

    nextSelectedConditions.push(condition);

    const score = scoreConditionGroup(rows, nextSelectedConditions);
    const candidate = createBaseRuleCandidate(nextSelectedConditions, score, depth + 1);

    if (score.matched_count >= state.minimum_count && score.win_count > 0 && isUsefulBaseCandidate(candidate, state.baseline, state.config)) {
      state.candidates.push(candidate);
    }

    recursiveMineBaseGroups(rows, seedConditions, nextSelectedConditions, conditionIndex + 1, depth + 1, state);
  }

  return state;
}

export function conditionToRule(condition) {
  if (condition.operator === ">=") {
    return {
      type: "condition",
      operator: "inRange",
      left: {
        type: "column",
        column: condition.feature,
        row_offset: 0,
      },
      range: {
        min: condition.threshold,
        include_min: true,
      },
    };
  }

  return {
    type: "condition",
    operator: "inRange",
    left: {
      type: "column",
      column: condition.feature,
      row_offset: 0,
    },
    range: {
      max: condition.threshold,
      include_max: true,
    },
  };
}

export function candidateToEntryRule(candidate) {
  const rules = [];

  if (candidate.case_filter_rule !== undefined && candidate.case_filter_rule !== null) {
    rules.push(JSON.parse(JSON.stringify(candidate.case_filter_rule)));
  }

  for (let conditionIndex = 0; conditionIndex < candidate.conditions.length; conditionIndex += 1) {
    rules.push(conditionToRule(candidate.conditions[conditionIndex]));
  }

  return {
    logic: "and",
    rules: rules,
  };
}

export function candidateToStrategy(candidate, configObject, symbol) {
  if (configObject.base_entry_miner.case_filter_rule !== undefined) {
    candidate.case_filter_rule = configObject.base_entry_miner.case_filter_rule;
  }

  return {
    name: "mined_base_entry_" + symbol + "_" + String(candidate.rule_id),
    timeframe: "daily",
    entry_price_column: "Close",
    exit_price_column: "Close",
    max_holding_days: configObject.base_entry_miner.exit_holding_days,
    profit_target_pct: 999,
    stop_loss_type: "previous_low_before_entry",
    close_open_trade_on_last_row: true,
    entry_signal_column: "strategy_entry_signal",
    exit_signal_column: "strategy_exit_signal",
    position_column: "strategy_position",
    entry_rule: candidateToEntryRule(candidate),
  };
}

export function backtestBaseCandidate(dataframe, candidate, configObject, symbol) {
  const testDataframe = JSON.parse(JSON.stringify(dataframe));
  const strategy = candidateToStrategy(candidate, configObject, symbol);
  const trades = applyStrategy(testDataframe, strategy);
  const report = createStrategyReport(testDataframe, trades);

  candidate.strategy_name = strategy.name;
  candidate.strategy = strategy;
  candidate.strategy_trade_count = report.total_trades;
  candidate.strategy_accuracy_pct = report.accuracy_pct;
  candidate.strategy_avg_return_per_annum_pct = report.avg_return_per_annum_pct;
  candidate.strategy_avg_return_per_month_pct = report.avg_return_per_month_pct;
  candidate.strategy_max_loss_pct = report.max_loss_pct;
  candidate.dominant_exit_reason = getDominantExitReason(report.exit_reasons);
  candidate.dominant_exit_count = getDominantExitCount(report.exit_reasons, candidate.dominant_exit_reason);
  candidate.entry_occurrence_count = candidate.matched_count;
  candidate.exit_occurrence_count = candidate.dominant_exit_count;
  candidate.base_occurrence_score = candidate.entry_occurrence_count + candidate.exit_occurrence_count;

  return candidate;
}

export function getDominantExitReason(exitReasons) {
  let dominantReason = "";
  let dominantCount = 0;

  if (exitReasons === null || exitReasons === undefined) {
    return "";
  }

  for (const reason in exitReasons) {
    if (Object.prototype.hasOwnProperty.call(exitReasons, reason)) {
      if (exitReasons[reason] > dominantCount) {
        dominantCount = exitReasons[reason];
        dominantReason = reason;
      }
    }
  }

  return dominantReason;
}

export function getDominantExitCount(exitReasons, dominantReason) {
  if (exitReasons === null || exitReasons === undefined) {
    return 0;
  }

  if (dominantReason === "") {
    return 0;
  }

  if (exitReasons[dominantReason] === undefined) {
    return 0;
  }

  return exitReasons[dominantReason];
}

export function assignCandidateIds(candidates, symbol) {
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    candidates[candidateIndex].rule_id = symbol + "_MINED_BASE_G0_C" + String(candidateIndex + 1);
  }

  return candidates;
}

export function mineBaseEntryRules(dataframe, configObject, symbol) {
  const featureColumns = getBaseMiningFeatureColumns(dataframe);
  const entryCaseRows = buildBaseEntryCaseRows(dataframe, configObject, featureColumns);
  const baseline = calculateBaseEntryBaseline(entryCaseRows);
  const singleCandidates = mineSingleBaseConditions(entryCaseRows, featureColumns, configObject, baseline);
  const state = {
    candidates: [],
    max_depth: configObject.base_entry_miner.max_depth,
    minimum_count: configObject.base_entry_miner.minimum_count,
    baseline: baseline,
    config: configObject,
  };

  recursiveMineBaseGroups(entryCaseRows, singleCandidates, [], 0, 0, state);
  sortBaseRuleCandidates(state.candidates);
  assignCandidateIds(state.candidates, symbol);

  for (let candidateIndex = 0; candidateIndex < state.candidates.length; candidateIndex += 1) {
    if (candidateIndex >= configObject.base_entry_miner.backtest_candidate_limit) {
      break;
    }

    backtestBaseCandidate(dataframe, state.candidates[candidateIndex], configObject, symbol);
  }

  sortBaseRuleCandidates(state.candidates);

  return {
    enabled: true,
    schema_version: "base_entry_mining_schema_v1",
    symbol: symbol,
    feature_count: featureColumns.length,
    entry_case_count: entryCaseRows.length,
    baseline: baseline,
    single_candidate_count: singleCandidates.length,
    candidate_count: state.candidates.length,
    candidates: state.candidates,
  };
}

export function baseEntryCandidatesToCsv(candidates) {
  const dataframe = createDataFrame("base_entry_candidates");
  const columns = [
    "rule_id",
    "parent_rule_id",
    "generation",
    "depth",
    "condition_count",
    "rule_text",
    "matched_count",
    "win_count",
    "loss_count",
    "win_rate_pct",
    "baseline_win_rate_pct",
    "win_rate_lift_pct",
    "match_rate_pct",
    "base_score",
    "broadness_penalty",
    "loss_penalty",
    "average_return_pct",
    "total_return_pct",
    "max_loss_pct",
    "max_gain_pct",
    "strategy_trade_count",
    "strategy_accuracy_pct",
    "strategy_avg_return_per_annum_pct",
    "strategy_avg_return_per_month_pct",
    "strategy_max_loss_pct",
    "dominant_exit_reason",
    "dominant_exit_count",
    "entry_occurrence_count",
    "exit_occurrence_count",
    "base_occurrence_score",
  ];

  dataframe.columns = columns;
  dataframe.data = [columns];
  dataframe.rows = candidates;

  return dataFrameToCsv(dataframe);
}
