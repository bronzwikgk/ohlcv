import {
  positive_0_1,
  positive_1_3,
  positive_3_5,
  positive_5_8,
  positive_8_13,
  positive_13_16,
  positive_16_21,
  negative_0_1,
  negative_1_3,
  negative_3_5,
  negative_5_8,
  negative_8_13,
  negative_13_16,
  negative_16_21,
  changeBracketSymbols,
} from "./change_bracket_symbols.js";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createDataFrame,
  createDataFrameSchema,
  createOutputFileName,
  dataFrameToCsv,
  parseCsvToArray,
  rowCount,
  setDataFrameFromArray,
  validateDataFrame,
} from "./utility.js";
import { RuleEngine } from "./rule_engine.js";
import { applyDerivatives } from "./derivative.js";
import {
  applyStrategies,
  createStrategyReport,
} from "./strategy_engine.js";
import {
  mineMissConditions,
  missCandidatesToCsv,
} from "./miss_mining.js";
import {
  hitCaseCandidatesToCsv,
  mineHitCaseConditions,
} from "./hit_case_mining.js";
import {
  optimizeStrategiesRecursively,
  saveStrategyOptimizationCandidates,
  saveStrategyOptimizationReport,
} from "./strategy_optimizer.js";
import {
  baseEntryCandidatesToCsv,
  candidateToStrategy,
  mineBaseEntryRules,
} from "./base_entry_miner.js";
// Coding instructions for this folder:
// - Do not use arrow functions.
// - Do not use forEach.
// - Do not use object/property shorthand.
// - Prefer explicit function declarations and plain loops.
// - Keep dataframe-style operations in utility.js and execute those functions in sequence here.

// Define Symbols
export const data_path = "D:/0dot1_Aug_2016_master/data/mstock_mtf_daily_data";
export const output_path = "E:/archieve/july_2026/minor_gk/output_rerun";
export const default_symbol = "LLOYDSENGG";
export const active_dataframe = createDataFrame("active_dataframe");

export const default_target = {
  timeframe: "daily",
  price_column: "Close",
  target_time: 1,
  change_column: "target_change_pct",
  target_label_column: "target_label",
  enter_label_column: "enter_label",
  exit_label_column: "exit_label",
  target_min_pct: 3,
  target_max_pct: 5,
  include_min: true,
  include_max: false,
  exit_risk_pct: -2,
  unknown_label_value: "",
};

export const default_derivatives = [
  {
    timeframe: "daily",
    group: "price",
    type: "meanTwoColumns",
    left_column: "Open",
    right_column: "Close",
    output_column: "mean_open_close_daily",
  },
  {
    timeframe: "daily",
    group: "close",
    type: "ema",
    source_column: "Close",
    output_column: "close_ema_3_daily",
    period: 3,
  },
  {
    timeframe: "daily",
    group: "close",
    type: "differencePercent",
    left_column: "Close",
    right_column: "close_ema_3_daily",
    output_column: "close_to_close_ema_3_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "close",
    type: "ema",
    source_column: "Close",
    output_column: "close_ema_8_daily",
    period: 8,
  },
  {
    timeframe: "daily",
    group: "close",
    type: "differencePercent",
    left_column: "Close",
    right_column: "close_ema_8_daily",
    output_column: "close_to_close_ema_8_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "close",
    type: "ema",
    source_column: "Close",
    output_column: "close_ema_13_daily",
    period: 13,
  },
  {
    timeframe: "daily",
    group: "close",
    type: "differencePercent",
    left_column: "Close",
    right_column: "close_ema_13_daily",
    output_column: "close_to_close_ema_13_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "close",
    type: "ema",
    source_column: "Close",
    output_column: "close_ema_21_daily",
    period: 21,
  },
  {
    timeframe: "daily",
    group: "close",
    type: "differencePercent",
    left_column: "Close",
    right_column: "close_ema_21_daily",
    output_column: "close_to_close_ema_21_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "close",
    type: "ema",
    source_column: "Close",
    output_column: "close_ema_55_daily",
    period: 55,
  },
  {
    timeframe: "daily",
    group: "close",
    type: "differencePercent",
    left_column: "Close",
    right_column: "close_ema_55_daily",
    output_column: "close_to_close_ema_55_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "close",
    type: "ema",
    source_column: "Close",
    output_column: "close_ema_144_daily",
    period: 144,
  },
  {
    timeframe: "daily",
    group: "close",
    type: "differencePercent",
    left_column: "Close",
    right_column: "close_ema_144_daily",
    output_column: "close_to_close_ema_144_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "close",
    type: "ema",
    source_column: "Close",
    output_column: "close_ema_221_daily",
    period: 221,
  },
  {
    timeframe: "daily",
    group: "close",
    type: "differencePercent",
    left_column: "Close",
    right_column: "close_ema_221_daily",
    output_column: "close_to_close_ema_221_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "ema",
    source_column: "Volume",
    output_column: "volume_ema_3_daily",
    period: 3,
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "differencePercent",
    left_column: "Volume",
    right_column: "volume_ema_3_daily",
    output_column: "volume_to_volume_ema_3_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "ema",
    source_column: "Volume",
    output_column: "volume_ema_5_daily",
    period: 5,
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "differencePercent",
    left_column: "Volume",
    right_column: "volume_ema_5_daily",
    output_column: "volume_to_volume_ema_5_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "ema",
    source_column: "Volume",
    output_column: "volume_ema_8_daily",
    period: 8,
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "differencePercent",
    left_column: "Volume",
    right_column: "volume_ema_8_daily",
    output_column: "volume_to_volume_ema_8_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "ema",
    source_column: "Volume",
    output_column: "volume_ema_21_daily",
    period: 21,
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "differencePercent",
    left_column: "Volume",
    right_column: "volume_ema_21_daily",
    output_column: "volume_to_volume_ema_21_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "ema",
    source_column: "Volume",
    output_column: "volume_ema_55_daily",
    period: 55,
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "differencePercent",
    left_column: "Volume",
    right_column: "volume_ema_55_daily",
    output_column: "volume_to_volume_ema_55_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "ema",
    source_column: "Volume",
    output_column: "volume_ema_144_daily",
    period: 144,
  },
  {
    timeframe: "daily",
    group: "volume",
    type: "differencePercent",
    left_column: "Volume",
    right_column: "volume_ema_144_daily",
    output_column: "volume_to_volume_ema_144_daily_difference_pct",
  },
  {
    timeframe: "daily",
    group: "high",
    type: "ema",
    source_column: "High",
    output_column: "high_ema_3_daily",
    period: 3,
  },
  {
    timeframe: "daily",
    group: "high",
    type: "ema",
    source_column: "High",
    output_column: "high_ema_13_daily",
    period: 13,
  },
  {
    timeframe: "daily",
    group: "low",
    type: "ema",
    source_column: "Low",
    output_column: "low_ema_3_daily",
    period: 3,
  },
  {
    timeframe: "daily",
    group: "low",
    type: "ema",
    source_column: "Low",
    output_column: "low_ema_13_daily",
    period: 13,
  },
  {
    timeframe: "daily",
    group: "range",
    type: "ratio",
    numerator_column: "High",
    denominator_column: "Low",
    output_column: "high_low_ratio_daily",
  },
];

