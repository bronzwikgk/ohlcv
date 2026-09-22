// Coding instructions for this folder:
// - Do not use arrow functions.
// - Do not use forEach.
// - Do not use object/property shorthand.
// - Prefer explicit function declarations and plain loops.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  applyStrategy,
  createStrategyReport,
} from "./strategy_engine.js";
import {
  createDataFrame,
  createOutputFileName,
  dataFrameToCsv,
} from "./utility.js";

export function cloneObject(value) {
  return JSON.parse(JSON.stringify(value));
}

export function candidateToConditionRule(candidate) {
  if (candidate.operator === ">=") {
    return {
      type: "condition",
      operator: "inRange",
      left: {
        type: "column",
        column: candidate.feature,
        row_offset: 0,
      },
      range: {
        min: candidate.threshold,
        include_min: true,
      },
    };
  }

  if (candidate.operator === "<=") {
    return {
      type: "condition",
      operator: "inRange",
      left: {
        type: "column",
        column: candidate.feature,
        row_offset: 0,
      },
      range: {
        max: candidate.threshold,
        include_max: true,
      },
    };
  }

  return null;
}

export function createOptimizerCondition(candidate, sourceType, sourceIndex) {
  const rule = candidateToConditionRule(candidate);

  if (rule === null) {
    return null;
  }

  return {
    key: sourceType + "_" + String(sourceIndex) + "_" + candidate.feature + "_" + candidate.operator + "_" + String(candidate.threshold),
    source_type: sourceType,
    source_index: sourceIndex,
    condition: candidate.condition,
    feature: candidate.feature,
    operator: candidate.operator,
    threshold: candidate.threshold,
    rule: rule,
    candidate: candidate,
  };
}

export function collectOptimizerConditions(inputObject, configObject) {
  const conditions = [];
  let hitLimit = 5;
  let missLimit = 5;

  if (configObject.strategy_optimizer.top_hit_candidates !== undefined) {
    hitLimit = configObject.strategy_optimizer.top_hit_candidates;
  }

  if (configObject.strategy_optimizer.top_miss_candidates !== undefined) {
    missLimit = configObject.strategy_optimizer.top_miss_candidates;
  }

  if (inputObject.hit_case_mining_report !== null && inputObject.hit_case_mining_report !== undefined) {
    for (let candidateIndex = 0; candidateIndex < inputObject.hit_case_mining_report.candidates.length; candidateIndex += 1) {
      if (candidateIndex >= hitLimit) {
        break;
      }

      const condition = createOptimizerCondition(inputObject.hit_case_mining_report.candidates[candidateIndex], "hit_confirm", candidateIndex);

      if (condition !== null) {
        conditions.push(condition);
      }
    }
  }

  if (inputObject.miss_mining_report !== null && inputObject.miss_mining_report !== undefined) {
    for (let candidateIndex = 0; candidateIndex < inputObject.miss_mining_report.candidates.length; candidateIndex += 1) {
      if (candidateIndex >= missLimit) {
        break;
      }

      const condition = createOptimizerCondition(inputObject.miss_mining_report.candidates[candidateIndex], "miss_avoid", candidateIndex);

      if (condition !== null) {
        conditions.push(condition);
      }
    }
  }

  return conditions;
}

export function countConditionsBySource(conditions, sourceType) {
  let count = 0;

  for (let conditionIndex = 0; conditionIndex < conditions.length; conditionIndex += 1) {
    if (conditions[conditionIndex].source_type === sourceType) {
      count += 1;
    }
  }

  return count;
}

export function buildOptimizedEntryRule(baseEntryRule, selectedConditions) {
  const rules = [];
  const baseRule = cloneObject(baseEntryRule);

  rules.push(baseRule);

  for (let conditionIndex = 0; conditionIndex < selectedConditions.length; conditionIndex += 1) {
    const selectedCondition = selectedConditions[conditionIndex];

    if (selectedCondition.source_type === "miss_avoid") {
      rules.push({
        logic: "not",
        rule: cloneObject(selectedCondition.rule),
      });
    } else {
      rules.push(cloneObject(selectedCondition.rule));
    }
  }

  return {
    logic: "and",
    rules: rules,
  };
}

