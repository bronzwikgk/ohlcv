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

export function shouldSkipMissMiningColumn(columnName) {
  if (columnName === "Date") {
    return true;
  }

  if (columnName === "target_label") {
    return true;
  }

  if (columnName === "target_change_pct") {
    return true;
  }

  if (columnName === "enter_label") {
    return true;
  }

  if (columnName === "exit_label") {
    return true;
  }

  if (columnName === "strategy_entry_signal") {
    return true;
  }

  if (columnName === "strategy_exit_signal") {
    return true;
  }

  if (columnName === "strategy_position") {
    return true;
  }

  return false;
}

export function isRelativeDerivativeMiningColumn(columnName) {
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

  return false;
}

export function isNumericDataFrameColumn(dataframe, columnName) {
  let numericCount = 0;

  if (shouldSkipMissMiningColumn(columnName)) {
    return false;
  }

  if (!isRelativeDerivativeMiningColumn(columnName)) {
    return false;
  }

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    const value = getDataFrameValue(dataframe, rowIndex, columnName);

    if (toNumber(value) !== null) {
      numericCount += 1;
    }

    if (numericCount >= 5) {
      return true;
    }
  }

  return false;
}

export function getNumericFeatureColumns(dataframe) {
  const featureColumns = [];

  for (let columnIndex = 0; columnIndex < dataframe.columns.length; columnIndex += 1) {
    const columnName = dataframe.columns[columnIndex];

    if (isNumericDataFrameColumn(dataframe, columnName)) {
      featureColumns.push(columnName);
    }
  }

  return featureColumns;
}

export function buildTradeFeatureRows(dataframe, trades, featureColumns) {
  const rows = [];

  for (let tradeIndex = 0; tradeIndex < trades.length; tradeIndex += 1) {
    const trade = trades[tradeIndex];
    const rowIndex = Number(trade.entry_row_index);
    const tradeChangePct = toNumber(trade.change_pct);
    const featureRow = {
      trade_index: tradeIndex,
      entry_row_index: rowIndex,
      entry_date: trade.entry_date,
      exit_reason: trade.exit_reason,
      trade_change_pct: trade.change_pct,
      is_hit: 0,
      is_miss: 1,
    };

    if (tradeChangePct !== null && tradeChangePct > 0) {
      featureRow.is_hit = 1;
      featureRow.is_miss = 0;
    }

    for (let featureIndex = 0; featureIndex < featureColumns.length; featureIndex += 1) {
      const featureName = featureColumns[featureIndex];
      featureRow[featureName] = getDataFrameValue(dataframe, rowIndex, featureName);
    }

    rows.push(featureRow);
  }

  return rows;
}

export function collectFeatureValues(rows, featureName) {
  const values = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const numericValue = toNumber(rows[rowIndex][featureName]);

    if (numericValue !== null) {
      values.push(numericValue);
    }
  }

  values.sort(function(leftValue, rightValue) {
    return leftValue - rightValue;
  });

  return values;
}

export function getQuantileValue(sortedValues, quantile) {
  let rawIndex = 0;
  let index = 0;

  if (sortedValues.length === 0) {
    return null;
  }

  rawIndex = Math.floor((sortedValues.length - 1) * quantile);
  index = rawIndex;

  if (index < 0) {
    index = 0;
  }

  if (index >= sortedValues.length) {
    index = sortedValues.length - 1;
  }

  return sortedValues[index];
}

export function hasThreshold(thresholds, value) {
  for (let thresholdIndex = 0; thresholdIndex < thresholds.length; thresholdIndex += 1) {
    if (thresholds[thresholdIndex] === value) {
      return true;
    }
  }

  return false;
}

export function buildThresholds(values, quantiles) {
  const thresholds = [];

  for (let quantileIndex = 0; quantileIndex < quantiles.length; quantileIndex += 1) {
    const threshold = getQuantileValue(values, quantiles[quantileIndex]);

    if (threshold !== null && !hasThreshold(thresholds, threshold)) {
      thresholds.push(threshold);
    }
  }

  return thresholds;
}

export function conditionMatches(row, featureName, operator, threshold) {
  const numericValue = toNumber(row[featureName]);

  if (numericValue === null) {
    return false;
  }

  if (operator === ">=") {
    return numericValue >= threshold;
  }

  if (operator === "<=") {
    return numericValue <= threshold;
  }

  return false;
}

