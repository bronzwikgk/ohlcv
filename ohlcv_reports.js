"use strict";

const fs = require("fs");
const path = require("path");

class ohlcv_report_writer {
  constructor(config) {
    this.config = config;
  }

  write_all(result) {
    var combined_path = this.write_html_report("combined", this.combined_html(result));
    return { combined_report_path: combined_path };
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
    return this.render_template("mining_report.html", "Role Mining Report", this.mining_body_html(result));
  }

  combined_html(result) {
    var html = "<section id=\"mining-report\"><h2>Mining</h2>";
    html += this.mining_body_html(result);
    html += "</section>";
    html += "<section id=\"backtest-report\"><h2>Backtest</h2>";
    html += this.backtest_body_html(result.backtest_report);
    html += "</section>";
    html += "<section id=\"strategy-optimization-report\"><h2>Strategy Optimization</h2>";
    html += this.strategy_optimization_html(result.strategy_report);
    html += "</section>";
    return this.render_template("combined_report.html", "OHLCV Run Report", html);
  }

  mining_body_html(result) {
    var html = "";
    html += "<p>Stocks loaded: " + result.loaded_report.total_number_of_stocks + " | Year start: " + this.escape(this.year_text(result.loaded_report.loaded_start_date)) + " | Year end: " + this.escape(this.year_text(result.loaded_report.loaded_end_date)) + " | Loaded months: " + this.format_count(result.loaded_report.loaded_total_months) + " | Full mining rows: " + this.format_count(result.mining_report.full_mining_row_count) + " | Base-filtered mining rows: " + result.mining_report.mining_row_count + " | Full testing rows: " + this.format_count(result.mining_report.full_testing_row_count) + " | Base-filtered testing rows: " + result.mining_report.testing_row_count + "</p>";
    html += this.baseline_html(result.mining_report.baseline);
    html += this.base_condition_funnel_html(result.mining_report.base_condition_funnel);
    html += this.anomaly_html(result.anomaly_report);
    html += this.role_derivatives_html(result.built_condition_groups, "regime");
    html += this.role_results_sections_html(result.mining_report);
    return html;
  }

  role_results_sections_html(mining_report) {
    var html = "";
    var role_names = this.configured_role_names();
    for (var index = 0; index < role_names.length; index += 1) {
      html += this.role_results_html(role_names[index], this.find_mined_role(mining_report, role_names[index]));
    }
    return html;
  }

  role_results_html(role_name, role) {
    var html = "<details open><summary>" + this.escape(role_name) + "</summary><div class=\"table-scroll\"><table class=\"wide-table\"><thead><tr><th>Rank</th><th>Testing Density %</th><th>Testing Coverage %</th><th>Training Density %</th><th>Training Coverage %</th><th>Family</th><th>Type</th><th>Expression</th></tr></thead><tbody>";
    if (!role) {
      html += "<tr><td colspan=\"8\">Role not mined in this run.</td></tr>";
    } else if (!role.results || !role.results.length) {
      html += "<tr><td colspan=\"8\">No ranked conditions passed filters.</td></tr>";
    } else {
      for (var row_index = 0; row_index < role.results.length; row_index += 1) {
        var row = role.results[row_index];
        html += "<tr><td class=\"number\">" + (row_index + 1) + "</td><td class=\"number\">" + row.testing_density_pct.toFixed(2) + "</td><td class=\"number\">" + row.testing_coverage_pct.toFixed(2) + "</td><td class=\"number\">" + row.training_density_pct.toFixed(2) + "</td><td class=\"number\">" + row.training_coverage_pct.toFixed(2) + "</td><td>" + this.escape(row.family) + "</td><td>" + this.escape(row.condition_type) + "</td><td class=\"expression\">" + this.escape(row.expression) + "</td></tr>";
      }
    }
    html += "</tbody></table></div></details>";
    return html;
  }

  configured_role_names() {
    var roles = this.config.role_definitions || [];
    var out = [];
    for (var index = 0; index < roles.length; index += 1) out.push(roles[index].role);
    return out;
  }

