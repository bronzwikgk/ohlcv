// Coding instructions for this folder:
// - Do not use arrow functions.
// - Do not use forEach.
// - Do not use object/property shorthand.
// - Prefer explicit function declarations and plain loops.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildBaseEntryCaseRows,
  calculateBaseEntryBaseline,
  copyConditions,
  createBaseRuleCandidate,
  getBaseMiningFeatureColumns,
  groupMatches,
  mineSingleBaseConditions,
  recursiveMineBaseGroups,
  scoreConditionGroup,
} from "./base_entry_miner.js";
import {
  createDataFrame,
  createOutputFileName,
  dataFrameToCsv,
} from "./utility.js";
import {
  applyStrategy,
  createStrategyReport,
} from "./strategy_engine.js";

export function getCommonRuleMinerConfig(configObject) {
  const safeConfig = configObject.common_rule_miner || {};
  const outputConfig = {
    enabled: false,
    group_name: "common_rule_group",
    minimum_symbols_passed: 3,
    minimum_per_symbol_matches: 10,
    minimum_symbol_win_rate_lift_pct: 5,
    maximum_symbol_match_share: 0.60,
    max_depth: configObject.base_entry_miner.max_depth,
    single_candidate_limit: configObject.base_entry_miner.single_candidate_limit,
    top_candidate_limit: 50,
  };

  if (safeConfig.enabled !== undefined) {
    outputConfig.enabled = safeConfig.enabled;
  }

  if (safeConfig.group_name !== undefined) {
    outputConfig.group_name = safeConfig.group_name;
  }

  if (safeConfig.minimum_symbols_passed !== undefined) {
    outputConfig.minimum_symbols_passed = safeConfig.minimum_symbols_passed;
  }

  if (safeConfig.minimum_per_symbol_matches !== undefined) {
    outputConfig.minimum_per_symbol_matches = safeConfig.minimum_per_symbol_matches;
  }

  if (safeConfig.minimum_symbol_win_rate_lift_pct !== undefined) {
    outputConfig.minimum_symbol_win_rate_lift_pct = safeConfig.minimum_symbol_win_rate_lift_pct;
  }

  if (safeConfig.maximum_symbol_match_share !== undefined) {
    outputConfig.maximum_symbol_match_share = safeConfig.maximum_symbol_match_share;
  }

  if (safeConfig.max_depth !== undefined) {
    outputConfig.max_depth = safeConfig.max_depth;
  }

  if (safeConfig.single_candidate_limit !== undefined) {
    outputConfig.single_candidate_limit = safeConfig.single_candidate_limit;
  }

  if (safeConfig.top_candidate_limit !== undefined) {
    outputConfig.top_candidate_limit = safeConfig.top_candidate_limit;
  }

  return outputConfig;
}

export function cloneBaseMinerConfigForCommon(configObject, commonConfig) {
  const clonedConfig = JSON.parse(JSON.stringify(configObject));

  clonedConfig.base_entry_miner.max_depth = commonConfig.max_depth;
  clonedConfig.base_entry_miner.single_candidate_limit = commonConfig.single_candidate_limit;

  return clonedConfig;
}

export function buildCommonCaseData(inputObjects, configObject) {
  const pooledRows = [];
  const rowsBySymbol = {};
  let featureColumns = [];

  for (let inputIndex = 0; inputIndex < inputObjects.length; inputIndex += 1) {
    const inputObject = inputObjects[inputIndex];

    if (featureColumns.length === 0) {
      featureColumns = getBaseMiningFeatureColumns(inputObject.dataframe);
    }

    const rows = buildBaseEntryCaseRows(inputObject.dataframe, configObject, featureColumns);
    rowsBySymbol[inputObject.symbol] = rows;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const pooledRow = rows[rowIndex];

      pooledRow.symbol = inputObject.symbol;
      pooledRows.push(pooledRow);
    }
  }

  return {
    pooled_rows: pooledRows,
    rows_by_symbol: rowsBySymbol,
    feature_columns: featureColumns,
  };
}