export const selected_ema_flatness_columns = [
  "close_ema_3_daily",
  "close_ema_8_daily",
  "close_ema_13_daily",
  "close_ema_21_daily",
  "close_ema_55_daily",
  "close_ema_144_daily",
  "close_ema_221_daily",
];

export function addEmaFlatnessDerivatives(derivativesArray, emaColumns, windowSize) {
  const outputDerivatives = [];

  for (let derivativeIndex = 0; derivativeIndex < derivativesArray.length; derivativeIndex += 1) {
    outputDerivatives.push(derivativesArray[derivativeIndex]);
  }

  for (let emaIndex = 0; emaIndex < emaColumns.length; emaIndex += 1) {
    const emaColumn = emaColumns[emaIndex];
    const slopeColumn = emaColumn + "_slope_pct";
    const volatilityColumn = emaColumn + "_volatility_" + String(windowSize) + "_daily";
    const rangeColumn = emaColumn + "_range_" + String(windowSize) + "_pct";

    outputDerivatives.push({
      timeframe: "daily",
      group: "ema_flatness",
      type: "slopePercent",
      source_column: emaColumn,
      output_column: slopeColumn,
    });

    outputDerivatives.push({
      timeframe: "daily",
      group: "ema_flatness",
      type: "rollingAverageAbsolute",
      source_column: slopeColumn,
      output_column: volatilityColumn,
      window: windowSize,
    });

    outputDerivatives.push({
      timeframe: "daily",
      group: "ema_flatness",
      type: "rollingRangePercent",
      source_column: emaColumn,
      output_column: rangeColumn,
      window: windowSize,
    });
  }

  return outputDerivatives;
}

export function addEmaMultiTimeframeProxyDerivatives(derivativesArray) {
  const outputDerivatives = [];

  for (let derivativeIndex = 0; derivativeIndex < derivativesArray.length; derivativeIndex += 1) {
    outputDerivatives.push(derivativesArray[derivativeIndex]);
  }

  outputDerivatives.push({
    timeframe: "multi_proxy",
    group: "ema_multi_timeframe_proxy",
    type: "emaProxyState",
    output_prefix: "ema_proxy",
    ema_columns: [
      "close_ema_3_daily",
      "close_ema_8_daily",
      "close_ema_13_daily",
      "close_ema_21_daily",
      "close_ema_55_daily",
      "close_ema_144_daily",
      "close_ema_221_daily",
    ],
    long_trend_columns: [
      "close_ema_55_daily",
      "close_ema_144_daily",
      "close_ema_221_daily",
    ],
    long_trend_slope_columns: [
      "close_ema_55_daily_slope_pct",
      "close_ema_144_daily_slope_pct",
      "close_ema_221_daily_slope_pct",
    ],
  });

  return outputDerivatives;
}

