// Coding instructions for this folder:
// - Do not use arrow functions.
// - Do not use forEach.
// - Do not use object/property shorthand.
// - Prefer explicit function declarations and plain loops.

import {
  addColumn,
  getColumnIndex,
  setDataFrameValue,
  toNumber,
} from "./utility.js";

export function getDataFrameNumber(dataframe, rowIndex, columnName) {
  const columnIndex = getColumnIndex(dataframe, columnName);
  const dataRowIndex = rowIndex + 1;

  if (columnIndex === -1) {
    return null;
  }

  if (dataRowIndex < 1 || dataRowIndex >= dataframe.data.length) {
    return null;
  }

  return toNumber(dataframe.data[dataRowIndex][columnIndex]);
}

export function addEmaDerivative(dataframe, configObject) {
  const sourceColumn = configObject.source_column;
  const outputColumn = configObject.output_column;
  const period = Number(configObject.period);
  let multiplier = null;
  let previousEma = null;

  if (period <= 0) {
    throw new Error("EMA period must be greater than zero.");
  }

  multiplier = 2 / (period + 1);
  addColumn(dataframe, outputColumn, "");

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    const sourceValue = getDataFrameNumber(dataframe, rowIndex, sourceColumn);
    let emaValue = null;

    if (sourceValue === null) {
      setDataFrameValue(dataframe, rowIndex, outputColumn, "");
      continue;
    }

    if (previousEma === null) {
      emaValue = sourceValue;
    } else {
      emaValue = (sourceValue - previousEma) * multiplier + previousEma;
    }

    previousEma = emaValue;
    setDataFrameValue(dataframe, rowIndex, outputColumn, emaValue);
  }

  return dataframe;
}

export function addDifferencePercentDerivative(dataframe, configObject) {
  const leftColumn = configObject.left_column;
  const rightColumn = configObject.right_column;
  const outputColumn = configObject.output_column;

  addColumn(dataframe, outputColumn, "");

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    const leftValue = getDataFrameNumber(dataframe, rowIndex, leftColumn);
    const rightValue = getDataFrameNumber(dataframe, rowIndex, rightColumn);
    let differencePercent = null;

    if (leftValue === null || rightValue === null || rightValue === 0) {
      setDataFrameValue(dataframe, rowIndex, outputColumn, "");
      continue;
    }

    differencePercent = ((leftValue - rightValue) / rightValue) * 100;
    setDataFrameValue(dataframe, rowIndex, outputColumn, differencePercent);
  }

  return dataframe;
}

export function addRatioDerivative(dataframe, configObject) {
  const numeratorColumn = configObject.numerator_column;
  const denominatorColumn = configObject.denominator_column;
  const outputColumn = configObject.output_column;

  addColumn(dataframe, outputColumn, "");

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    const numeratorValue = getDataFrameNumber(dataframe, rowIndex, numeratorColumn);
    const denominatorValue = getDataFrameNumber(dataframe, rowIndex, denominatorColumn);
    let ratioValue = null;

    if (numeratorValue === null || denominatorValue === null || denominatorValue === 0) {
      setDataFrameValue(dataframe, rowIndex, outputColumn, "");
      continue;
    }

    ratioValue = numeratorValue / denominatorValue;
    setDataFrameValue(dataframe, rowIndex, outputColumn, ratioValue);
  }

  return dataframe;
}

export function addMeanTwoColumnsDerivative(dataframe, configObject) {
  const leftColumn = configObject.left_column;
  const rightColumn = configObject.right_column;
  const outputColumn = configObject.output_column;

  addColumn(dataframe, outputColumn, "");

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    const leftValue = getDataFrameNumber(dataframe, rowIndex, leftColumn);
    const rightValue = getDataFrameNumber(dataframe, rowIndex, rightColumn);
    let meanValue = null;

    if (leftValue === null || rightValue === null) {
      setDataFrameValue(dataframe, rowIndex, outputColumn, "");
      continue;
    }

    meanValue = (leftValue + rightValue) / 2;
    setDataFrameValue(dataframe, rowIndex, outputColumn, meanValue);
  }

  return dataframe;
}

export function addColumnSlopePercentDerivative(dataframe, configObject) {
  const sourceColumn = configObject.source_column;
  const outputColumn = configObject.output_column;

  addColumn(dataframe, outputColumn, "");

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    const currentValue = getDataFrameNumber(dataframe, rowIndex, sourceColumn);
    const previousValue = getDataFrameNumber(dataframe, rowIndex - 1, sourceColumn);
    let slopePct = null;

    if (currentValue === null || previousValue === null || previousValue === 0) {
      setDataFrameValue(dataframe, rowIndex, outputColumn, "");
      continue;
    }

    slopePct = ((currentValue - previousValue) / previousValue) * 100;
    setDataFrameValue(dataframe, rowIndex, outputColumn, slopePct);
  }

  return dataframe;
}

