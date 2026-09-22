// Builds a summary CSV that includes metrics plus the strategy/rule used.
// Usage:
//   node generate_strategy_summary.js <output_dir> <run_timestamp>

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function csvEscape(value) {
  var text = value === null || value === undefined ? "" : String(value);

  if (text.indexOf('"') !== -1) {
    text = text.replace(/"/g, '""');
  }

  if (text.indexOf(",") !== -1 || text.indexOf("\n") !== -1 || text.indexOf('"') !== -1) {
    return '"' + text + '"';
  }

  return text;
}

async function readJsonIfExists(filePath) {
  try {
    var text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function getTopBaseCandidate(baseReport) {
  if (!baseReport || !Array.isArray(baseReport.top_candidates) || baseReport.top_candidates.length === 0) {
    return null;
  }

  return baseReport.top_candidates[0];
}

function getTopOptimizedCandidate(optimizationReport) {
  if (!optimizationReport || !Array.isArray(optimizationReport.top_results) || optimizationReport.top_results.length === 0) {
    return null;
  }

  return optimizationReport.top_results[0];
}

function getStrategyExitText(strategy) {
  if (!strategy) {
    return "";
  }

  return [
    "entry_price=" + String(strategy.entry_price_column || ""),
    "exit_price=" + String(strategy.exit_price_column || ""),
    "max_holding_days=" + String(strategy.max_holding_days || ""),
    "profit_target_pct=" + String(strategy.profit_target_pct || ""),
    "stop_loss_type=" + String(strategy.stop_loss_type || ""),
  ].join("; ");
}

function createSummaryRow(symbol, strategyReport, baseReport, optimizationReport, reportFileName) {
  var baseCandidate = getTopBaseCandidate(baseReport);
  var optimizedCandidate = getTopOptimizedCandidate(optimizationReport);
  var baseStrategy = baseCandidate && baseCandidate.strategy ? baseCandidate.strategy : null;

  return {
    symbol: symbol,
    trades: strategyReport ? strategyReport.total_trades : "",
    accuracy_pct: strategyReport ? strategyReport.accuracy_pct : "",
    total_return_pct: strategyReport ? strategyReport.total_return_pct : "",
    avg_return_per_trade_pct: strategyReport ? strategyReport.average_return_per_trade_pct : "",
    avg_return_per_month_pct: strategyReport ? strategyReport.avg_return_per_month_pct : "",
    avg_return_per_annum_pct: strategyReport ? strategyReport.avg_return_per_annum_pct : "",
    max_gain_pct: strategyReport ? strategyReport.max_gain_pct : "",
    max_loss_pct: strategyReport ? strategyReport.max_loss_pct : "",
    calendar_month_count: strategyReport ? strategyReport.calendar_month_count : "",
    base_strategy_name: baseStrategy ? baseStrategy.name : "",
    base_rule_id: baseCandidate ? baseCandidate.rule_id : "",
    base_rule_text: baseCandidate ? baseCandidate.rule_text : "",
    base_matched_count: baseCandidate ? baseCandidate.matched_count : "",
    base_win_rate_pct: baseCandidate ? baseCandidate.win_rate_pct : "",
    base_win_rate_lift_pct: baseCandidate ? baseCandidate.win_rate_lift_pct : "",
    strategy_exit: getStrategyExitText(baseStrategy),
    optimized_threshold_reached: optimizationReport ? optimizationReport.threshold_reached : "",
    optimized_rule_text: optimizedCandidate ? optimizedCandidate.selected_conditions_text : "",
    optimized_trades: optimizedCandidate ? optimizedCandidate.total_trades : "",
    optimized_accuracy_pct: optimizedCandidate ? optimizedCandidate.accuracy_pct : "",
    optimized_annum_pct: optimizedCandidate ? optimizedCandidate.avg_return_per_annum_pct : "",
    optimized_max_loss_pct: optimizedCandidate ? optimizedCandidate.max_loss_pct : "",
    report_file: reportFileName,
  };
}

async function main() {
  var outputDir = process.argv[2] || "E:/archieve/july_2026/minor_gk/output_high_occurrence_reproduce";
  var runTimestamp = process.argv[3] || "";
  var files = await readdir(outputDir);
  var rows = [];

  for (var fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    var fileName = files[fileIndex];
    var suffix = runTimestamp === "" ? "_strategy_report_" : "_strategy_report_" + runTimestamp + ".json";

    if (runTimestamp !== "" && !fileName.endsWith(suffix)) {
      continue;
    }

    if (runTimestamp === "" && fileName.indexOf("_strategy_report_") === -1) {
      continue;
    }

    var symbol = fileName.split("_strategy_report_")[0];
    var reportPath = path.join(outputDir, fileName);
    var strategyReport = await readJsonIfExists(reportPath);
    var baseReport = await readJsonIfExists(path.join(outputDir, symbol + "_base_entry_report_" + runTimestamp + ".json"));
    var optimizationReport = await readJsonIfExists(path.join(outputDir, symbol + "_strategy_optimization_report_" + runTimestamp + ".json"));

    rows.push(createSummaryRow(symbol, strategyReport, baseReport, optimizationReport, fileName));
  }

  rows.sort(function(left, right) {
    return Number(right.avg_return_per_annum_pct || 0) - Number(left.avg_return_per_annum_pct || 0);
  });

  var columns = [
    "symbol",
    "trades",
    "accuracy_pct",
    "total_return_pct",
    "avg_return_per_trade_pct",
    "avg_return_per_month_pct",
    "avg_return_per_annum_pct",
    "max_gain_pct",
    "max_loss_pct",
    "calendar_month_count",
    "base_strategy_name",
    "base_rule_id",
    "base_rule_text",
    "base_matched_count",
    "base_win_rate_pct",
    "base_win_rate_lift_pct",
    "strategy_exit",
    "optimized_threshold_reached",
    "optimized_rule_text",
    "optimized_trades",
    "optimized_accuracy_pct",
    "optimized_annum_pct",
    "optimized_max_loss_pct",
    "report_file",
  ];
  var csvLines = [];
  var outputName = "strategy_summary";

  if (runTimestamp !== "") {
    outputName += "_" + runTimestamp;
  }

  csvLines.push(columns.join(","));

  for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    var row = rows[rowIndex];
    var values = [];

    for (var columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      values.push(csvEscape(row[columns[columnIndex]]));
    }

    csvLines.push(values.join(","));
  }

  var outputPath = path.join(outputDir, outputName + ".csv");
  await writeFile(outputPath, csvLines.join("\n"), "utf8");
  console.log("Saved strategy summary:", outputPath);
  console.log("Rows:", rows.length);
}

main().catch(function(error) {
  console.error(error);
  process.exit(1);
});