  find_mined_role(mining_report, role_name) {
    var roles = mining_report.roles || [];
    for (var index = 0; index < roles.length; index += 1) if (roles[index].role === role_name) return roles[index];
    return null;
  }

  baseline_html(baseline) {
    if (!baseline || !baseline.length) return "";
    var html = "<details open><summary>Baseline Target Metrics</summary><table class=\"compact-table\"><thead><tr><th>Target</th><th>Training Density %</th><th>Testing Density %</th><th>Training Coverage %</th><th>Testing Coverage %</th><th>Training Hits / Rows</th><th>Testing Hits / Rows</th></tr></thead><tbody>";
    for (var index = 0; index < baseline.length; index += 1) {
      var row = baseline[index];
      html += "<tr><td>" + this.escape(row.target_period + " day >= " + row.target_threshold_pct + "%") + "</td><td class=\"number\">" + this.format(row.training_density_pct) + "</td><td class=\"number\">" + this.format(row.testing_density_pct) + "</td><td class=\"number\">" + this.format(row.training_coverage_pct) + "</td><td class=\"number\">" + this.format(row.testing_coverage_pct) + "</td><td class=\"number\">" + this.escape(row.training_hits + " / " + row.training_rows) + "</td><td class=\"number\">" + this.escape(row.testing_hits + " / " + row.testing_rows) + "</td></tr>";
    }
    html += "</tbody></table></details>";
    return html;
  }

  base_condition_funnel_html(funnel) {
    if (!funnel || !funnel.length) return "";
    var html = "<details open><summary>Base Condition Funnel</summary><table class=\"compact-table\"><thead><tr><th>Step</th><th>Condition</th><th>Training Rows</th><th>Testing Rows</th><th>Training Row Coverage %</th><th>Testing Row Coverage %</th><th>Training Target Density %</th><th>Testing Target Density %</th><th>Training Hits / Rows</th><th>Testing Hits / Rows</th></tr></thead><tbody>";
    for (var index = 0; index < funnel.length; index += 1) {
      var row = funnel[index];
      var target = row.targets && row.targets.length ? row.targets[0] : {};
      html += "<tr><td>" + this.escape(row.label) + "</td><td class=\"expression\">" + this.escape(row.expression || "") + "</td><td class=\"number\">" + this.format_count(row.training_rows) + "</td><td class=\"number\">" + this.format_count(row.testing_rows) + "</td><td class=\"number\">" + this.format(row.training_row_coverage_pct) + "</td><td class=\"number\">" + this.format(row.testing_row_coverage_pct) + "</td><td class=\"number\">" + this.format(target.training_density_pct) + "</td><td class=\"number\">" + this.format(target.testing_density_pct) + "</td><td class=\"number\">" + this.escape(this.hit_text(target.training_hits, target.training_rows)) + "</td><td class=\"number\">" + this.escape(this.hit_text(target.testing_hits, target.testing_rows)) + "</td></tr>";
    }
    html += "</tbody></table></details>";
    return html;
  }

  hit_text(hits, rows) {
    if (hits === undefined || rows === undefined) return "";
    return hits + " / " + rows;
  }

  backtest_html(report) {
    return this.render_template("backtest_report.html", "Backtest Report", this.backtest_body_html(report));
  }

  backtest_body_html(report) {
    var html = "";
    if (!report || !report.enabled) return "<p>Backtesting disabled.</p>";
    html += "<h2>Metrics</h2><table class=\"metric-table\"><tbody>";
    var keys = Object.keys(report.metrics);
    for (var index = 0; index < keys.length; index += 1) html += "<tr><td>" + this.escape(keys[index]) + "</td><td class=\"number\">" + this.format(report.metrics[keys[index]]) + "</td></tr>";
    html += "</tbody></table>";
    html += this.strategy_recipes_html(report.recipe_reports);
    html += this.selected_conditions_html(report.selected_conditions);
    html += this.backtest_funnel_html(report.diagnostics);
    html += "<h2>Trades</h2><div class=\"table-scroll\"><table class=\"wide-table\"><thead><tr><th>Stock</th><th>Signal</th><th>Entry</th><th>Exit</th><th>Exit Reason</th><th>PnL %</th><th>Costs</th><th>Net PnL</th><th>Entry Condition Details</th></tr></thead><tbody>";
    for (index = 0; index < report.trades.length; index += 1) {
      var trade = report.trades[index];
      html += "<tr><td>" + this.escape(trade.stock) + "</td><td>" + this.escape(trade.signal_date || "") + "</td><td>" + this.escape(trade.entry_date) + "</td><td>" + this.escape(trade.exit_date) + "</td><td>" + this.escape(trade.exit_reason || "") + "</td><td class=\"number\">" + this.format(trade.pnl_pct) + "</td><td class=\"number\">" + this.format(trade.costs) + "</td><td class=\"number\">" + this.format(trade.net_pnl) + "</td><td>" + this.trade_condition_details_html(trade.condition_details) + "</td></tr>";
    }
    html += "</tbody></table></div>";
    return html;
  }

