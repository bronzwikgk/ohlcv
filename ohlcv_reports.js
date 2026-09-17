"use strict";

const fs = require("fs");
const path = require("path");

class ohlcv_report_writer {
  constructor(config) {
    this.config = config;
  }

  write_all(result) {
    var mining_path = this.write_html_report("mining", this.mining_html(result));
    var backtest_path = this.write_html_report("backtest", this.backtest_html(result.backtest_report));
    return { mining_report_path: mining_path, backtest_report_path: backtest_path };
  }

  write_html_report(report_name, html) {
    var report_config = this.config.reporting.reports[report_name];
    if (!report_config || !report_config.enabled) return null;
    var output_dir = path.resolve(process.cwd(), this.config.reporting.output_dir);
    fs.mkdirSync(output_dir, { recursive: true });
    var file_name = this.next_file_name(output_dir, report_config.file_prefix, report_config.file_extension, this.config.reporting.report_indexing.index_digits);
    var output_path = path.join(output_dir, file_name);
    fs.writeFileSync(output_path, html, "utf8");
    if (this.config.reporting.report_indexing.latest_alias_enabled) {
      fs.writeFileSync(path.join(output_dir, report_config.file_prefix + "_latest." + report_config.file_extension), html, "utf8");
    }
    return output_path;
  }

  next_file_name(output_dir, prefix, extension, digits) {
    var next = 1;
    var pattern = new RegExp("^" + prefix + "_(\\d+)\\." + extension + "$");
    if (fs.existsSync(output_dir)) {
      var names = fs.readdirSync(output_dir);
      for (var index = 0; index < names.length; index += 1) {
        var match = names[index].match(pattern);
        if (match && Number(match[1]) >= next) next = Number(match[1]) + 1;
      }
    }
    return prefix + "_" + this.pad(String(next), digits) + "." + extension;
  }

  mining_html(result) {
    var html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Role Mining Report</title>" + this.style() + "</head><body>";
    html += "<h1>Role Mining Report</h1>";
    html += "<p>Stocks loaded: " + result.loaded_report.total_number_of_stocks + " | Mining rows: " + result.mining_report.mining_row_count + " | Testing rows: " + result.mining_report.testing_row_count + "</p>";
    html += this.anomaly_html(result.anomaly_report);
    for (var role_index = 0; role_index < result.mining_report.roles.length; role_index += 1) {
      var role = result.mining_report.roles[role_index];
      html += "<details open><summary>" + this.escape(role.role) + "</summary><table><thead><tr><th>Rank</th><th>Testing Density %</th><th>Testing Coverage %</th><th>Training Density %</th><th>Training Coverage %</th><th>Family</th><th>Type</th><th>Expression</th></tr></thead><tbody>";
      for (var row_index = 0; row_index < role.results.length; row_index += 1) {
        var row = role.results[row_index];
        html += "<tr><td class=\"number\">" + (row_index + 1) + "</td><td class=\"number\">" + row.testing_density_pct.toFixed(2) + "</td><td class=\"number\">" + row.testing_coverage_pct.toFixed(2) + "</td><td class=\"number\">" + row.training_density_pct.toFixed(2) + "</td><td class=\"number\">" + row.training_coverage_pct.toFixed(2) + "</td><td>" + this.escape(row.family) + "</td><td>" + this.escape(row.condition_type) + "</td><td class=\"expression\">" + this.escape(row.expression) + "</td></tr>";
      }
      html += "</tbody></table></details>";
    }
    html += "</body></html>";
    return html;
  }

  backtest_html(report) {
    var html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Backtest Report</title>" + this.style() + "</head><body><h1>Backtest Report</h1>";
    if (!report || !report.enabled) return html + "<p>Backtesting disabled.</p></body></html>";
    html += "<h2>Metrics</h2><table><tbody>";
    var keys = Object.keys(report.metrics);
    for (var index = 0; index < keys.length; index += 1) html += "<tr><td>" + this.escape(keys[index]) + "</td><td class=\"number\">" + this.format(report.metrics[keys[index]]) + "</td></tr>";
    html += "</tbody></table><h2>Trades</h2><table><thead><tr><th>Stock</th><th>Entry</th><th>Exit</th><th>PnL %</th><th>Net PnL</th></tr></thead><tbody>";
    for (index = 0; index < report.trades.length; index += 1) {
      var trade = report.trades[index];
      html += "<tr><td>" + this.escape(trade.stock) + "</td><td>" + this.escape(trade.entry_date) + "</td><td>" + this.escape(trade.exit_date) + "</td><td class=\"number\">" + this.format(trade.pnl_pct) + "</td><td class=\"number\">" + this.format(trade.net_pnl) + "</td></tr>";
    }
    html += "</tbody></table></body></html>";
    return html;
  }

  anomaly_html(report) {
    if (!report) return "";
    return "<details open><summary>Anomaly Cleaning</summary><table><tbody><tr><td>Mining anomaly rows</td><td class=\"number\">" + report.mining.anomaly_rows + "</td></tr><tr><td>Mining excluded rows</td><td class=\"number\">" + report.mining.rows_excluded_from_mining + "</td></tr><tr><td>Testing anomaly rows</td><td class=\"number\">" + report.testing.anomaly_rows + "</td></tr><tr><td>Testing excluded rows</td><td class=\"number\">" + report.testing.rows_excluded_from_mining + "</td></tr></tbody></table></details>";
  }

  style() {
    return "<style>body{font-family:Arial,sans-serif;margin:24px;background:#f7f7f7;color:#222;}details{background:#fff;border:1px solid #ddd;border-radius:6px;margin:12px 0;}summary{padding:12px;background:#eee;font-weight:bold;}table{width:100%;border-collapse:collapse;background:#fff;font-size:13px;}td,th{border-top:1px solid #e5e5e5;padding:8px;text-align:left;}.number{text-align:right;}.expression{font-family:Consolas,monospace;font-size:12px;}</style>";
  }

  pad(value, digits) {
    while (value.length < digits) value = "0" + value;
    return value;
  }

  format(value) {
    if (typeof value === "number") return value.toFixed(2);
    return String(value);
  }

  escape(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}

module.exports = { ohlcv_report_writer: ohlcv_report_writer };