export function createMinerInput(symbol) {
  const dataframe = createDataFrame("active_dataframe");

  return {
    symbol: symbol,
    dataframe: dataframe,
    strategy_trades: [],
    strategy_report: null,
    base_entry_mining_report: null,
    miss_mining_report: null,
    hit_case_mining_report: null,
    strategy_optimization_report: null,
    validation_report: null,
    saved_file_path: "",
    saved_trades_file_path: "",
    saved_strategy_report_file_path: "",
    saved_base_entry_candidates_file_path: "",
    saved_base_entry_report_file_path: "",
    saved_miss_candidates_file_path: "",
    saved_miss_report_file_path: "",
    saved_hit_case_candidates_file_path: "",
    saved_hit_case_report_file_path: "",
    saved_strategy_optimization_candidates_file_path: "",
    saved_strategy_optimization_report_file_path: "",
  };
}

export function createTargetLabelingConfig(targetObject) {
  return {
    timeframe: targetObject.timeframe,
    price_column: targetObject.price_column,
    target_time: targetObject.target_time,
    change_column: targetObject.change_column,
    target_label_column: targetObject.target_label_column,
    enter_label_column: targetObject.enter_label_column,
    exit_label_column: targetObject.exit_label_column,
    unknown_label_value: targetObject.unknown_label_value,
    change_expression: {
      type: "expression",
      operator: "percentChange",
      left: {
        type: "column",
        column: targetObject.price_column,
        row_offset: 0,
      },
      right: {
        type: "column",
        column: targetObject.price_column,
        row_offset: targetObject.target_time,
      },
    },
    target_rule: {
      type: "condition",
      operator: "inRange",
      left: {
        type: "column",
        column: targetObject.change_column,
        row_offset: 0,
      },
      range: {
        min: targetObject.target_min_pct,
        max: targetObject.target_max_pct,
        include_min: targetObject.include_min,
        include_max: targetObject.include_max,
      },
    },
    enter_rule: {
      type: "condition",
      operator: "equalTo",
      left: {
        type: "column",
        column: targetObject.target_label_column,
        row_offset: 0,
      },
      right: {
        type: "value",
        value: 1,
      },
    },
    exit_rule: {
      type: "condition",
      operator: "lessThan",
      left: {
        type: "column",
        column: targetObject.change_column,
        row_offset: 0,
      },
      right: {
        type: "value",
        value: targetObject.exit_risk_pct,
      },
    },
  };
}

export function createDataFrameSchemaConfig() {
  return createDataFrameSchema("active_dataframe_schema", [
    {
      name: "Date",
      type: "date",
      required: true,
    },
    {
      name: "Open",
      type: "number",
      required: true,
    },
    {
      name: "High",
      type: "number",
      required: true,
    },
    {
      name: "Low",
      type: "number",
      required: true,
    },
    {
      name: "Close",
      type: "number",
      required: true,
    },
    {
      name: "Price",
      type: "number",
      required: false,
    },
    {
      name: "Volume",
      type: "number",
      required: false,
    },
    {
      name: "target_change_pct",
      type: "number",
      required: false,
      nullable: true,
      allow_blank: true,
    },
    {
      name: "target_label",
      type: "label",
      required: false,
      allow_blank: true,
    },
    {
      name: "enter_label",
      type: "label",
      required: false,
      allow_blank: true,
    },
    {
      name: "exit_label",
      type: "label",
      required: false,
      allow_blank: true,
    },
  ]);
}

export function createMinerConfig(targetObject, derivativesArray, minimumRows, timeframesArray, expectedAccuracyThreshold, minimumCount, strategiesArray, missMiningMinimumCount, hitCaseMinimumCount, hitCaseForwardRows, hitCaseChangeThresholdPct, strategyOptimizerConfig, baseEntryMinerConfig) {
  let activeMissMiningMinimumCount = minimumCount;
  let activeHitCaseMinimumCount = minimumCount;
  let activeHitCaseForwardRows = 1;
  let activeHitCaseChangeThresholdPct = 5;

  if (missMiningMinimumCount !== undefined) {
    activeMissMiningMinimumCount = missMiningMinimumCount;
  }

  if (hitCaseMinimumCount !== undefined) {
    activeHitCaseMinimumCount = hitCaseMinimumCount;
  }

  if (hitCaseForwardRows !== undefined) {
    activeHitCaseForwardRows = hitCaseForwardRows;
  }

  if (hitCaseChangeThresholdPct !== undefined) {
    activeHitCaseChangeThresholdPct = hitCaseChangeThresholdPct;
  }

  return {
    data_path: data_path,
    output_path: output_path,
    output_suffix: "_processed.csv",
    run_timestamp: "",
    minimum_rows: minimumRows,
    expected_accuracy_threshold: expectedAccuracyThreshold,
    minimum_count: minimumCount,
    miss_mining_minimum_count: activeMissMiningMinimumCount,
    hit_case_entry_signal_column: "strategy_entry_signal",
    hit_case_forward_rows: activeHitCaseForwardRows,
    hit_case_change_threshold_pct: activeHitCaseChangeThresholdPct,
    hit_case_minimum_count: activeHitCaseMinimumCount,
    active_timeframes: timeframesArray,
    strategies: strategiesArray,
    base_entry_miner: createBaseEntryMinerConfig(baseEntryMinerConfig, minimumCount),
    strategy_optimizer: createStrategyOptimizerConfig(strategyOptimizerConfig, expectedAccuracyThreshold, minimumCount),
    log_summary: {
      print_header: true,
      print_first_row: true,
      print_last_row: true,
      print_total_row_count: true,
      print_total_column_count: true,
    },
    derivatives: derivativesArray,
    target_labeling: createTargetLabelingConfig(targetObject),
    dataframe_schema: createDataFrameSchemaConfig(),
  };
}