  strategy_recipes_html(recipe_reports) {
    if (!recipe_reports || !recipe_reports.length) return "";
    var html = "<details open id=\"strategy-recipe-comparison\"><summary>Strategy Recipe Comparison</summary><table class=\"compact-table\"><thead><tr><th>Recipe</th><th>Roles</th><th>Entry Rows</th><th>Total Trades</th><th>Total Return %</th><th>Win Rate %</th><th>Profit Factor</th><th>Final Equity</th></tr></thead><tbody>";
    for (var index = 0; index < recipe_reports.length; index += 1) {
      var report = recipe_reports[index];
      var metrics = report.metrics || {};
      var diagnostics = report.diagnostics || {};
      html += "<tr><td>" + this.escape(report.name) + "</td><td>" + this.escape(report.roles || "base only") + "</td><td class=\"number\">" + this.format_count(diagnostics.entry_rows) + "</td><td class=\"number\">" + this.format(metrics.total_trades) + "</td><td class=\"number\">" + this.format(metrics.total_return_pct) + "</td><td class=\"number\">" + this.format(metrics.win_rate_pct) + "</td><td class=\"number\">" + this.format(metrics.profit_factor) + "</td><td class=\"number\">" + this.format(metrics.final_equity) + "</td></tr>";
    }
    html += "</tbody></table></details>";
    return html;
  }

  strategy_optimization_html(strategy_report) {
    if (!strategy_report || !strategy_report.enabled) return "<p>Strategy optimization disabled.</p>";
    var html = "<p><strong>" + this.escape(strategy_report.strategy_name) + "</strong>: " + this.escape(strategy_report.description || "") + "</p>";
    html += "<details open><summary>Optimized Strategy Variants</summary><div class=\"table-scroll\"><table class=\"wide-table\"><thead><tr><th>Rank</th><th>Variant</th><th>Parameters</th><th>Training Density %</th><th>Testing Density %</th><th>Training Coverage %</th><th>Testing Coverage %</th><th>Training Matches</th><th>Testing Matches</th><th>Backtest Trades</th><th>Backtest Return %</th><th>Backtest Win Rate %</th><th>Profit Factor</th></tr></thead><tbody>";
    for (var index = 0; index < strategy_report.variants.length; index += 1) {
      var variant = strategy_report.variants[index];
      var metrics = variant.backtest_metrics || {};
      html += "<tr><td class=\"number\">" + (index + 1) + "</td><td>" + this.escape(variant.name) + "</td><td class=\"expression\">" + this.escape(this.parameter_text(variant.parameters)) + "</td><td class=\"number\">" + this.format(variant.training_density_pct) + "</td><td class=\"number\">" + this.format(variant.testing_density_pct) + "</td><td class=\"number\">" + this.format(variant.training_coverage_pct) + "</td><td class=\"number\">" + this.format(variant.testing_coverage_pct) + "</td><td class=\"number\">" + this.format_count(variant.training_matches) + "</td><td class=\"number\">" + this.format_count(variant.testing_matches) + "</td><td class=\"number\">" + this.format(metrics.total_trades) + "</td><td class=\"number\">" + this.format(metrics.total_return_pct) + "</td><td class=\"number\">" + this.format(metrics.win_rate_pct) + "</td><td class=\"number\">" + this.format(metrics.profit_factor) + "</td></tr>";
    }
    html += "</tbody></table></div></details>";
    return html;
  }