export function buildStrategyVersion(baseStrategy, selectedConditions, versionIndex) {
  const strategy = cloneObject(baseStrategy);
  const suffix = "_opt_" + String(versionIndex);

  strategy.name = baseStrategy.name + suffix;
  strategy.entry_signal_column = baseStrategy.entry_signal_column + suffix;
  strategy.exit_signal_column = baseStrategy.exit_signal_column + suffix;
  strategy.position_column = baseStrategy.position_column + suffix;
  strategy.entry_rule = buildOptimizedEntryRule(baseStrategy.entry_rule, selectedConditions);

  return strategy;
}

export function selectedConditionsToText(selectedConditions) {
  let text = "";

  for (let conditionIndex = 0; conditionIndex < selectedConditions.length; conditionIndex += 1) {
    if (conditionIndex > 0) {
      text += " AND ";
    }

    if (selectedConditions[conditionIndex].source_type === "miss_avoid") {
      text += "NOT ";
    }

    text += selectedConditions[conditionIndex].condition;
  }

  return text;
}

export function getRuleBranchType(selectedConditions) {
  const branchCounts = createSelectedBranchCounts(selectedConditions);

  if (branchCounts.hit_confirm_condition_count > 0 && branchCounts.miss_avoid_condition_count > 0) {
    return "combined_profit_and_loss_branch";
  }

  if (branchCounts.hit_confirm_condition_count > 0) {
    return "profit_trade_hit_confirm_branch";
  }

  if (branchCounts.miss_avoid_condition_count > 0) {
    return "loss_trade_miss_avoid_branch";
  }

  return "base_rule_branch";
}

export function createOptimizationResult(inputObject, strategy, trades, report, selectedConditions, depth) {
  const branchCounts = createSelectedBranchCounts(selectedConditions);

  return {
    candidate_id: "",
    parent_rule_id: "",
    generation: depth,
    symbol: inputObject.symbol,
    strategy_name: strategy.name,
    branch_type: getRuleBranchType(selectedConditions),
    goal_metric: "",
    depth: depth,
    selected_condition_count: selectedConditions.length,
    hit_confirm_condition_count: branchCounts.hit_confirm_condition_count,
    miss_avoid_condition_count: branchCounts.miss_avoid_condition_count,
    selected_conditions_text: selectedConditionsToText(selectedConditions),
    total_trades: report.total_trades,
    winning_trades: report.winning_trades,
    losing_trades: report.losing_trades,
    accuracy: report.accuracy,
    accuracy_pct: report.accuracy_pct,
    total_return_pct: report.total_return_pct,
    average_return_per_trade_pct: report.average_return_per_trade_pct,
    avg_return_per_month_pct: report.avg_return_per_month_pct,
    avg_return_per_annum_pct: report.avg_return_per_annum_pct,
    max_gain_pct: report.max_gain_pct,
    max_loss_pct: report.max_loss_pct,
    before_accuracy_pct: "",
    before_avg_return_per_annum_pct: "",
    improvement_accuracy_pct: "",
    improvement_avg_return_per_annum_pct: "",
    promoted: false,
    promotion_reason: "",
    exit_reasons: report.exit_reasons,
    trades: trades,
    strategy: strategy,
    selected_conditions: cloneObject(selectedConditions),
  };
}

export function createSelectedBranchCounts(selectedConditions) {
  const branchCounts = {
    hit_confirm_condition_count: 0,
    miss_avoid_condition_count: 0,
  };

  for (let conditionIndex = 0; conditionIndex < selectedConditions.length; conditionIndex += 1) {
    if (selectedConditions[conditionIndex].source_type === "hit_confirm") {
      branchCounts.hit_confirm_condition_count += 1;
    }

    if (selectedConditions[conditionIndex].source_type === "miss_avoid") {
      branchCounts.miss_avoid_condition_count += 1;
    }
  }

  return branchCounts;
}

export function resultAlreadyExists(results, key) {
  for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
    if (results[resultIndex].key === key) {
      return true;
    }
  }

  return false;
}

export function buildSelectedKey(selectedConditions) {
  let key = "";

  for (let conditionIndex = 0; conditionIndex < selectedConditions.length; conditionIndex += 1) {
    if (conditionIndex > 0) {
      key += "|";
    }

    key += selectedConditions[conditionIndex].key;
  }

  return key;
}

export function shouldKeepOptimizationResult(result, configObject) {
  if (result.total_trades < configObject.strategy_optimizer.minimum_trades) {
    return false;
  }

  return true;
}