export function createBaseEntryMinerConfig(baseEntryMinerConfig, minimumCount) {
  const safeConfig = baseEntryMinerConfig || {};
  const outputConfig = {
    enabled: false,
    use_mined_strategy_as_base: false,
    minimum_count: minimumCount,
    max_depth: 3,
    single_candidate_limit: 24,
    backtest_candidate_limit: 30,
    exit_holding_days: 2,
    maximum_match_rate: 0.55,
    minimum_win_rate_lift_pct: 5,
    minimum_average_return_pct: 0,
    case_filter_rule: null,
  };

  if (safeConfig.enabled !== undefined) {
    outputConfig.enabled = safeConfig.enabled;
  }

  if (safeConfig.use_mined_strategy_as_base !== undefined) {
    outputConfig.use_mined_strategy_as_base = safeConfig.use_mined_strategy_as_base;
  }

  if (safeConfig.minimum_count !== undefined) {
    outputConfig.minimum_count = safeConfig.minimum_count;
  }

  if (safeConfig.max_depth !== undefined) {
    outputConfig.max_depth = safeConfig.max_depth;
  }

  if (safeConfig.single_candidate_limit !== undefined) {
    outputConfig.single_candidate_limit = safeConfig.single_candidate_limit;
  }

  if (safeConfig.backtest_candidate_limit !== undefined) {
    outputConfig.backtest_candidate_limit = safeConfig.backtest_candidate_limit;
  }

  if (safeConfig.exit_holding_days !== undefined) {
    outputConfig.exit_holding_days = safeConfig.exit_holding_days;
  }

  if (safeConfig.maximum_match_rate !== undefined) {
    outputConfig.maximum_match_rate = safeConfig.maximum_match_rate;
  }

  if (safeConfig.minimum_win_rate_lift_pct !== undefined) {
    outputConfig.minimum_win_rate_lift_pct = safeConfig.minimum_win_rate_lift_pct;
  }

  if (safeConfig.minimum_average_return_pct !== undefined) {
    outputConfig.minimum_average_return_pct = safeConfig.minimum_average_return_pct;
  }

  if (safeConfig.case_filter_rule !== undefined) {
    outputConfig.case_filter_rule = safeConfig.case_filter_rule;
  }

  return outputConfig;
}

export function createStrategyOptimizerConfig(strategyOptimizerConfig, expectedAccuracyThreshold, minimumCount) {
  const safeConfig = strategyOptimizerConfig || {};
  const outputConfig = {
    enabled: false,
    accuracy_threshold: expectedAccuracyThreshold,
    annual_return_threshold_pct: 25,
    minimum_trades: minimumCount,
    max_depth: 2,
    top_hit_candidates: 5,
    top_miss_candidates: 5,
  };

  if (safeConfig.enabled !== undefined) {
    outputConfig.enabled = safeConfig.enabled;
  }

  if (safeConfig.accuracy_threshold !== undefined) {
    outputConfig.accuracy_threshold = safeConfig.accuracy_threshold;
  }

  if (safeConfig.annual_return_threshold_pct !== undefined) {
    outputConfig.annual_return_threshold_pct = safeConfig.annual_return_threshold_pct;
  }

  if (safeConfig.minimum_trades !== undefined) {
    outputConfig.minimum_trades = safeConfig.minimum_trades;
  }

  if (safeConfig.max_depth !== undefined) {
    outputConfig.max_depth = safeConfig.max_depth;
  }

  if (safeConfig.top_hit_candidates !== undefined) {
    outputConfig.top_hit_candidates = safeConfig.top_hit_candidates;
  }

  if (safeConfig.top_miss_candidates !== undefined) {
    outputConfig.top_miss_candidates = safeConfig.top_miss_candidates;
  }

  return outputConfig;
}

export const miner_input = createMinerInput(default_symbol);

export const miner_config = createMinerConfig(default_target, default_derivatives, 800, ["daily"], 0.75, 20, [], 3, 2, 1, 5);

export function normalizeSymbol(symbol) {
  return String(symbol || "").replace(".NS", "").trim().toUpperCase();
}

export function setActiveSymbol(inputObject, symbol) {
  const symbolKey = normalizeSymbol(symbol);

  inputObject.symbol = symbolKey;

  return inputObject;
}

