// Reproduces the high-occurrence July flow from the occurrence report.
// Source universe: positive 3_5 rows sorted by pct/count/valid_rows.

import {
  addEmaFlatnessDerivatives,
  createMinerConfig,
  createMinerInput,
  default_derivatives,
  default_target,
  runTargetLabelingPipeline,
  selected_ema_flatness_columns,
} from "./miner_gk.js";
import { readFile } from "node:fs/promises";
import { createRunTimestamp, parseCsvToArray } from "./utility.js";
import {
  createCommonBacktestComparison,
  mineCommonRules,
  saveCommonBacktestComparison,
  saveCommonBacktestComparisonCsv,
  saveCommonRuleCandidates,
  saveCommonRuleMiningReport,
} from "./common_rule_miner.js";

var occurrenceReportPath = "E:/archieve/july_2026/miner_signal_notebook/occurrence_reports/cached_mean_oc_change_brackets_bracket_long.csv";
var dataPath = "E:/archieve/july_2026/miner_signal_notebook/derivative_cache";
var outputPath = "E:/archieve/july_2026/minor_gk/output_high_occurrence_reproduce";
var runTimestamp = createRunTimestamp();
var occurrenceDirection = "positive";
var occurrenceBracket = "3_5";
var maxSymbols = 50;
var minimumValidRows = 800;

var expectedAccuracyThreshold = 0.75;
var expectedAnnualReturnThresholdPct = 25;
var minimumCount = 15;
var missMiningMinimumCount = 3;
var hitCaseMinimumCount = 2;
var hitCaseForwardRows = 1;
var hitCaseChangeThresholdPct = 5;

function getArgValue(name, fallbackValue) {
  var prefix = "--" + name + "=";

  for (var argIndex = 2; argIndex < process.argv.length; argIndex += 1) {
    var arg = process.argv[argIndex];

    if (arg.indexOf(prefix) === 0) {
      return arg.slice(prefix.length);
    }
  }

  return fallbackValue;
}

maxSymbols = Number(getArgValue("max-symbols", maxSymbols));
minimumValidRows = Number(getArgValue("minimum-valid-rows", minimumValidRows));
occurrenceDirection = getArgValue("direction", occurrenceDirection);
occurrenceBracket = getArgValue("bracket", occurrenceBracket);
occurrenceReportPath = getArgValue("occurrence-report", occurrenceReportPath);
dataPath = getArgValue("data-path", dataPath);
outputPath = getArgValue("output-path", outputPath);
runTimestamp = getArgValue("run-timestamp", runTimestamp);

var activeDerivatives = addEmaFlatnessDerivatives(
  default_derivatives,
  selected_ema_flatness_columns,
  5,
);

var activeStrategies = [
  {
    name: "mean_oc_cross_selected_ema_close_above_ema_55",
    timeframe: "daily",
    entry_price_column: "Close",
    exit_price_column: "Close",
    max_holding_days: 2,
    profit_target_pct: 999,
    stop_loss_type: "previous_low_before_entry",
    close_open_trade_on_last_row: true,
    entry_signal_column: "strategy_entry_signal",
    exit_signal_column: "strategy_exit_signal",
    position_column: "strategy_position",
    entry_rule: {
      logic: "and",
      rules: [
        {
          type: "condition",
          operator: "crossOver",
          left: {
            type: "column",
            column: "mean_open_close_daily",
            row_offset: 0,
          },
          right: {
            type: "column",
            column: "close_ema_21_daily",
            row_offset: 0,
          },
        },
        {
          type: "condition",
          operator: "greaterThan",
          left: {
            type: "column",
            column: "Close",
            row_offset: 0,
          },
          right: {
            type: "column",
            column: "close_ema_55_daily",
            row_offset: 0,
          },
        },
      ],
    },
  },
];

var activeStrategyOptimizer = {
  enabled: true,
  accuracy_threshold: expectedAccuracyThreshold,
  annual_return_threshold_pct: expectedAnnualReturnThresholdPct,
  minimum_trades: minimumCount,
  max_depth: 3,
  top_hit_candidates: 3,
  top_miss_candidates: 3,
};