export function evaluateStrategyVersion(inputObject, baseStrategy, selectedConditions, versionIndex, depth) {
  const testDataframe = cloneObject(inputObject.dataframe);
  const strategy = buildStrategyVersion(baseStrategy, selectedConditions, versionIndex);
  const trades = applyStrategy(testDataframe, strategy);
  const report = createStrategyReport(testDataframe, trades);

  return createOptimizationResult(inputObject, strategy, trades, report, selectedConditions, depth);
}

export function addOptimizationResult(results, result, key, configObject) {
  if (!shouldKeepOptimizationResult(result, configObject)) {
    return false;
  }

  result.key = key;
  results.push(result);

  return true;
}

export function recursiveSearchStrategyVersions(inputObject, baseStrategy, conditions, selectedConditions, startIndex, depth, state) {
  if (depth >= state.max_depth) {
    return state;
  }

  for (let conditionIndex = startIndex; conditionIndex < conditions.length; conditionIndex += 1) {
    const nextSelectedConditions = [];

    for (let selectedIndex = 0; selectedIndex < selectedConditions.length; selectedIndex += 1) {
      nextSelectedConditions.push(selectedConditions[selectedIndex]);
    }

    nextSelectedConditions.push(conditions[conditionIndex]);

    const key = buildSelectedKey(nextSelectedConditions);

    if (resultAlreadyExists(state.results, key)) {
      continue;
    }

    state.version_index += 1;
    state.evaluated_version_count += 1;

    const result = evaluateStrategyVersion(
      inputObject,
      baseStrategy,
      nextSelectedConditions,
      state.version_index,
      depth + 1,
    );

    addOptimizationResult(state.results, result, key, state.config);

    if (doesResultReachThreshold(result, state.accuracy_threshold, state.annual_return_threshold_pct, state.minimum_trades)) {
      state.threshold_reached = true;
    }

    recursiveSearchStrategyVersions(
      inputObject,
      baseStrategy,
      conditions,
      nextSelectedConditions,
      conditionIndex + 1,
      depth + 1,
      state,
    );
  }

  return state;
}

export function sortOptimizationResults(results) {
  results.sort(function(leftResult, rightResult) {
    if (rightResult.accuracy !== leftResult.accuracy) {
      return rightResult.accuracy - leftResult.accuracy;
    }

    if (rightResult.avg_return_per_annum_pct !== leftResult.avg_return_per_annum_pct) {
      return rightResult.avg_return_per_annum_pct - leftResult.avg_return_per_annum_pct;
    }

    if (rightResult.avg_return_per_month_pct !== leftResult.avg_return_per_month_pct) {
      return rightResult.avg_return_per_month_pct - leftResult.avg_return_per_month_pct;
    }

    if (rightResult.total_trades !== leftResult.total_trades) {
      return rightResult.total_trades - leftResult.total_trades;
    }

    return leftResult.selected_condition_count - rightResult.selected_condition_count;
  });
}

export function getParentRuleId(inputObject, strategyIndex) {
  return inputObject.symbol + "_G0_BASE_" + String(strategyIndex);
}

export function createParentRuleCandidate(inputObject, configObject, strategyIndex) {
  const strategy = configObject.strategies[strategyIndex];
  const report = inputObject.strategy_report || {};

  return {
    candidate_id: getParentRuleId(inputObject, strategyIndex),
    parent_rule_id: "",
    generation: 0,
    symbol: inputObject.symbol,
    strategy_name: strategy.name,
    branch_type: "base_rule_branch",
    goal_metric: "baseline",
    depth: 0,
    selected_condition_count: 0,
    hit_confirm_condition_count: 0,
    miss_avoid_condition_count: 0,
    selected_conditions_text: "BASE_RULE",
    total_trades: report.total_trades || 0,
    winning_trades: report.winning_trades || 0,
    losing_trades: report.losing_trades || 0,
    accuracy: report.accuracy || 0,
    accuracy_pct: report.accuracy_pct || 0,
    total_return_pct: report.total_return_pct || 0,
    average_return_per_trade_pct: report.average_return_per_trade_pct || 0,
    avg_return_per_month_pct: report.avg_return_per_month_pct || 0,
    avg_return_per_annum_pct: report.avg_return_per_annum_pct || 0,
    max_gain_pct: report.max_gain_pct,
    max_loss_pct: report.max_loss_pct,
    before_accuracy_pct: "",
    before_avg_return_per_annum_pct: "",
    improvement_accuracy_pct: 0,
    improvement_avg_return_per_annum_pct: 0,
    promoted: true,
    promotion_reason: "baseline_parent_rule",
    exit_reasons: report.exit_reasons || {},
    strategy: strategy,
  };
}