export function mineCommonRuleCandidates(caseData, configObject, commonConfig) {
  const commonMinerConfig = cloneBaseMinerConfigForCommon(configObject, commonConfig);
  const baseline = calculateBaseEntryBaseline(caseData.pooled_rows);
  const singleCandidates = mineSingleBaseConditions(
    caseData.pooled_rows,
    caseData.feature_columns,
    commonMinerConfig,
    baseline,
  );
  const state = {
    candidates: [],
    max_depth: commonConfig.max_depth,
    minimum_count: configObject.base_entry_miner.minimum_count,
    baseline: baseline,
    config: commonMinerConfig,
  };

  recursiveMineBaseGroups(caseData.pooled_rows, singleCandidates, [], 0, 0, state);

  return {
    baseline: baseline,
    single_candidates: singleCandidates,
    candidates: state.candidates,
  };
}

export function validateCandidateBySymbol(candidate, caseData, commonConfig) {
  const symbols = Object.keys(caseData.rows_by_symbol);
  const symbolResults = [];
  let symbolsPassed = 0;
  let totalMatched = 0;
  let maxSymbolMatched = 0;
  let sumWinRateLiftPct = 0;
  let sumWinRatePct = 0;
  let sumAverageReturnPct = 0;

  for (let symbolIndex = 0; symbolIndex < symbols.length; symbolIndex += 1) {
    const symbol = symbols[symbolIndex];
    const rows = caseData.rows_by_symbol[symbol];
    const baseline = calculateBaseEntryBaseline(rows);
    const score = scoreConditionGroup(rows, candidate.conditions);
    const winRateLiftPct = score.win_rate_pct - baseline.win_rate_pct;
    let passed = false;

    if (score.matched_count >= commonConfig.minimum_per_symbol_matches) {
      if (winRateLiftPct >= commonConfig.minimum_symbol_win_rate_lift_pct) {
        if (score.average_return_pct > 0) {
          passed = true;
        }
      }
    }

    if (passed) {
      symbolsPassed += 1;
    }

    totalMatched += score.matched_count;

    if (score.matched_count > maxSymbolMatched) {
      maxSymbolMatched = score.matched_count;
    }

    sumWinRateLiftPct += winRateLiftPct;
    sumWinRatePct += score.win_rate_pct;
    sumAverageReturnPct += score.average_return_pct;

    symbolResults.push({
      symbol: symbol,
      baseline_win_rate_pct: baseline.win_rate_pct,
      matched_count: score.matched_count,
      win_count: score.win_count,
      loss_count: score.loss_count,
      win_rate_pct: score.win_rate_pct,
      win_rate_lift_pct: winRateLiftPct,
      average_return_pct: score.average_return_pct,
      passed: passed,
    });
  }

  candidate.rule_scope = "common";
  candidate.symbol_validation = symbolResults;
  candidate.symbols_tested = symbols.length;
  candidate.symbols_passed = symbolsPassed;
  candidate.symbol_coverage_pct = 0;
  candidate.average_symbol_win_rate_lift_pct = 0;
  candidate.average_symbol_win_rate_pct = 0;
  candidate.average_symbol_return_pct = 0;
  candidate.max_symbol_match_share = 0;
  candidate.common_rule_passed = false;

  if (symbols.length > 0) {
    candidate.symbol_coverage_pct = (symbolsPassed / symbols.length) * 100;
    candidate.average_symbol_win_rate_lift_pct = sumWinRateLiftPct / symbols.length;
    candidate.average_symbol_win_rate_pct = sumWinRatePct / symbols.length;
    candidate.average_symbol_return_pct = sumAverageReturnPct / symbols.length;
  }

  if (totalMatched > 0) {
    candidate.max_symbol_match_share = maxSymbolMatched / totalMatched;
  }

  if (candidate.symbols_passed >= commonConfig.minimum_symbols_passed) {
    if (candidate.max_symbol_match_share <= commonConfig.maximum_symbol_match_share) {
      candidate.common_rule_passed = true;
    }
  }

  return candidate;
}

