// Creates a standalone HTML report from strategy_summary_<timestamp>.csv.
// Usage:
//   node generate_strategy_summary_html.js <output_dir> <run_timestamp>

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function htmlEscape(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseCsv(text) {
  var rows = [];
  var row = [];
  var value = "";
  var inQuotes = false;

  for (var index = 0; index < text.length; index += 1) {
    var char = text[index];
    var nextChar = index + 1 < text.length ? text[index + 1] : "";

    if (inQuotes && char === '"' && nextChar === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === ",") {
      row.push(value);
      value = "";
    } else if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(value);
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function toObjects(table) {
  var header = table.length > 0 ? table[0] : [];
  var rows = [];

  for (var rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
    var item = {};

    for (var columnIndex = 0; columnIndex < header.length; columnIndex += 1) {
      item[header[columnIndex]] = table[rowIndex][columnIndex] || "";
    }

    rows.push(item);
  }

  return rows;
}

function fmt(value, digits) {
  var numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return "";
  }

  return numberValue.toFixed(digits);
}

function createRowsHtml(rows) {
  var html = "";

  for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    var row = rows[rowIndex];
    var ann = Number(row.avg_return_per_annum_pct || 0);
    var klass = ann >= 50 ? "strong" : ann >= 25 ? "ok" : "weak";

    html += "<tr class=\"" + klass + "\">";
    html += "<td>" + htmlEscape(row.symbol) + "</td>";
    html += "<td class=\"num\">" + htmlEscape(row.trades) + "</td>";
    html += "<td class=\"num\">" + fmt(row.accuracy_pct, 2) + "%</td>";
    html += "<td class=\"num\">" + fmt(row.total_return_pct, 2) + "%</td>";
    html += "<td class=\"num\">" + fmt(row.avg_return_per_annum_pct, 2) + "%</td>";
    html += "<td class=\"num\">" + fmt(row.max_loss_pct, 2) + "%</td>";
    html += "<td><code>" + htmlEscape(row.base_rule_text) + "</code></td>";
    html += "<td><code>" + htmlEscape(row.optimized_rule_text) + "</code></td>";
    html += "<td class=\"num\">" + fmt(row.optimized_accuracy_pct, 2) + "%</td>";
    html += "<td class=\"num\">" + fmt(row.optimized_annum_pct, 2) + "%</td>";
    html += "</tr>\n";
  }

  return html;
}

function createHtml(rows, runTimestamp, csvPath) {
  var generatedAt = new Date().toISOString();
  var rowCount = rows.length;
  var strongCount = 0;

  for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (Number(rows[rowIndex].avg_return_per_annum_pct || 0) >= 50) {
      strongCount += 1;
    }
  }

  return "<!doctype html>\n" +
    "<html><head><meta charset=\"utf-8\"><title>Strategy Summary " + htmlEscape(runTimestamp) + "</title>" +
    "<style>" +
    "body{font-family:Segoe UI,Arial,sans-serif;margin:24px;background:#f7f8fa;color:#17202a}" +
    "h1{font-size:22px;margin:0 0 8px}" +
    ".meta{color:#526070;margin-bottom:18px}" +
    ".cards{display:flex;gap:12px;margin:16px 0 20px;flex-wrap:wrap}" +
    ".card{background:white;border:1px solid #d9dee7;border-radius:8px;padding:12px 14px;min-width:150px}" +
    ".label{font-size:12px;color:#667085}.value{font-size:22px;font-weight:700;margin-top:4px}" +
    "table{border-collapse:collapse;width:100%;background:white;border:1px solid #d9dee7}" +
    "th{position:sticky;top:0;background:#1f2937;color:white;text-align:left;font-size:12px;padding:9px}" +
    "td{border-top:1px solid #e5e7eb;padding:8px;vertical-align:top;font-size:13px}" +
    "td.num{text-align:right;white-space:nowrap}" +
    "code{white-space:pre-wrap;font-family:Consolas,monospace;font-size:12px}" +
    "tr.strong{background:#f0fdf4}tr.ok{background:#fffbeb}tr.weak{background:#fff}" +
    ".note{margin-top:14px;color:#667085;font-size:12px}" +
    "</style></head><body>" +
    "<h1>High Occurrence Strategy Summary</h1>" +
    "<div class=\"meta\">Run timestamp: <code>" + htmlEscape(runTimestamp) + "</code><br>CSV: <code>" + htmlEscape(csvPath) + "</code><br>Generated: " + htmlEscape(generatedAt) + "</div>" +
    "<div class=\"cards\"><div class=\"card\"><div class=\"label\">Completed Symbols</div><div class=\"value\">" + String(rowCount) + "</div></div>" +
    "<div class=\"card\"><div class=\"label\">Ann >= 50%</div><div class=\"value\">" + String(strongCount) + "</div></div></div>" +
    "<table><thead><tr>" +
    "<th>Symbol</th><th>Trades</th><th>Acc</th><th>Total Ret</th><th>Ann</th><th>Max Loss</th><th>Base Rule Used</th><th>Top Optimized Add-on</th><th>Opt Acc</th><th>Opt Ann</th>" +
    "</tr></thead><tbody>" + createRowsHtml(rows) + "</tbody></table>" +
    "<div class=\"note\">Rows are sorted by annual return in the source summary. Green rows have annual return >= 50%; yellow rows >= 25%.</div>" +
    "</body></html>";
}

async function main() {
  var outputDir = process.argv[2] || "E:/archieve/july_2026/minor_gk/output_high_occurrence_reproduce";
  var runTimestamp = process.argv[3] || "";
  var csvPath = path.join(outputDir, "strategy_summary_" + runTimestamp + ".csv");
  var htmlPath = path.join(outputDir, "strategy_summary_" + runTimestamp + ".html");
  var csvText = await readFile(csvPath, "utf8");
  var rows = toObjects(parseCsv(csvText));
  var html = createHtml(rows, runTimestamp, csvPath);

  await writeFile(htmlPath, html, "utf8");
  console.log("Saved HTML summary:", htmlPath);
  console.log("Rows:", rows.length);
}

main().catch(function(error) {
  console.error(error);
  process.exit(1);
});