export function chooseGoalMetric(parentCandidate, configObject) {
  if (parentCandidate.accuracy < configObject.strategy_optimizer.accuracy_threshold) {
    return "increase_hit_rate";
  }

  if (parentCandidate.avg_return_per_annum_pct < configObject.strategy_optimizer.annual_return_threshold_pct) {
    return "increase_annual_return";
  }

  return "preserve_and_expand";
}

export function enrichOptimizationResults(results, parentCandidate, configObject) {
  const goalMetric = chooseGoalMetric(parentCandidate, configObject);

  for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
    const result = results[resultIndex];

    result.candidate_id = result.symbol + "_G" + String(result.generation) + "_C" + String(resultIndex + 1);
    result.parent_rule_id = parentCandidate.candidate_id;
    result.goal_metric = goalMetric;
    result.before_accuracy_pct = parentCandidate.accuracy_pct;
    result.before_avg_return_per_annum_pct = parentCandidate.avg_return_per_annum_pct;
    result.improvement_accuracy_pct = result.accuracy_pct - parentCandidate.accuracy_pct;
    result.improvement_avg_return_per_annum_pct = result.avg_return_per_annum_pct - parentCandidate.avg_return_per_annum_pct;

    if (shouldPromoteResult(result, parentCandidate, configObject)) {
      result.promoted = true;
      result.promotion_reason = createPromotionReason(result, parentCandidate, configObject);
    } else {
      result.promoted = false;
      result.promotion_reason = "did_not_improve_required_metrics";
    }
  }
}

export function shouldPromoteResult(result, parentCandidate, configObject) {
  if (result.total_trades < configObject.strategy_optimizer.minimum_trades) {
    return false;
  }

  if (result.accuracy_pct > parentCandidate.accuracy_pct) {
    return true;
  }

  if (result.avg_return_per_annum_pct > parentCandidate.avg_return_per_annum_pct) {
    return true;
  }

  if (parentCandidate.max_loss_pct !== null && parentCandidate.max_loss_pct !== undefined) {
    if (result.max_loss_pct !== null && result.max_loss_pct !== undefined) {
      if (result.max_loss_pct > parentCandidate.max_loss_pct) {
        return true;
      }
    }
  }

  return false;
}

export function createPromotionReason(result, parentCandidate, configObject) {
  let reason = "";

  if (result.accuracy_pct > parentCandidate.accuracy_pct) {
    reason += "hit_rate_improved";
  }

  if (result.avg_return_per_annum_pct > parentCandidate.avg_return_per_annum_pct) {
    if (reason !== "") {
      reason += ";";
    }

    reason += "annual_return_improved";
  }

  if (parentCandidate.max_loss_pct !== null && parentCandidate.max_loss_pct !== undefined) {
    if (result.max_loss_pct !== null && result.max_loss_pct !== undefined) {
      if (result.max_loss_pct > parentCandidate.max_loss_pct) {
        if (reason !== "") {
          reason += ";";
        }

        reason += "max_loss_reduced";
      }
    }
  }

  if (doesResultReachThreshold(result, configObject.strategy_optimizer.accuracy_threshold, configObject.strategy_optimizer.annual_return_threshold_pct, configObject.strategy_optimizer.minimum_trades)) {
    if (reason !== "") {
      reason += ";";
    }

    reason += "full_threshold_reached";
  }

  return reason;
}