export function validateCommonCandidates(candidates, caseData, commonConfig) {
  const validatedCandidates = [];

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = createBaseRuleCandidate(
      copyConditions(candidates[candidateIndex].conditions),
      candidates[candidateIndex],
      candidates[candidateIndex].depth,
    );

    candidate.rule_text = candidates[candidateIndex].rule_text;
    validateCandidateBySymbol(candidate, caseData, commonConfig);

    if (candidate.common_rule_passed) {
      validatedCandidates.push(candidate);
    }
  }

  sortCommonCandidates(validatedCandidates);
  assignCommonCandidateIds(validatedCandidates, commonConfig.group_name);

  return validatedCandidates;
}

export function sortCommonCandidates(candidates) {
  candidates.sort(function(leftCandidate, rightCandidate) {
    if (rightCandidate.symbols_passed !== leftCandidate.symbols_passed) {
      return rightCandidate.symbols_passed - leftCandidate.symbols_passed;
    }

    if (rightCandidate.average_symbol_win_rate_lift_pct !== leftCandidate.average_symbol_win_rate_lift_pct) {
      return rightCandidate.average_symbol_win_rate_lift_pct - leftCandidate.average_symbol_win_rate_lift_pct;
    }

    if (rightCandidate.win_rate_pct !== leftCandidate.win_rate_pct) {
      return rightCandidate.win_rate_pct - leftCandidate.win_rate_pct;
    }

    if (rightCandidate.average_symbol_return_pct !== leftCandidate.average_symbol_return_pct) {
      return rightCandidate.average_symbol_return_pct - leftCandidate.average_symbol_return_pct;
    }

    return leftCandidate.max_symbol_match_share - rightCandidate.max_symbol_match_share;
  });
}

export function assignCommonCandidateIds(candidates, groupName) {
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    candidates[candidateIndex].rule_id = groupName + "_COMMON_G0_C" + String(candidateIndex + 1);
  }
}

export function limitCommonCandidates(candidates, limit) {
  const outputCandidates = [];

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    if (candidateIndex >= limit) {
      break;
    }

    outputCandidates.push(candidates[candidateIndex]);
  }

  return outputCandidates;
}

export function mineCommonRules(inputObjects, configObject) {
  const commonConfig = getCommonRuleMinerConfig(configObject);

  if (!commonConfig.enabled) {
    return {
      enabled: false,
      candidates: [],
    };
  }

  const caseData = buildCommonCaseData(inputObjects, configObject);
  const minedCandidates = mineCommonRuleCandidates(caseData, configObject, commonConfig);
  const validatedCandidates = validateCommonCandidates(minedCandidates.candidates, caseData, commonConfig);
  const limitedCandidates = limitCommonCandidates(validatedCandidates, commonConfig.top_candidate_limit);

  return {
    enabled: true,
    schema_version: "common_rule_mining_schema_v1",
    group_name: commonConfig.group_name,
    symbols: Object.keys(caseData.rows_by_symbol),
    feature_count: caseData.feature_columns.length,
    pooled_case_count: caseData.pooled_rows.length,
    global_baseline: minedCandidates.baseline,
    raw_candidate_count: minedCandidates.candidates.length,
    common_candidate_count: validatedCandidates.length,
    top_candidate_count: limitedCandidates.length,
    candidates: limitedCandidates,
  };
}