export function addRollingAverageAbsoluteDerivative(dataframe, configObject) {
  const sourceColumn = configObject.source_column;
  const outputColumn = configObject.output_column;
  const windowSize = Number(configObject.window);

  addColumn(dataframe, outputColumn, "");

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    let sum = 0;
    let count = 0;
    let averageValue = null;

    for (let offset = 0; offset < windowSize; offset += 1) {
      const value = getDataFrameNumber(dataframe, rowIndex - offset, sourceColumn);

      if (value !== null) {
        sum += Math.abs(value);
        count += 1;
      }
    }

    if (count === 0) {
      setDataFrameValue(dataframe, rowIndex, outputColumn, "");
      continue;
    }

    averageValue = sum / count;
    setDataFrameValue(dataframe, rowIndex, outputColumn, averageValue);
  }

  return dataframe;
}

export function addRollingRangePercentDerivative(dataframe, configObject) {
  const sourceColumn = configObject.source_column;
  const outputColumn = configObject.output_column;
  const windowSize = Number(configObject.window);

  addColumn(dataframe, outputColumn, "");

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    let minimumValue = null;
    let maximumValue = null;
    let currentValue = getDataFrameNumber(dataframe, rowIndex, sourceColumn);
    let rangePct = null;

    for (let offset = 0; offset < windowSize; offset += 1) {
      const value = getDataFrameNumber(dataframe, rowIndex - offset, sourceColumn);

      if (value === null) {
        continue;
      }

      if (minimumValue === null || value < minimumValue) {
        minimumValue = value;
      }

      if (maximumValue === null || value > maximumValue) {
        maximumValue = value;
      }
    }

    if (currentValue === null || currentValue === 0 || minimumValue === null || maximumValue === null) {
      setDataFrameValue(dataframe, rowIndex, outputColumn, "");
      continue;
    }

    rangePct = ((maximumValue - minimumValue) / currentValue) * 100;
    setDataFrameValue(dataframe, rowIndex, outputColumn, rangePct);
  }

  return dataframe;
}