export function createTargetProfile(inputObject, configObject) {
  const profile = {
    target_name: "target_change_profile",
    symbol: inputObject.symbol,
    timeframe: configObject.target_labeling.timeframe,
    target_days: configObject.target_labeling.target_time,
    target_change_column: configObject.target_labeling.change_column,
    target_label_column: configObject.target_labeling.target_label_column,
    total_cases: 0,
    hit_cases: 0,
    non_hit_cases: 0,
  };

  if (inputObject.hit_case_mining_report !== null && inputObject.hit_case_mining_report !== undefined) {
    if (inputObject.hit_case_mining_report.totals !== undefined) {
      profile.total_cases = inputObject.hit_case_mining_report.totals.total_entry_cases || 0;
      profile.hit_cases = inputObject.hit_case_mining_report.totals.total_hit_cases || 0;
      profile.non_hit_cases = inputObject.hit_case_mining_report.totals.total_non_hit_cases || 0;
    }
  }

  return profile;
}

export function createEvolutionJobs(parentCandidate, configObject, conditions) {
  const jobs = [];

  jobs.push({
    job_id: parentCandidate.candidate_id + "_JOB_HIT_RATE",
    parent_rule_id: parentCandidate.candidate_id,
    job_type: "increase_hit_rate",
    branch_type: "profit_trade_hit_confirm_branch",
    source_condition_count: countConditionsBySource(conditions, "hit_confirm"),
    target_accuracy_pct: configObject.strategy_optimizer.accuracy_threshold * 100,
    target_annual_return_pct: configObject.strategy_optimizer.annual_return_threshold_pct,
  });

  jobs.push({
    job_id: parentCandidate.candidate_id + "_JOB_LOSS_AVOID",
    parent_rule_id: parentCandidate.candidate_id,
    job_type: "reduce_loss_and_increase_hit_rate",
    branch_type: "loss_trade_miss_avoid_branch",
    source_condition_count: countConditionsBySource(conditions, "miss_avoid"),
    target_accuracy_pct: configObject.strategy_optimizer.accuracy_threshold * 100,
    target_annual_return_pct: configObject.strategy_optimizer.annual_return_threshold_pct,
  });

  jobs.push({
    job_id: parentCandidate.candidate_id + "_JOB_ANNUAL_RETURN",
    parent_rule_id: parentCandidate.candidate_id,
    job_type: "increase_annual_return",
    branch_type: "combined_profit_and_loss_branch",
    source_condition_count: conditions.length,
    target_accuracy_pct: configObject.strategy_optimizer.accuracy_threshold * 100,
    target_annual_return_pct: configObject.strategy_optimizer.annual_return_threshold_pct,
  });

  return jobs;
}

export function optimizeStrategiesRecursively(inputObject, configObject) {
  const results = [];
  const conditions = collectOptimizerConditions(inputObject, configObject);
  const parentCandidates = [];
  const evolutionJobs = [];
  let maxDepth = 2;
  let accuracyThreshold = configObject.expected_accuracy_threshold;
  let minimumTrades = configObject.minimum_count;
  let annualReturnThresholdPct = 25;

  if (!configObject.strategy_optimizer.enabled) {
    return {
      enabled: false,
      condition_count: 0,
      tested_version_count: 0,
      annual_return_threshold_pct: annualReturnThresholdPct,
      threshold_reached: false,
      results: [],
    };
  }

  if (configObject.strategy_optimizer.max_depth !== undefined) {
    maxDepth = configObject.strategy_optimizer.max_depth;
  }

  if (configObject.strategy_optimizer.accuracy_threshold !== undefined) {
    accuracyThreshold = configObject.strategy_optimizer.accuracy_threshold;
  }

  if (configObject.strategy_optimizer.minimum_trades !== undefined) {
    minimumTrades = configObject.strategy_optimizer.minimum_trades;
  }

  if (configObject.strategy_optimizer.annual_return_threshold_pct !== undefined) {
    annualReturnThresholdPct = configObject.strategy_optimizer.annual_return_threshold_pct;
  }

  for (let strategyIndex = 0; strategyIndex < configObject.strategies.length; strategyIndex += 1) {
    const baseStrategy = configObject.strategies[strategyIndex];
    const parentCandidate = createParentRuleCandidate(inputObject, configObject, strategyIndex);
    const selectedConditions = [];
    const state = {
      config: configObject,
      results: results,
      version_index: 0,
      evaluated_version_count: 0,
      max_depth: maxDepth,
      accuracy_threshold: accuracyThreshold,
      annual_return_threshold_pct: annualReturnThresholdPct,
      minimum_trades: minimumTrades,
      threshold_reached: false,
    };

    parentCandidates.push(parentCandidate);
    addEvolutionJobs(evolutionJobs, createEvolutionJobs(parentCandidate, configObject, conditions));
    recursiveSearchStrategyVersions(inputObject, baseStrategy, conditions, selectedConditions, 0, 0, state);
  }

  sortOptimizationResults(results);

  if (parentCandidates.length > 0) {
    enrichOptimizationResults(results, parentCandidates[0], configObject);
  }

  return {
    schema_version: "strategy_evolution_schema_v1",
    enabled: true,
    accuracy_threshold: accuracyThreshold,
    annual_return_threshold_pct: annualReturnThresholdPct,
    minimum_trades: minimumTrades,
    max_depth: maxDepth,
    target_profile: createTargetProfile(inputObject, configObject),
    parent_rule_candidates: parentCandidates,
    evolution_jobs: evolutionJobs,
    condition_count: conditions.length,
    hit_confirm_condition_count: countConditionsBySource(conditions, "hit_confirm"),
    miss_avoid_condition_count: countConditionsBySource(conditions, "miss_avoid"),
    branch_jobs: [
      {
        name: "profit_trade_hit_confirm_job",
        source_type: "hit_confirm",
        condition_count: countConditionsBySource(conditions, "hit_confirm"),
        purpose: "Increase hit rate by requiring conditions found in profit or strong target cases.",
      },
      {
        name: "loss_trade_miss_avoid_job",
        source_type: "miss_avoid",
        condition_count: countConditionsBySource(conditions, "miss_avoid"),
        purpose: "Increase hit rate by skipping conditions found in loss cases.",
      },
    ],
    tested_version_count: stateEvaluatedVersionCount(results, configObject.strategies.length, conditions.length, maxDepth),
    kept_version_count: results.length,
    threshold_reached: hasThresholdResult(results, accuracyThreshold, annualReturnThresholdPct, minimumTrades),
    results: results,
  };
}