export function commonRuleCandidatesToCsv(candidates) {
  const dataframe = createDataFrame("common_rule_candidates");
  const columns = [
    "rule_id",
    "rule_scope",
    "rule_text",
    "depth",
    "condition_count",
    "matched_count",
    "win_count",
    "loss_count",
    "win_rate_pct",
    "average_return_pct",
    "symbols_tested",
    "symbols_passed",
    "symbol_coverage_pct",
    "average_symbol_win_rate_lift_pct",
    "average_symbol_win_rate_pct",
    "average_symbol_return_pct",
    "max_symbol_match_share",
  ];

  dataframe.columns = columns;
  dataframe.data = [columns];
  dataframe.rows = candidates;

  return dataFrameToCsv(dataframe);
}

export function commonConditionToRule(condition) {
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

export function commonCandidateToEntryRule(candidate) {
  const rules = [];

  if (candidate.case_filter_rule !== undefined && candidate.case_filter_rule !== null) {
    rules.push(JSON.parse(JSON.stringify(candidate.case_filter_rule)));
  }

  for (let conditionIndex = 0; conditionIndex < candidate.conditions.length; conditionIndex += 1) {
    rules.push(commonConditionToRule(candidate.conditions[conditionIndex]));
  }

  return {
    logic: "and",
    rules: rules,
  };
}

export function commonCandidateToStrategy(candidate, configObject) {
  if (configObject.base_entry_miner.case_filter_rule !== undefined) {
    candidate.case_filter_rule = configObject.base_entry_miner.case_filter_rule;
  }

  return {
    name: "common_rule_strategy_" + String(candidate.rule_id),
    timeframe: "daily",
    entry_price_column: "Close",
    exit_price_column: "Close",
    max_holding_days: configObject.base_entry_miner.exit_holding_days,
    profit_target_pct: 999,
    stop_loss_type: "previous_low_before_entry",
    close_open_trade_on_last_row: true,
    entry_signal_column: "common_strategy_entry_signal",
    exit_signal_column: "common_strategy_exit_signal",
    position_column: "common_strategy_position",
    entry_rule: commonCandidateToEntryRule(candidate),
  };
}

export function getTopOptimizedResult(inputObject) {
  if (inputObject.strategy_optimization_report === null || inputObject.strategy_optimization_report === undefined) {
    return null;
  }

  if (!Array.isArray(inputObject.strategy_optimization_report.results)) {
    return null;
  }

  if (inputObject.strategy_optimization_report.results.length === 0) {
    return null;
  }

  return inputObject.strategy_optimization_report.results[0];
}

export function createCommonBacktestComparison(inputObjects, commonReport, configObject) {
  const rows = [];
  let candidate = null;
  let strategy = null;
  let commonTotalTrades = 0;
  let commonWinningTrades = 0;
  let commonTotalAnnualReturnPct = 0;
  let optimizedTotalAnnualReturnPct = 0;

  if (!commonReport.enabled || !Array.isArray(commonReport.candidates) || commonReport.candidates.length === 0) {
    return {
      enabled: false,
      reason: "no_common_candidate",
      rows: [],
    };
  }

  candidate = commonReport.candidates[0];
  strategy = commonCandidateToStrategy(candidate, configObject);

  for (let inputIndex = 0; inputIndex < inputObjects.length; inputIndex += 1) {
    const inputObject = inputObjects[inputIndex];
    const testDataframe = JSON.parse(JSON.stringify(inputObject.dataframe));
    const trades = applyStrategy(testDataframe, strategy);
    const report = createStrategyReport(testDataframe, trades);
    const optimizedResult = getTopOptimizedResult(inputObject);
    let optimizedAccuracyPct = "";
    let optimizedTrades = "";
    let optimizedAnnualReturnPct = "";

    if (optimizedResult !== null) {
      optimizedAccuracyPct = optimizedResult.accuracy_pct;
      optimizedTrades = optimizedResult.total_trades;
      optimizedAnnualReturnPct = optimizedResult.avg_return_per_annum_pct;
      optimizedTotalAnnualReturnPct += optimizedResult.avg_return_per_annum_pct;
    }

    commonTotalTrades += report.total_trades;
    commonWinningTrades += report.winning_trades;
    commonTotalAnnualReturnPct += report.avg_return_per_annum_pct;

    rows.push({
      symbol: inputObject.symbol,
      common_rule_id: candidate.rule_id,
      common_rule_text: candidate.rule_text,
      common_trades: report.total_trades,
      common_winning_trades: report.winning_trades,
      common_losing_trades: report.losing_trades,
      common_accuracy_pct: report.accuracy_pct,
      common_avg_return_per_annum_pct: report.avg_return_per_annum_pct,
      common_avg_return_per_month_pct: report.avg_return_per_month_pct,
      common_max_loss_pct: report.max_loss_pct,
      optimized_trades: optimizedTrades,
      optimized_accuracy_pct: optimizedAccuracyPct,
      optimized_avg_return_per_annum_pct: optimizedAnnualReturnPct,
    });
  }

  return {
    enabled: true,
    schema_version: "common_rule_backtest_comparison_schema_v1",
    group_name: commonReport.group_name,
    common_rule_id: candidate.rule_id,
    common_rule_text: candidate.rule_text,
    symbol_count: inputObjects.length,
    common_total_trades: commonTotalTrades,
    common_winning_trades: commonWinningTrades,
    common_accuracy_pct: calculatePercent(commonWinningTrades, commonTotalTrades),
    common_average_annual_return_pct: calculateAverage(commonTotalAnnualReturnPct, inputObjects.length),
    optimized_average_annual_return_pct: calculateAverage(optimizedTotalAnnualReturnPct, inputObjects.length),
    rows: rows,
  };
}

export function calculatePercent(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }

  return (numerator / denominator) * 100;
}