export function addEmaProxyStateDerivative(dataframe, configObject) {
  const emaColumns = configObject.ema_columns || [];
  const outputPrefix = configObject.output_prefix || "ema_proxy";
  const stackScoreColumn = outputPrefix + "_stack_score";
  const bullishStackColumn = outputPrefix + "_bullish_stack_state";
  const longTrendColumn = outputPrefix + "_long_trend_bullish_state";
  const gapExpansionColumn = outputPrefix + "_gap_expanding_state";
  const combinedBullishColumn = outputPrefix + "_bullish_multi_timeframe_state";
  const longTrendColumns = configObject.long_trend_columns || [];
  const longTrendSlopeColumns = configObject.long_trend_slope_columns || [];
  let maximumStackScore = 0;

  if (emaColumns.length > 1) {
    maximumStackScore = emaColumns.length - 1;
  }

  addColumn(dataframe, stackScoreColumn, 0);
  addColumn(dataframe, bullishStackColumn, 0);
  addColumn(dataframe, longTrendColumn, 0);
  addColumn(dataframe, gapExpansionColumn, 0);
  addColumn(dataframe, combinedBullishColumn, 0);

  for (let pairIndex = 0; pairIndex < emaColumns.length - 1; pairIndex += 1) {
    addColumn(dataframe, outputPrefix + "_gap_" + String(pairIndex + 1) + "_pct", "");
    addColumn(dataframe, outputPrefix + "_gap_" + String(pairIndex + 1) + "_expanding_state", 0);
  }

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    let stackScore = 0;
    let expandingGapCount = 0;
    let validGapCount = 0;
    let longTrendState = 1;

    for (let pairIndex = 0; pairIndex < emaColumns.length - 1; pairIndex += 1) {
      const shortColumn = emaColumns[pairIndex];
      const longColumn = emaColumns[pairIndex + 1];
      const shortValue = getDataFrameNumber(dataframe, rowIndex, shortColumn);
      const longValue = getDataFrameNumber(dataframe, rowIndex, longColumn);
      const previousShortValue = getDataFrameNumber(dataframe, rowIndex - 1, shortColumn);
      const previousLongValue = getDataFrameNumber(dataframe, rowIndex - 1, longColumn);
      const gapColumn = outputPrefix + "_gap_" + String(pairIndex + 1) + "_pct";
      const gapExpansionStateColumn = outputPrefix + "_gap_" + String(pairIndex + 1) + "_expanding_state";
      let currentGapPct = null;
      let previousGapPct = null;
      let gapExpandingState = 0;

      if (shortValue !== null && longValue !== null && longValue !== 0) {
        currentGapPct = ((shortValue - longValue) / longValue) * 100;
        setDataFrameValue(dataframe, rowIndex, gapColumn, currentGapPct);

        if (shortValue > longValue) {
          stackScore += 1;
        }
      } else {
        setDataFrameValue(dataframe, rowIndex, gapColumn, "");
      }

      if (previousShortValue !== null && previousLongValue !== null && previousLongValue !== 0) {
        previousGapPct = ((previousShortValue - previousLongValue) / previousLongValue) * 100;
      }

      if (currentGapPct !== null && previousGapPct !== null) {
        validGapCount += 1;

        if (currentGapPct > previousGapPct) {
          expandingGapCount += 1;
          gapExpandingState = 1;
        }
      }

      setDataFrameValue(dataframe, rowIndex, gapExpansionStateColumn, gapExpandingState);
    }

    for (let longIndex = 0; longIndex < longTrendColumns.length - 1; longIndex += 1) {
      const currentLongValue = getDataFrameNumber(dataframe, rowIndex, longTrendColumns[longIndex]);
      const nextLongValue = getDataFrameNumber(dataframe, rowIndex, longTrendColumns[longIndex + 1]);

      if (currentLongValue === null || nextLongValue === null || currentLongValue <= nextLongValue) {
        longTrendState = 0;
      }
    }

    for (let slopeIndex = 0; slopeIndex < longTrendSlopeColumns.length; slopeIndex += 1) {
      const slopeValue = getDataFrameNumber(dataframe, rowIndex, longTrendSlopeColumns[slopeIndex]);

      if (slopeValue === null || slopeValue <= 0) {
        longTrendState = 0;
      }
    }

    let bullishStackState = 0;
    let gapExpansionState = 0;
    let combinedBullishState = 0;

    if (maximumStackScore > 0 && stackScore === maximumStackScore) {
      bullishStackState = 1;
    }

    if (validGapCount > 0 && expandingGapCount === validGapCount) {
      gapExpansionState = 1;
    }

    if (bullishStackState === 1 && longTrendState === 1 && gapExpansionState === 1) {
      combinedBullishState = 1;
    }

    setDataFrameValue(dataframe, rowIndex, stackScoreColumn, stackScore);
    setDataFrameValue(dataframe, rowIndex, bullishStackColumn, bullishStackState);
    setDataFrameValue(dataframe, rowIndex, longTrendColumn, longTrendState);
    setDataFrameValue(dataframe, rowIndex, gapExpansionColumn, gapExpansionState);
    setDataFrameValue(dataframe, rowIndex, combinedBullishColumn, combinedBullishState);
  }

  return dataframe;
}

export function applyDerivative(dataframe, configObject) {
  if (configObject.type === "ema") {
    return addEmaDerivative(dataframe, configObject);
  }

  if (configObject.type === "differencePercent") {
    return addDifferencePercentDerivative(dataframe, configObject);
  }

  if (configObject.type === "ratio") {
    return addRatioDerivative(dataframe, configObject);
  }

  if (configObject.type === "meanTwoColumns") {
    return addMeanTwoColumnsDerivative(dataframe, configObject);
  }

  if (configObject.type === "slopePercent") {
    return addColumnSlopePercentDerivative(dataframe, configObject);
  }

  if (configObject.type === "rollingAverageAbsolute") {
    return addRollingAverageAbsoluteDerivative(dataframe, configObject);
  }

  if (configObject.type === "rollingRangePercent") {
    return addRollingRangePercentDerivative(dataframe, configObject);
  }

  if (configObject.type === "emaProxyState") {
    return addEmaProxyStateDerivative(dataframe, configObject);
  }

  throw new Error("Unsupported derivative type: " + configObject.type);
}

export function applyDerivatives(dataframe, derivativeConfigs) {
  if (!Array.isArray(derivativeConfigs)) {
    return dataframe;
  }

  for (let derivativeIndex = 0; derivativeIndex < derivativeConfigs.length; derivativeIndex += 1) {
    applyDerivative(dataframe, derivativeConfigs[derivativeIndex]);
  }

  return dataframe;
}