async function findActiveSymbolCsv(inputObject, configObject) {
  const symbolKey = normalizeSymbol(inputObject.symbol);
  const sourceDataPath = configObject.data_path;
  const files = await readdir(sourceDataPath);
  const candidates = [
    `${symbolKey}.NS_`,
    `${symbolKey}_`,
    `${symbolKey}.NS.csv`,
    `${symbolKey}.csv`,
  ];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const upperFile = file.toUpperCase();

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      const upperCandidate = candidate.toUpperCase();
      const isExactCsv = candidate.endsWith(".csv") && upperFile === upperCandidate;
      const isPrefixCsv = !candidate.endsWith(".csv") && upperFile.startsWith(upperCandidate) && upperFile.endsWith(".CSV");

      if (isExactCsv || isPrefixCsv) {
        return path.join(sourceDataPath, file);
      }
    }
  }

  throw new Error(`No CSV file found for active symbol: ${symbolKey}`);
}

export async function loadActiveSymbolData(inputObject, configObject) {
  const symbolKey = normalizeSymbol(inputObject.symbol);

  setActiveSymbol(inputObject, symbolKey);

  const csvPath = await findActiveSymbolCsv(inputObject, configObject);
  const csvText = await readFile(csvPath, "utf8");
  const table = parseCsvToArray(csvText);
  const dataframeOptions = {
    symbol: inputObject.symbol,
    file_path: csvPath,
  };

  setDataFrameFromArray(inputObject.dataframe, table, dataframeOptions);
  return inputObject;
}

export function validateMinimumRows(inputObject, configObject) {
  const dataframeRowCount = rowCount(inputObject.dataframe);

  if (dataframeRowCount < configObject.minimum_rows) {
    throw new Error(
      "Minimum row check failed for " +
      inputObject.symbol +
      ". Required: " +
      String(configObject.minimum_rows) +
      ", actual: " +
      String(dataframeRowCount) +
      ".",
    );
  }

  return inputObject;
}

export function isTimeframeActive(configObject, timeframe) {
  if (!Array.isArray(configObject.active_timeframes)) {
    return true;
  }

  if (configObject.active_timeframes.length === 0) {
    return true;
  }

  for (let timeframeIndex = 0; timeframeIndex < configObject.active_timeframes.length; timeframeIndex += 1) {
    if (configObject.active_timeframes[timeframeIndex] === timeframe) {
      return true;
    }
  }

  return false;
}

export function filterDerivativesByActiveTimeframes(derivativesArray, configObject) {
  const filteredDerivatives = [];

  for (let derivativeIndex = 0; derivativeIndex < derivativesArray.length; derivativeIndex += 1) {
    const derivativeConfig = derivativesArray[derivativeIndex];

    if (isTimeframeActive(configObject, derivativeConfig.timeframe)) {
      filteredDerivatives.push(derivativeConfig);
    }
  }

  return filteredDerivatives;
}

export function logActiveDataFrameSummary(inputObject, configObject) {
  const dataframe = inputObject.dataframe;
  const logConfig = configObject.log_summary;
  let totalRowCount = 0;
  let totalColumnCount = 0;
  let firstRow = [];
  let lastRow = [];

  if (dataframe.data.length > 0) {
    totalRowCount = dataframe.data.length - 1;
  }

  totalColumnCount = dataframe.columns.length;

  if (dataframe.data.length > 1) {
    firstRow = dataframe.data[1];
    lastRow = dataframe.data[dataframe.data.length - 1];
  }

  if (logConfig.print_header) {
    console.log("Header:", dataframe.columns);
  }

  if (logConfig.print_first_row) {
    console.log("First row:", firstRow);
  }

  if (logConfig.print_last_row) {
    console.log("Last row:", lastRow);
  }

  if (logConfig.print_total_row_count) {
    console.log("Total row count:", totalRowCount);
  }

  if (logConfig.print_total_column_count) {
    console.log("Total column count:", totalColumnCount);
  }
}

export function applyTargetEntryExitLabels(inputObject, configObject) {
  if (!isTimeframeActive(configObject, configObject.target_labeling.timeframe)) {
    return inputObject;
  }

  configObject.target_labeling.change_expression.right.row_offset = configObject.target_labeling.target_time;

  const ruleEngine = new RuleEngine(inputObject.dataframe);

  ruleEngine.addTargetEntryExitLabels(configObject.target_labeling);

  return inputObject;
}

export function applyConfiguredDerivatives(inputObject, configObject) {
  const activeDerivatives = filterDerivativesByActiveTimeframes(configObject.derivatives, configObject);

  applyDerivatives(inputObject.dataframe, activeDerivatives);

  return inputObject;
}

export function applyConfiguredStrategies(inputObject, configObject) {
  inputObject.strategy_trades = applyStrategies(inputObject.dataframe, configObject.strategies);
  inputObject.strategy_report = createStrategyReport(inputObject.dataframe, inputObject.strategy_trades);

  return inputObject;
}