var activeBaseEntryMiner = {
  enabled: true,
  use_mined_strategy_as_base: true,
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

var activeCommonRuleMiner = {
  enabled: true,
  group_name: "positive_3_5",
  minimum_symbols_passed: 3,
  minimum_per_symbol_matches: 10,
  minimum_symbol_win_rate_lift_pct: 5,
  maximum_symbol_match_share: 0.60,
  max_depth: 3,
  single_candidate_limit: 24,
  top_candidate_limit: 50,
};

function normalizeOccurrenceSymbol(symbol) {
  return String(symbol || "").replace(".NS", "").trim().toUpperCase();
}

function getHeaderIndex(header, columnName) {
  for (var columnIndex = 0; columnIndex < header.length; columnIndex += 1) {
    if (header[columnIndex] === columnName) {
      return columnIndex;
    }
  }

  return -1;
}

function sortOccurrenceRows(left, right) {
  var leftPct = Number(left.pct);
  var rightPct = Number(right.pct);
  var leftCount = Number(left.count);
  var rightCount = Number(right.count);
  var leftValidRows = Number(left.valid_rows);
  var rightValidRows = Number(right.valid_rows);

  if (rightPct !== leftPct) {
    return rightPct - leftPct;
  }

  if (rightCount !== leftCount) {
    return rightCount - leftCount;
  }

  return rightValidRows - leftValidRows;
}

async function loadSymbolsFromOccurrenceReport() {
  var csvText = await readFile(occurrenceReportPath, "utf8");
  var table = parseCsvToArray(csvText);
  var rows = [];
  var symbols = [];
  var seenSymbols = {};

  if (table.length < 2) {
    return symbols;
  }

  var header = table[0];
  var symbolIndex = getHeaderIndex(header, "symbol");
  var directionIndex = getHeaderIndex(header, "direction");
  var bracketIndex = getHeaderIndex(header, "bracket");
  var validRowsIndex = getHeaderIndex(header, "valid_rows");
  var countIndex = getHeaderIndex(header, "count");
  var pctIndex = getHeaderIndex(header, "pct");

  for (var rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
    var row = table[rowIndex];
    var validRows = Number(row[validRowsIndex]);
    var count = Number(row[countIndex]);

    if (
      row[directionIndex] === occurrenceDirection &&
      row[bracketIndex] === occurrenceBracket &&
      count > 0 &&
      validRows >= minimumValidRows
    ) {
      rows.push({
        symbol: row[symbolIndex],
        valid_rows: row[validRowsIndex],
        count: row[countIndex],
        pct: row[pctIndex],
      });
    }
  }

  rows.sort(sortOccurrenceRows);

  for (var sortedIndex = 0; sortedIndex < rows.length && symbols.length < maxSymbols; sortedIndex += 1) {
    var normalizedSymbol = normalizeOccurrenceSymbol(rows[sortedIndex].symbol);

    if (normalizedSymbol !== "" && seenSymbols[normalizedSymbol] !== true) {
      symbols.push(normalizedSymbol);
      seenSymbols[normalizedSymbol] = true;
    }
  }

  return symbols;
}

function createConfig() {
  var minerConfig = createMinerConfig(
    default_target,
    activeDerivatives,
    800,
    ["daily"],
    expectedAccuracyThreshold,
    minimumCount,
    activeStrategies,
    missMiningMinimumCount,
    hitCaseMinimumCount,
    hitCaseForwardRows,
    hitCaseChangeThresholdPct,
    activeStrategyOptimizer,
    activeBaseEntryMiner,
  );

  minerConfig.common_rule_miner = activeCommonRuleMiner;
  minerConfig.data_path = dataPath;
  minerConfig.output_path = outputPath;
  minerConfig.run_version = "high_occurrence_reproduce";
  minerConfig.run_timestamp = runTimestamp;
  minerConfig.log_summary.print_header = false;
  minerConfig.log_summary.print_first_row = false;
  minerConfig.log_summary.print_last_row = false;

  return minerConfig;
}

async function main() {
  var symbols = await loadSymbolsFromOccurrenceReport();
  var processedInputs = [];
  var skippedSymbols = [];
  var lastMinerConfig = null;

  console.log("High occurrence reproduce timestamp:", runTimestamp);
  console.log("Occurrence report:", occurrenceReportPath);
  console.log("Data path:", dataPath);
  console.log("Output path:", outputPath);
  console.log("Selected symbols:", symbols.length);
  console.log(symbols.join(", "));

  for (var symbolIndex = 0; symbolIndex < symbols.length; symbolIndex += 1) {
    var symbol = symbols[symbolIndex];
    var minerInput = createMinerInput(symbol);
    var minerConfig = createConfig();
    lastMinerConfig = minerConfig;

    console.log("Running high occurrence symbol " + String(symbolIndex + 1) + "/" + String(symbols.length) + ":", symbol);

    try {
      await runTargetLabelingPipeline(minerInput, minerConfig);
      processedInputs.push(minerInput);
    } catch (error) {
      skippedSymbols.push({
        symbol: symbol,
        reason: error.message,
      });
      console.log("Skipped symbol:", symbol);
      console.log("Skip reason:", error.message);
    }
  }

  console.log("Processed symbols:", processedInputs.length);
  console.log("Skipped symbols:", skippedSymbols.length);

  for (var skippedIndex = 0; skippedIndex < skippedSymbols.length; skippedIndex += 1) {
    console.log(skippedSymbols[skippedIndex].symbol + ": " + skippedSymbols[skippedIndex].reason);
  }

  if (activeCommonRuleMiner.enabled && lastMinerConfig !== null) {
    var commonReport = mineCommonRules(processedInputs, lastMinerConfig);
    var commonCandidatesPath = await saveCommonRuleCandidates(commonReport, lastMinerConfig);
    var commonReportPath = await saveCommonRuleMiningReport(commonReport, lastMinerConfig);
    var commonBacktestReport = createCommonBacktestComparison(processedInputs, commonReport, lastMinerConfig);
    var commonBacktestPath = await saveCommonBacktestComparison(commonBacktestReport, lastMinerConfig);
    var commonBacktestCsvPath = await saveCommonBacktestComparisonCsv(commonBacktestReport, lastMinerConfig);

    console.log("Common rule candidates:", commonReport.common_candidate_count);
    console.log("Saved common candidates:", commonCandidatesPath);
    console.log("Saved common report:", commonReportPath);
    console.log("Saved common backtest report:", commonBacktestPath);
    console.log("Saved common backtest csv:", commonBacktestCsvPath);
  }
}

main().catch(function(error) {
  console.error(error);
  process.exit(1);
});