export function scoreMissCondition(rows, featureName, operator, threshold, totals) {
  let hitCount = 0;
  let missCount = 0;
  let matchedCount = 0;
  let missAccuracy = 0;
  let missCoverage = 0;
  let hitLeakage = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (conditionMatches(rows[rowIndex], featureName, operator, threshold)) {
      matchedCount += 1;

      if (rows[rowIndex].is_hit === 1) {
        hitCount += 1;
      }

      if (rows[rowIndex].is_miss === 1) {
        missCount += 1;
      }
    }
  }

  if (matchedCount > 0) {
    missAccuracy = missCount / matchedCount;
  }

  if (totals.total_misses > 0) {
    missCoverage = missCount / totals.total_misses;
  }

  if (totals.total_hits > 0) {
    hitLeakage = hitCount / totals.total_hits;
  }

  return {
    condition: featureName + " " + operator + " " + String(threshold),
    feature: featureName,
    operator: operator,
    threshold: threshold,
    matched_count: matchedCount,
    miss_count: missCount,
    hit_count: hitCount,
    miss_accuracy: missAccuracy,
    miss_accuracy_pct: missAccuracy * 100,
    miss_coverage: missCoverage,
    miss_coverage_pct: missCoverage * 100,
    hit_leakage: hitLeakage,
    hit_leakage_pct: hitLeakage * 100,
  };
}

export function getMissMiningTotals(rows) {
  const totals = {
    total_trades: rows.length,
    total_hits: 0,
    total_misses: 0,
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex].is_hit === 1) {
      totals.total_hits += 1;
    }

    if (rows[rowIndex].is_miss === 1) {
      totals.total_misses += 1;
    }
  }

  return totals;
}

export function shouldKeepMissCandidate(candidate, configObject) {
  if (candidate.miss_count <= 0) {
    return false;
  }

  return true;
}

export function sortMissCandidates(candidates) {
  candidates.sort(function(leftCandidate, rightCandidate) {
    if (rightCandidate.miss_accuracy !== leftCandidate.miss_accuracy) {
      return rightCandidate.miss_accuracy - leftCandidate.miss_accuracy;
    }

    if (rightCandidate.miss_count !== leftCandidate.miss_count) {
      return rightCandidate.miss_count - leftCandidate.miss_count;
    }

    if (rightCandidate.miss_coverage !== leftCandidate.miss_coverage) {
      return rightCandidate.miss_coverage - leftCandidate.miss_coverage;
    }

    return leftCandidate.hit_count - rightCandidate.hit_count;
  });
}

export function mineMissConditions(dataframe, trades, configObject) {
  const quantiles = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90];
  const featureColumns = getNumericFeatureColumns(dataframe);
  const tradeFeatureRows = buildTradeFeatureRows(dataframe, trades, featureColumns);
  const totals = getMissMiningTotals(tradeFeatureRows);
  const candidates = [];

  for (let featureIndex = 0; featureIndex < featureColumns.length; featureIndex += 1) {
    const featureName = featureColumns[featureIndex];
    const values = collectFeatureValues(tradeFeatureRows, featureName);
    const thresholds = buildThresholds(values, quantiles);

    for (let thresholdIndex = 0; thresholdIndex < thresholds.length; thresholdIndex += 1) {
      const threshold = thresholds[thresholdIndex];
      const greaterCandidate = scoreMissCondition(tradeFeatureRows, featureName, ">=", threshold, totals);
      const lesserCandidate = scoreMissCondition(tradeFeatureRows, featureName, "<=", threshold, totals);

      if (shouldKeepMissCandidate(greaterCandidate, configObject)) {
        candidates.push(greaterCandidate);
      }

      if (shouldKeepMissCandidate(lesserCandidate, configObject)) {
        candidates.push(lesserCandidate);
      }
    }
  }

  sortMissCandidates(candidates);

  return {
    totals: totals,
    feature_count: featureColumns.length,
    trade_feature_rows: tradeFeatureRows,
    candidates: candidates,
  };
}

export function missCandidatesToCsv(candidates) {
  const dataframe = createDataFrame("miss_candidates");
  const columns = [
    "condition",
    "feature",
    "operator",
    "threshold",
    "matched_count",
    "miss_count",
    "hit_count",
    "miss_accuracy_pct",
    "miss_coverage_pct",
    "hit_leakage_pct",
  ];

  dataframe.columns = columns;
  dataframe.data = [columns];
  dataframe.rows = candidates;

  return dataFrameToCsv(dataframe);
}