export function applyBaseEntryMining(inputObject, configObject) {
  if (!configObject.base_entry_miner.enabled) {
    inputObject.base_entry_mining_report = {
      enabled: false,
      candidates: [],
    };

    return inputObject;
  }

  inputObject.base_entry_mining_report = mineBaseEntryRules(inputObject.dataframe, configObject, inputObject.symbol);

  if (configObject.base_entry_miner.use_mined_strategy_as_base) {
    replaceStrategiesWithBestMinedBase(inputObject, configObject);
  }

  return inputObject;
}

export function replaceStrategiesWithBestMinedBase(inputObject, configObject) {
  if (inputObject.base_entry_mining_report === null || inputObject.base_entry_mining_report === undefined) {
    return inputObject;
  }

  if (!Array.isArray(inputObject.base_entry_mining_report.candidates)) {
    return inputObject;
  }

  if (inputObject.base_entry_mining_report.candidates.length === 0) {
    return inputObject;
  }

  const bestCandidate = inputObject.base_entry_mining_report.candidates[0];
  const minedStrategy = candidateToStrategy(bestCandidate, configObject, inputObject.symbol);

  configObject.strategies = [minedStrategy];

  return inputObject;
}

export function applyMissMining(inputObject, configObject) {
  inputObject.miss_mining_report = mineMissConditions(
    inputObject.dataframe,
    inputObject.strategy_trades,
    configObject,
  );

  return inputObject;
}

export function applyHitCaseMining(inputObject, configObject) {
  inputObject.hit_case_mining_report = mineHitCaseConditions(inputObject.dataframe, configObject);

  return inputObject;
}

export function applyStrategyOptimization(inputObject, configObject) {
  inputObject.strategy_optimization_report = optimizeStrategiesRecursively(inputObject, configObject);

  return inputObject;
}

export function validateActiveDataFrame(inputObject, configObject) {
  const validationReport = validateDataFrame(inputObject.dataframe, configObject.dataframe_schema);

  inputObject.validation_report = validationReport;

  return validationReport;
}

export async function saveActiveDataFrame(inputObject, configObject) {
  const csvText = dataFrameToCsv(inputObject.dataframe);
  const fileName = createOutputFileName(configObject, inputObject.symbol + configObject.output_suffix);
  const filePath = path.join(configObject.output_path, fileName);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, csvText, "utf8");

  inputObject.saved_file_path = filePath;

  return filePath;
}

export function tradeObjectsToCsv(trades) {
  const tradeColumns = [
    "strategy_name",
    "symbol",
    "entry_row_index",
    "entry_date",
    "entry_price",
    "exit_row_index",
    "exit_date",
    "exit_price",
    "holding_days",
    "exit_reason",
    "change_pct",
  ];
  const tradeDataFrame = createDataFrame("strategy_trades");

  tradeDataFrame.columns = tradeColumns;
  tradeDataFrame.data = [tradeColumns];
  tradeDataFrame.rows = trades;

  return dataFrameToCsv(tradeDataFrame);
}

export async function saveStrategyTrades(inputObject, configObject) {
  const csvText = tradeObjectsToCsv(inputObject.strategy_trades);
  const fileName = createOutputFileName(configObject, inputObject.symbol + "_strategy_trades.csv");
  const filePath = path.join(configObject.output_path, fileName);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, csvText, "utf8");

  inputObject.saved_trades_file_path = filePath;

  return filePath;
}

export async function saveStrategyReport(inputObject, configObject) {
  const fileName = createOutputFileName(configObject, inputObject.symbol + "_strategy_report.json");
  const filePath = path.join(configObject.output_path, fileName);
  const jsonText = JSON.stringify(inputObject.strategy_report, null, 2);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, jsonText, "utf8");

  inputObject.saved_strategy_report_file_path = filePath;

  return filePath;
}

export async function saveBaseEntryCandidates(inputObject, configObject) {
  if (inputObject.base_entry_mining_report === null || inputObject.base_entry_mining_report === undefined) {
    return "";
  }

  const csvText = baseEntryCandidatesToCsv(inputObject.base_entry_mining_report.candidates);
  const fileName = createOutputFileName(configObject, inputObject.symbol + "_base_entry_candidates.csv");
  const filePath = path.join(configObject.output_path, fileName);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, csvText, "utf8");

  inputObject.saved_base_entry_candidates_file_path = filePath;

  return filePath;
}