export function calculateAverage(totalValue, count) {
  if (count === 0) {
    return 0;
  }

  return totalValue / count;
}

export function commonBacktestComparisonToCsv(report) {
  const dataframe = createDataFrame("common_rule_backtest_comparison");
  const columns = [
    "symbol",
    "common_rule_id",
    "common_rule_text",
    "common_trades",
    "common_winning_trades",
    "common_losing_trades",
    "common_accuracy_pct",
    "common_avg_return_per_annum_pct",
    "common_avg_return_per_month_pct",
    "common_max_loss_pct",
    "optimized_trades",
    "optimized_accuracy_pct",
    "optimized_avg_return_per_annum_pct",
  ];

  dataframe.columns = columns;
  dataframe.data = [columns];
  dataframe.rows = report.rows;

  return dataFrameToCsv(dataframe);
}

export async function saveCommonBacktestComparison(report, configObject) {
  const fileName = createOutputFileName(configObject, report.group_name + "_common_rule_backtest_comparison.json");
  const filePath = path.join(configObject.output_path, fileName);
  const jsonText = JSON.stringify(report, null, 2);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, jsonText, "utf8");

  return filePath;
}

export async function saveCommonBacktestComparisonCsv(report, configObject) {
  const fileName = createOutputFileName(configObject, report.group_name + "_common_rule_backtest_comparison.csv");
  const filePath = path.join(configObject.output_path, fileName);
  const csvText = commonBacktestComparisonToCsv(report);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, csvText, "utf8");

  return filePath;
}

export async function saveCommonRuleMiningReport(report, configObject) {
  const fileName = createOutputFileName(configObject, report.group_name + "_common_rule_report.json");
  const filePath = path.join(configObject.output_path, fileName);
  const jsonText = JSON.stringify(report, null, 2);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, jsonText, "utf8");

  return filePath;
}

export async function saveCommonRuleCandidates(report, configObject) {
  const fileName = createOutputFileName(configObject, report.group_name + "_common_rule_candidates.csv");
  const filePath = path.join(configObject.output_path, fileName);
  const csvText = commonRuleCandidatesToCsv(report.candidates);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, csvText, "utf8");

  return filePath;
}