export function addEvolutionJobs(targetJobs, sourceJobs) {
  for (let jobIndex = 0; jobIndex < sourceJobs.length; jobIndex += 1) {
    targetJobs.push(sourceJobs[jobIndex]);
  }
}

export function stateEvaluatedVersionCount(results, strategyCount, conditionCount, maxDepth) {
  let totalCount = 0;
  let combinationCount = 1;
  let numerator = 1;
  let denominator = 1;
  let depth = 1;

  if (conditionCount <= 0 || strategyCount <= 0) {
    return 0;
  }

  for (depth = 1; depth <= maxDepth; depth += 1) {
    numerator = numerator * (conditionCount - depth + 1);
    denominator = denominator * depth;
    combinationCount = numerator / denominator;

    if (combinationCount > 0) {
      totalCount += combinationCount;
    }
  }

  return totalCount * strategyCount;
}

export function doesResultReachThreshold(result, accuracyThreshold, annualReturnThresholdPct, minimumTrades) {
  if (result.total_trades < minimumTrades) {
    return false;
  }

  if (result.accuracy < accuracyThreshold) {
    return false;
  }

  if (result.avg_return_per_annum_pct < annualReturnThresholdPct) {
    return false;
  }

  return true;
}

export function hasThresholdResult(results, accuracyThreshold, annualReturnThresholdPct, minimumTrades) {
  for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
    if (doesResultReachThreshold(results[resultIndex], accuracyThreshold, annualReturnThresholdPct, minimumTrades)) {
      return true;
    }
  }

  return false;
}

export function optimizationResultsToCsv(results) {
  const dataframe = createDataFrame("strategy_optimization_results");
  const columns = [
    "symbol",
    "candidate_id",
    "parent_rule_id",
    "generation",
    "strategy_name",
    "branch_type",
    "goal_metric",
    "depth",
    "selected_condition_count",
    "hit_confirm_condition_count",
    "miss_avoid_condition_count",
    "selected_conditions_text",
    "total_trades",
    "winning_trades",
    "losing_trades",
    "accuracy_pct",
    "total_return_pct",
    "average_return_per_trade_pct",
    "avg_return_per_month_pct",
    "avg_return_per_annum_pct",
    "max_gain_pct",
    "max_loss_pct",
    "before_accuracy_pct",
    "before_avg_return_per_annum_pct",
    "improvement_accuracy_pct",
    "improvement_avg_return_per_annum_pct",
    "promoted",
    "promotion_reason",
  ];

  dataframe.columns = columns;
  dataframe.data = [columns];
  dataframe.rows = results;

  return dataFrameToCsv(dataframe);
}