export async function saveBaseEntryReport(inputObject, configObject) {
  if (inputObject.base_entry_mining_report === null || inputObject.base_entry_mining_report === undefined) {
    return "";
  }

  const reportForSave = {
    enabled: inputObject.base_entry_mining_report.enabled,
    schema_version: inputObject.base_entry_mining_report.schema_version,
    symbol: inputObject.base_entry_mining_report.symbol,
    feature_count: inputObject.base_entry_mining_report.feature_count,
    entry_case_count: inputObject.base_entry_mining_report.entry_case_count,
    single_candidate_count: inputObject.base_entry_mining_report.single_candidate_count,
    candidate_count: inputObject.base_entry_mining_report.candidate_count,
    baseline: inputObject.base_entry_mining_report.baseline,
    base_case_definition: "Base case is selected by useful occurrence: enough recurring wins, win-rate lift over baseline, positive return, not-too-broad match rate, plus dominant exit occurrence.",
    top_candidates: [],
  };
  const maxTopCount = 20;

  for (let candidateIndex = 0; candidateIndex < inputObject.base_entry_mining_report.candidates.length; candidateIndex += 1) {
    if (candidateIndex >= maxTopCount) {
      break;
    }

    reportForSave.top_candidates.push(inputObject.base_entry_mining_report.candidates[candidateIndex]);
  }

  const fileName = createOutputFileName(configObject, inputObject.symbol + "_base_entry_report.json");
  const filePath = path.join(configObject.output_path, fileName);
  const jsonText = JSON.stringify(reportForSave, null, 2);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, jsonText, "utf8");

  inputObject.saved_base_entry_report_file_path = filePath;

  return filePath;
}

export async function saveMissMiningCandidates(inputObject, configObject) {
  const csvText = missCandidatesToCsv(inputObject.miss_mining_report.candidates);
  const fileName = createOutputFileName(configObject, inputObject.symbol + "_miss_candidates.csv");
  const filePath = path.join(configObject.output_path, fileName);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, csvText, "utf8");

  inputObject.saved_miss_candidates_file_path = filePath;

  return filePath;
}

export async function saveMissMiningReport(inputObject, configObject) {
  const reportForSave = {
    totals: inputObject.miss_mining_report.totals,
    feature_count: inputObject.miss_mining_report.feature_count,
    candidate_count: inputObject.miss_mining_report.candidates.length,
    top_candidates: [],
  };
  const maxTopCount = 20;

  for (let candidateIndex = 0; candidateIndex < inputObject.miss_mining_report.candidates.length; candidateIndex += 1) {
    if (candidateIndex >= maxTopCount) {
      break;
    }

    reportForSave.top_candidates.push(inputObject.miss_mining_report.candidates[candidateIndex]);
  }

  const fileName = createOutputFileName(configObject, inputObject.symbol + "_miss_report.json");
  const filePath = path.join(configObject.output_path, fileName);
  const jsonText = JSON.stringify(reportForSave, null, 2);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, jsonText, "utf8");

  inputObject.saved_miss_report_file_path = filePath;

  return filePath;
}

export async function saveHitCaseCandidates(inputObject, configObject) {
  const csvText = hitCaseCandidatesToCsv(inputObject.hit_case_mining_report.candidates);
  const fileName = createOutputFileName(configObject, inputObject.symbol + "_hit_case_candidates.csv");
  const filePath = path.join(configObject.output_path, fileName);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, csvText, "utf8");

  inputObject.saved_hit_case_candidates_file_path = filePath;

  return filePath;
}

export async function saveHitCaseReport(inputObject, configObject) {
  const reportForSave = {
    totals: inputObject.hit_case_mining_report.totals,
    feature_count: inputObject.hit_case_mining_report.feature_count,
    candidate_count: inputObject.hit_case_mining_report.candidates.length,
    top_candidates: [],
  };
  const maxTopCount = 20;

  for (let candidateIndex = 0; candidateIndex < inputObject.hit_case_mining_report.candidates.length; candidateIndex += 1) {
    if (candidateIndex >= maxTopCount) {
      break;
    }

    reportForSave.top_candidates.push(inputObject.hit_case_mining_report.candidates[candidateIndex]);
  }

  const fileName = createOutputFileName(configObject, inputObject.symbol + "_hit_case_report.json");
  const filePath = path.join(configObject.output_path, fileName);
  const jsonText = JSON.stringify(reportForSave, null, 2);

  await mkdir(configObject.output_path, {
    recursive: true,
  });

  await writeFile(filePath, jsonText, "utf8");

  inputObject.saved_hit_case_report_file_path = filePath;

  return filePath;
}

export function logStrategyReport(inputObject) {
  const report = inputObject.strategy_report;

  if (report === null || report === undefined) {
    return inputObject;
  }

  console.log("Strategy accuracy:", report.accuracy_pct);
  console.log("Average return per month:", report.avg_return_per_month_pct);
  console.log("Average return per annum:", report.avg_return_per_annum_pct);

  return inputObject;
}

export function logBaseEntryMiningReport(inputObject) {
  const report = inputObject.base_entry_mining_report;

  if (report === null || report === undefined) {
    return inputObject;
  }

  if (!report.enabled) {
    return inputObject;
  }

  console.log("Base entry candidates:", report.candidates.length);

  if (report.candidates.length > 0) {
    console.log("Top base rule:", report.candidates[0].rule_text);
    console.log("Top base entry occurrence:", report.candidates[0].entry_occurrence_count);
    console.log("Top base exit occurrence:", report.candidates[0].exit_occurrence_count);
    console.log("Top base win rate:", report.candidates[0].win_rate_pct);
  }

  return inputObject;
}

