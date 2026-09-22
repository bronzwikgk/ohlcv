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

export function shouldSkipHitCaseColumn(columnName) {
  if (columnName === "Date") {
    return true;
  }

  if (columnName === "target_change_pct") {
    return true;
  }

  if (columnName === "target_label") {
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

export function isNumericColumn(dataframe, columnName) {
  let numericCount = 0;

  if (shouldSkipHitCaseColumn(columnName)) {
    return false;
  }

  if (!isRelativeDerivativeMiningColumn(columnName)) {
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

export function getNumericFeatureColumns(dataframe) {
  const featureColumns = [];

  for (let columnIndex = 0; columnIndex < dataframe.columns.length; columnIndex += 1) {
    const columnName = dataframe.columns[columnIndex];

    if (isNumericColumn(dataframe, columnName)) {
      featureColumns.push(columnName);
    }
  }

  return featureColumns;
}

export function calculateForwardCloseChangePct(dataframe, rowIndex, forwardRows) {
  const entryClose = toNumber(getDataFrameValue(dataframe, rowIndex, "Close"));
  const futureClose = toNumber(getDataFrameValue(dataframe, rowIndex + forwardRows, "Close"));

  if (entryClose === null || futureClose === null) {
    return null;
  }

  if (entryClose === 0) {
    return null;
  }

  return ((futureClose - entryClose) / entryClose) * 100;
}

export function buildEntryCaseRows(dataframe, configObject, featureColumns) {
  const rows = [];
  const signalColumn = configObject.hit_case_entry_signal_column;
  const forwardRows = configObject.hit_case_forward_rows;
  const thresholdPct = configObject.hit_case_change_threshold_pct;

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    const signalValue = toNumber(getDataFrameValue(dataframe, rowIndex, signalColumn));

    if (signalValue !== 1) {
      continue;
    }

    const nextChangePct = calculateForwardCloseChangePct(dataframe, rowIndex, forwardRows);

    if (nextChangePct === null) {
      continue;
    }

    const caseRow = {
      entry_row_index: rowIndex,
      entry_date: String(getDataFrameValue(dataframe, rowIndex, "Date")),
      next_change_pct: nextChangePct,
      is_hit_case: 0,
      is_non_hit_case: 1,
    };

    if (nextChangePct > thresholdPct) {
      caseRow.is_hit_case = 1;
      caseRow.is_non_hit_case = 0;
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

export function buildThresholds(values, quantiles) {
  const thresholds = [];

  for (let quantileIndex = 0; quantileIndex < quantiles.length; quantileIndex += 1) {
    const threshold = getQuantileValue(values, quantiles[quantileIndex]);

    if (threshold !== null && !thresholdExists(thresholds, threshold)) {
      thresholds.push(threshold);
    }
  }

  return thresholds;
}

export function conditionMatches(row, featureName, operator, threshold) {
  const value = toNumber(row[featureName]);

  if (value === null) {
    return false;
  }

  if (operator === ">=") {
    return value >= threshold;
  }

  if (operator === "<=") {
    return value <= threshold;
  }

  return false;
}

export function getCaseTotals(rows) {
  const totals = {
    total_entry_cases: rows.length,
    total_hit_cases: 0,
    total_non_hit_cases: 0,
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex].is_hit_case === 1) {
      totals.total_hit_cases += 1;
    }

    if (rows[rowIndex].is_non_hit_case === 1) {
      totals.total_non_hit_cases += 1;
    }
  }

  return totals;
}

export function scoreHitCaseCondition(rows, featureName, operator, threshold, totals) {
  let hitCount = 0;
  let nonHitCount = 0;
  let matchedCount = 0;
  let accuracy = 0;
  let coverage = 0;
  let nonHitLeakage = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (conditionMatches(rows[rowIndex], featureName, operator, threshold)) {
      matchedCount += 1;

      if (rows[rowIndex].is_hit_case === 1) {
        hitCount += 1;
      }

      if (rows[rowIndex].is_non_hit_case === 1) {
        nonHitCount += 1;
      }
    }
  }

  if (matchedCount > 0) {
    accuracy = hitCount / matchedCount;
  }

  if (totals.total_hit_cases > 0) {
    coverage = hitCount / totals.total_hit_cases;
  }

  if (totals.total_non_hit_cases > 0) {
    nonHitLeakage = nonHitCount / totals.total_non_hit_cases;
  }

  return {
    condition: featureName + " " + operator + " " + String(threshold),
    feature: featureName,
    operator: operator,
    threshold: threshold,
    matched_count: matchedCount,
    hit_count: hitCount,
    non_hit_count: nonHitCount,
    accuracy: accuracy,
    accuracy_pct: accuracy * 100,
    coverage: coverage,
    coverage_pct: coverage * 100,
    non_hit_leakage: nonHitLeakage,
    non_hit_leakage_pct: nonHitLeakage * 100,
  };
}

export function shouldKeepHitCaseCandidate(candidate, configObject) {
  if (candidate.hit_count <= 0) {
    return false;
  }

  return true;
}

export function sortHitCaseCandidates(candidates) {
  candidates.sort(function(leftCandidate, rightCandidate) {
    if (rightCandidate.accuracy !== leftCandidate.accuracy) {
      return rightCandidate.accuracy - leftCandidate.accuracy;
    }

    if (rightCandidate.hit_count !== leftCandidate.hit_count) {
      return rightCandidate.hit_count - leftCandidate.hit_count;
    }

    if (rightCandidate.coverage !== leftCandidate.coverage) {
      return rightCandidate.coverage - leftCandidate.coverage;
    }

    return leftCandidate.non_hit_count - rightCandidate.non_hit_count;
  });
}

export function mineHitCaseConditions(dataframe, configObject) {
  const quantiles = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90];
  const featureColumns = getNumericFeatureColumns(dataframe);
  const entryCaseRows = buildEntryCaseRows(dataframe, configObject, featureColumns);
  const totals = getCaseTotals(entryCaseRows);
  const candidates = [];

  for (let featureIndex = 0; featureIndex < featureColumns.length; featureIndex += 1) {
    const featureName = featureColumns[featureIndex];
    const values = collectFeatureValues(entryCaseRows, featureName);
    const thresholds = buildThresholds(values, quantiles);

    for (let thresholdIndex = 0; thresholdIndex < thresholds.length; thresholdIndex += 1) {
      const threshold = thresholds[thresholdIndex];
      const greaterCandidate = scoreHitCaseCondition(entryCaseRows, featureName, ">=", threshold, totals);
      const lesserCandidate = scoreHitCaseCondition(entryCaseRows, featureName, "<=", threshold, totals);

      if (shouldKeepHitCaseCandidate(greaterCandidate, configObject)) {
        candidates.push(greaterCandidate);
      }

      if (shouldKeepHitCaseCandidate(lesserCandidate, configObject)) {
        candidates.push(lesserCandidate);
      }
    }
  }

  sortHitCaseCandidates(candidates);

  return {
    totals: totals,
    feature_count: featureColumns.length,
    entry_case_rows: entryCaseRows,
    candidates: candidates,
  };
}

export function hitCaseCandidatesToCsv(candidates) {
  const dataframe = createDataFrame("hit_case_candidates");
  const columns = [
    "condition",
    "feature",
    "operator",
    "threshold",
    "matched_count",
    "hit_count",
    "non_hit_count",
    "accuracy_pct",
    "coverage_pct",
    "non_hit_leakage_pct",
  ];

  dataframe.columns = columns;
  dataframe.data = [columns];
  dataframe.rows = candidates;

  return dataFrameToCsv(dataframe);
}