  parameter_text(parameters) {
    if (!parameters) return "";
    return "pullback=" + parameters.pullback_column + " [" + parameters.pullback_min + ", " + parameters.pullback_max + "], trigger daily return > " + parameters.trigger_daily_return_gt + ", max close vs SMA21=" + parameters.max_close_vs_sma21;
  }

  selected_conditions_html(selected_conditions) {
    if (!selected_conditions) return "";
    var roles = ["regime", "setup", "trigger", "quality", "risk_avoid"];
    var html = "<details open id=\"selected-strategy-conditions\"><summary>Selected Strategy Conditions</summary><table class=\"compact-table\"><thead><tr><th>Role</th><th>Family</th><th>Type</th><th>Testing Density %</th><th>Testing Coverage %</th><th>Expression</th></tr></thead><tbody>";
    var base_conditions = selected_conditions.base_conditions || [];
    if (base_conditions.length) {
      for (var base_index = 0; base_index < base_conditions.length; base_index += 1) {
        html += "<tr><td>base</td><td>" + this.escape(base_conditions[base_index].family) + "</td><td>" + this.escape(base_conditions[base_index].condition_type) + "</td><td></td><td></td><td class=\"expression\">" + this.escape(base_conditions[base_index].expression) + "</td></tr>";
      }
    }
    for (var role_index = 0; role_index < roles.length; role_index += 1) {
      var role = roles[role_index];
      var conditions = selected_conditions[role] || [];
      if (!conditions.length) {
        html += "<tr><td>" + this.escape(role) + "</td><td colspan=\"5\">No selected condition</td></tr>";
      }
      for (var condition_index = 0; condition_index < conditions.length; condition_index += 1) {
        var condition = conditions[condition_index];
        html += "<tr><td>" + this.escape(role) + "</td><td>" + this.escape(condition.family) + "</td><td>" + this.escape(condition.condition_type) + "</td><td class=\"number\">" + this.format(condition.testing_density_pct) + "</td><td class=\"number\">" + this.format(condition.testing_coverage_pct) + "</td><td class=\"expression\">" + this.escape(condition.expression) + "</td></tr>";
      }
    }
    html += "</tbody></table></details>";
    return html;
  }

  backtest_funnel_html(diagnostics) {
    if (!diagnostics || !diagnostics.funnel) return "";
    var html = "<details open id=\"why-only-these-trades\"><summary>Why Only These Trades</summary>";
    html += "<p>Rows are filtered in strategy order: regime, setup, entry, quality, then ignore filters. Remaining rows are possible entry rows before holding-period exit logic.</p>";
    html += "<table class=\"compact-table\"><thead><tr><th>Step</th><th>Remaining Rows</th><th>Removed Rows</th><th>Remaining %</th></tr></thead><tbody>";
    for (var index = 0; index < diagnostics.funnel.length; index += 1) {
      var row = diagnostics.funnel[index];
      html += "<tr><td>" + this.escape(row.label) + "</td><td class=\"number\">" + this.format(row.remaining_rows) + "</td><td class=\"number\">" + this.format(row.removed_rows) + "</td><td class=\"number\">" + this.format(row.remaining_pct) + "</td></tr>";
    }
    html += "</tbody></table></details>";
    return html;
  }