export function logMissMiningReport(inputObject) {
  const report = inputObject.miss_mining_report;

  if (report === null || report === undefined) {
    return inputObject;
  }

  console.log("Miss mining candidates:", report.candidates.length);

  if (report.candidates.length > 0) {
    console.log("Top miss condition:", report.candidates[0].condition);
    console.log("Top miss accuracy:", report.candidates[0].miss_accuracy_pct);
    console.log("Top miss count:", report.candidates[0].miss_count);
    console.log("Top hit leakage:", report.candidates[0].hit_count);
  }

  return inputObject;
}

export function logHitCaseMiningReport(inputObject) {
  const report = inputObject.hit_case_mining_report;

  if (report === null || report === undefined) {
    return inputObject;
  }

  console.log("Hit case candidates:", report.candidates.length);

  if (report.candidates.length > 0) {
    console.log("Top hit case condition:", report.candidates[0].condition);
    console.log("Top hit case accuracy:", report.candidates[0].accuracy_pct);
    console.log("Top hit case count:", report.candidates[0].hit_count);
    console.log("Top non-hit leakage:", report.candidates[0].non_hit_count);
  }

  return inputObject;
}

export function logStrategyOptimizationReport(inputObject) {
  const report = inputObject.strategy_optimization_report;

  if (report === null || report === undefined) {
    return inputObject;
  }

  if (!report.enabled) {
    return inputObject;
  }

  console.log("Optimization tested versions:", report.tested_version_count);
  console.log("Optimization threshold reached:", report.threshold_reached);
  console.log("Optimization annual threshold:", report.annual_return_threshold_pct);

  if (report.results.length > 0) {
    console.log("Top optimized accuracy:", report.results[0].accuracy_pct);
    console.log("Top optimized trades:", report.results[0].total_trades);
    console.log("Top optimized rule:", report.results[0].selected_conditions_text);
  }

  return inputObject;
}

export async function runTargetLabelingPipeline(inputObject, configObject) {
  let validationReport = null;
  let savedFilePath = "";

  await loadActiveSymbolData(inputObject, configObject);
  validateMinimumRows(inputObject, configObject);
  applyConfiguredDerivatives(inputObject, configObject);
  applyTargetEntryExitLabels(inputObject, configObject);
  applyBaseEntryMining(inputObject, configObject);
  applyConfiguredStrategies(inputObject, configObject);
  applyMissMining(inputObject, configObject);
  applyHitCaseMining(inputObject, configObject);
  applyStrategyOptimization(inputObject, configObject);
  validationReport = validateActiveDataFrame(inputObject, configObject);

  if (!validationReport.is_valid) {
    throw new Error("Dataframe validation failed. First error: " + validationReport.errors[0]);
  }

  savedFilePath = await saveActiveDataFrame(inputObject, configObject);
  await saveBaseEntryCandidates(inputObject, configObject);
  await saveBaseEntryReport(inputObject, configObject);
  await saveStrategyTrades(inputObject, configObject);
  await saveStrategyReport(inputObject, configObject);
  await saveMissMiningCandidates(inputObject, configObject);
  await saveMissMiningReport(inputObject, configObject);
  await saveHitCaseCandidates(inputObject, configObject);
  await saveHitCaseReport(inputObject, configObject);
  await saveStrategyOptimizationCandidates(inputObject, configObject);
  await saveStrategyOptimizationReport(inputObject, configObject);
  logActiveDataFrameSummary(inputObject, configObject);
  logBaseEntryMiningReport(inputObject);
  logStrategyReport(inputObject);
  logMissMiningReport(inputObject);
  logHitCaseMiningReport(inputObject);
  logStrategyOptimizationReport(inputObject);
  console.log("Saved file:", savedFilePath);
  console.log("Saved base entry candidates:", inputObject.saved_base_entry_candidates_file_path);
  console.log("Saved base entry report:", inputObject.saved_base_entry_report_file_path);
  console.log("Saved trades:", inputObject.saved_trades_file_path);
  console.log("Saved strategy report:", inputObject.saved_strategy_report_file_path);
  console.log("Saved miss candidates:", inputObject.saved_miss_candidates_file_path);
  console.log("Saved miss report:", inputObject.saved_miss_report_file_path);
  console.log("Saved hit case candidates:", inputObject.saved_hit_case_candidates_file_path);
  console.log("Saved hit case report:", inputObject.saved_hit_case_report_file_path);
  console.log("Saved optimization candidates:", inputObject.saved_strategy_optimization_candidates_file_path);
  console.log("Saved optimization report:", inputObject.saved_strategy_optimization_report_file_path);
  console.log("Trade count:", inputObject.strategy_trades.length);

  return inputObject;
}

export {
  positive_0_1,
  positive_1_3,
  positive_3_5,
  positive_5_8,
  positive_8_13,
  positive_13_16,
  positive_16_21,
  negative_0_1,
  negative_1_3,
  negative_3_5,
  negative_5_8,
  negative_8_13,
  negative_13_16,
  negative_16_21,
  changeBracketSymbols,
};