export function createOptimizationReportForSave(report) {
  const outputReport = {
    schema_version: report.schema_version,
    enabled: report.enabled,
    accuracy_threshold: report.accuracy_threshold,
    annual_return_threshold_pct: report.annual_return_threshold_pct,
    minimum_trades: report.minimum_trades,
    max_depth: report.max_depth,
    target_profile: report.target_profile,
    parent_rule_candidates: report.parent_rule_candidates,
    evolution_jobs: report.evolution_jobs,
    condition_count: report.condition_count,
    hit_confirm_condition_count: report.hit_confirm_condition_count,
    miss_avoid_condition_count: report.miss_avoid_condition_count,
    branch_jobs: report.branch_jobs,
    tested_version_count: report.tested_version_count,
    kept_version_count: report.kept_version_count,
    threshold_reached: report.threshold_reached,
    top_results: [],
  };
  const maxTopCount = 20;

  for (let resultIndex = 0; resultIndex < report.results.length; resultIndex += 1) {
    if (resultIndex >= maxTopCount) {
      break;
    }

    outputReport.top_results.push({
      symbol: report.results[resultIndex].symbol,
      candidate_id: report.results[resultIndex].candidate_id,
      parent_rule_id: report.results[resultIndex].parent_rule_id,
      generation: report.results[resultIndex].generation,
      strategy_name: report.results[resultIndex].strategy_name,
      branch_type: report.results[resultIndex].branch_type,
      goal_metric: report.results[resultIndex].goal_metric,
      depth: report.results[resultIndex].depth,
      selected_condition_count: report.results[resultIndex].selected_condition_count,
      hit_confirm_condition_count: report.results[resultIndex].hit_confirm_condition_count,
      miss_avoid_condition_count: report.results[resultIndex].miss_avoid_condition_count,
      selected_conditions_text: report.results[resultIndex].selected_conditions_text,
      total_trades: report.results[resultIndex].total_trades,
      winning_trades: report.results[resultIndex].winning_trades,
      losing_trades: report.results[resultIndex].losing_trades,
      accuracy_pct: report.results[resultIndex].accuracy_pct,
      total_return_pct: report.results[resultIndex].total_return_pct,
      average_return_per_trade_pct: report.results[resultIndex].average_return_per_trade_pct,
      avg_return_per_month_pct: report.results[resultIndex].avg_return_per_month_pct,
      avg_return_per_annum_pct: report.results[resultIndex].avg_return_per_annum_pct,
      max_gain_pct: report.results[resultIndex].max_gain_pct,
      max_loss_pct: report.results[resultIndex].max_loss_pct,
      before_accuracy_pct: report.results[resultIndex].before_accuracy_pct,
      before_avg_return_per_annum_pct: report.results[resultIndex].before_avg_return_per_annum_pct,
      improvement_accuracy_pct: report.results[resultIndex].improvement_accuracy_pct,
      improvement_avg_return_per_annum_pct: report.results[resultIndex].improvement_avg_return_per_annum_pct,
      promoted: report.results[resultIndex].promoted,
      promotion_reason: report.results[resultIndex].promotion_reason,
      exit_reasons: report.results[resultIndex].exit_reasons,
    });
  }

  return outputReport;
}

export async function saveStrategyOptimizationReport(inputObject, configObject) {
  const reportForSave = createOptimizationReportForSave(inputObject.strategy_optimization_report);
  const fileName = createOutputFileName(configObject, inputObject.symbol + "_strategy_optimization_report.json");
  const filePath = path.join(configObject.output_path, fileName);
  const jsonText = JSON.stringify(reportForSave, null, 2);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, jsonText, "utf8");

  inputObject.saved_strategy_optimization_report_file_path = filePath;

  return filePath;
}

export async function saveStrategyOptimizationCandidates(inputObject, configObject) {
  const csvText = optimizationResultsToCsv(inputObject.strategy_optimization_report.results);
  const fileName = createOutputFileName(configObject, inputObject.symbol + "_strategy_optimization_candidates.csv");
  const filePath = path.join(configObject.output_path, fileName);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, csvText, "utf8");

  inputObject.saved_strategy_optimization_candidates_file_path = filePath;

  return filePath;
}