  trade_condition_details_html(details) {
    if (!details || !details.length) return "";
    var html = "<div class=\"condition-list\">";
    for (var index = 0; index < details.length; index += 1) {
      html += "<div><strong>" + this.escape(details[index].role) + "</strong>: <span class=\"expression\">" + this.escape(details[index].expression) + "</span>";
      html += this.condition_values_html(details[index].values);
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  condition_values_html(values) {
    if (!values || !values.length) return "";
    var html = "<div class=\"condition-values\">";
    for (var index = 0; index < values.length; index += 1) {
      html += this.escape(values[index].column) + "=" + this.escape(this.format(values[index].value));
      if (index < values.length - 1) html += " | ";
    }
    html += "</div>";
    return html;
  }

  anomaly_html(report) {
    if (!report) return "";
    return "<details open><summary>Anomaly Cleaning</summary><table class=\"compact-table\"><thead><tr><th>Mining Anomaly Rows</th><th>Mining Excluded Rows</th><th>Testing Anomaly Rows</th><th>Testing Excluded Rows</th></tr></thead><tbody><tr><td class=\"number\">" + report.mining.anomaly_rows + "</td><td class=\"number\">" + report.mining.rows_excluded_from_mining + "</td><td class=\"number\">" + report.testing.anomaly_rows + "</td><td class=\"number\">" + report.testing.rows_excluded_from_mining + "</td></tr></tbody></table></details>";
  }

  role_derivatives_html(built_condition_groups, role_name) {
    if (!built_condition_groups || !built_condition_groups.roles) return "";
    var role = null;
    for (var role_index = 0; role_index < built_condition_groups.roles.length; role_index += 1) {
      if (built_condition_groups.roles[role_index].role === role_name) role = built_condition_groups.roles[role_index];
    }
    if (!role) return "";

    var html = "<details open><summary>" + this.escape(this.title_case(role_name)) + " Derivatives and Created Conditions</summary>";
    html += "<div class=\"table-scroll\"><table class=\"wide-table\"><thead><tr><th>Family</th><th>Condition Type</th><th>Lookbacks / Pairs</th><th>Conditions Created</th><th>Condition List</th></tr></thead><tbody>";
    for (var group_index = 0; group_index < role.condition_groups.length; group_index += 1) {
      var group = role.condition_groups[group_index];
      html += "<tr><td>" + this.escape(group.family) + "</td><td>" + this.escape(group.condition_type) + "</td><td class=\"expression\">" + this.escape(this.lookbacks_from_instructions(group.instructions)) + "</td><td class=\"number\">" + group.instructions.length + "</td><td class=\"expression\">" + this.escape(this.instruction_list(group.instructions)) + "</td></tr>";
    }
    html += "</tbody></table></div></details>";
    return html;
  }

  lookbacks_from_instructions(instructions) {
    var seen = {};
    var out = [];
    for (var index = 0; index < instructions.length; index += 1) {
      var label = this.instruction_lookback_label(instructions[index]);
      if (!label || seen[label]) continue;
      seen[label] = true;
      out.push(label);
    }
    return out.join(", ");
  }

  instruction_lookback_label(instruction) {
    if (instruction.column) return this.lookback_label_from_column(instruction.column);
    if (instruction.left_column && instruction.right_column) return this.lookback_label_from_column(instruction.left_column) + " vs " + this.lookback_label_from_column(instruction.right_column);
    return "";
  }

  lookback_label_from_column(column) {
    var matches = String(column).match(/_(\d+)_day/g);
    if (!matches || !matches.length) return column;
    var out = [];
    for (var index = 0; index < matches.length; index += 1) out.push(matches[index].replace(/_/g, "").replace("day", " day"));
    return out.join(" vs ");
  }

  instruction_list(instructions) {
    var out = [];
    for (var index = 0; index < instructions.length; index += 1) out.push(instructions[index].expression || "");
    return out.join(" | ");
  }

  title_case(value) {
    value = String(value || "").replace(/_/g, " ");
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  render_template(template_name, title, content) {
    var template = this.read_template(template_name);
    var html = template.replace(/\{\{title\}\}/g, this.escape(title));
    html = html.replace("{{style}}", this.read_template("report.css"));
    html = html.replace("{{content}}", content);
    return html;
  }

  read_template(template_name) {
    var template_path = path.join(process.cwd(), "report_templates", template_name);
    if (fs.existsSync(template_path)) return fs.readFileSync(template_path, "utf8");
    if (template_name === "report.css") return "";
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>{{title}}</title><style>{{style}}</style></head><body><h1>{{title}}</h1>{{content}}</body></html>";
  }

  pad(value, digits) {
    while (value.length < digits) value = "0" + value;
    return value;
  }

  format(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return value.toFixed(2);
    return String(value);
  }

  format_count(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  year_text(value) {
    if (value === null || value === undefined) return "";
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return String(date.getFullYear());
  }

  escape(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}

module.exports = { ohlcv_report_writer: ohlcv_report_writer };
