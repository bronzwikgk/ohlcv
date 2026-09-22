"use strict";

class ohlcv_condition_group_builder {
  constructor(config) {
    this.config = config;
  }

  build() {
    var roles = [];
    var role_defs = this.config.role_definitions || [];

    for (var role_index = 0; role_index < role_defs.length; role_index += 1) {
      var role = role_defs[role_index];
      if (role.enabled === false) continue;
      if (!this.role_is_active(role.role)) continue;
      roles.push({ role: role.role, order: role.order, ranking: this.ranking_for_role(role.role), condition_groups: this.groups_for_role(role) });
    }

    roles.sort(function compare(left, right) { return Number(left.order) - Number(right.order); });
    return { target_returns: this.mining_target_config(), roles: roles };
  }

  role_is_active(role) {
    var active_roles = this.config.project.active_roles || [];
    if (!active_roles.length) return true;
    for (var index = 0; index < active_roles.length; index += 1) if (active_roles[index] === role) return true;
    return false;
  }

  mining_target_config() {
    var target = this.config.target_returns;
    var mining = this.config.mining || {};
    return {
      output_prefix: target.output_prefix,
      periods: mining.target_periods || target.periods,
      thresholds_pct: mining.target_thresholds_pct || target.thresholds_pct
    };
  }

  groups_for_role(role) {
    var groups = [];
    for (var family_index = 0; family_index < role.allowed_families.length; family_index += 1) {
      var family = this.find_family(role.allowed_families[family_index]);
      if (!family || family.enabled === false) continue;
      for (var type_index = 0; type_index < role.allowed_condition_types.length; type_index += 1) {
        var type_name = role.allowed_condition_types[type_index];
        var type_config = this.config.condition_type_library[type_name];
        if (!type_config || type_config.enabled === false) continue;
        groups.push({ role: role.role, family: family.family, condition_type: type_name, ranking: this.ranking_for_role(role.role), instructions: this.instructions(role, family, type_name, type_config) });
      }
    }
    return groups;
  }

  instructions(role, family, type_name, type_config) {
    if (type_name === "threshold_compare") return this.threshold_instructions(role, family, type_config);
    if (type_name === "relative_pair_compare") return this.pair_instructions(role, family, type_config);
    if (type_name === "range" || type_name === "avoid_range") return this.range_instructions(role, family, type_name, type_config);
    return [];
  }

  threshold_instructions(role, family, type_config) {
    var columns = this.columns_for_family(role, family);
    var out = [];
    for (var column_index = 0; column_index < columns.length; column_index += 1) {
      for (var operator_index = 0; operator_index < type_config.operators.length; operator_index += 1) {
        out.push({ type: "threshold_compare", column: columns[column_index], operator: type_config.operators[operator_index], candidate_values: type_config.candidate_values || [], derive_from_data: type_config.derive_from_data === true, percentile_cutpoints: type_config.percentile_cutpoints || [], expression: columns[column_index] + " " + type_config.operators[operator_index] + " mined threshold" });
      }
    }
    return out;
  }

  pair_instructions(role, family, type_config) {
    var pairs = this.pairs_for_family(role, family);
    var out = [];
    for (var pair_index = 0; pair_index < pairs.length; pair_index += 1) {
      for (var operator_index = 0; operator_index < type_config.operators.length; operator_index += 1) {
        out.push({ type: "relative_pair_compare", left_column: pairs[pair_index].left_column, right_column: pairs[pair_index].right_column, operator: type_config.operators[operator_index], expression: pairs[pair_index].left_column + " " + type_config.operators[operator_index] + " " + pairs[pair_index].right_column });
      }
    }
    return out;
  }

  range_instructions(role, family, type_name, type_config) {
    var columns = this.columns_for_family(role, family);
    var out = [];
    for (var column_index = 0; column_index < columns.length; column_index += 1) {
      out.push({ type: type_name, column: columns[column_index], percentile_cutpoints: type_config.percentile_cutpoints, max_bin_span: type_config.max_bin_span, expression: columns[column_index] + " between mined lower and upper range" });
    }
    return out;
  }

  find_family(name) {
    var lists = [this.config.feature_registry.first_order_derivatives || [], this.config.feature_registry.second_order_derivatives || []];
    for (var list_index = 0; list_index < lists.length; list_index += 1) {
      for (var index = 0; index < lists[list_index].length; index += 1) if (lists[list_index][index].family === name) return lists[list_index][index];
    }
    return null;
  }

  columns_for_family(role, family) {
    var out = [];
    if (family.lookbacks) {
      for (var index = 0; index < family.lookbacks.length; index += 1) if (this.allowed(family.lookbacks[index], role.allowed_lookbacks)) out.push(family.output_prefix + "_" + family.lookbacks[index] + "_day");
    }
    if (out.length === 0 && family.comparison_pairs) {
      var pairs = this.pairs_for_family(role, family);
      for (var pair_index = 0; pair_index < pairs.length; pair_index += 1) out.push(pairs[pair_index].output_column);
    }
    return out;
  }

  pairs_for_family(role, family) {
    var out = [];
    var pairs = family.comparison_pairs || [];
    for (var index = 0; index < pairs.length; index += 1) {
      var left = pairs[index].left_lookback !== undefined ? pairs[index].left_lookback : pairs[index].numerator_lookback;
      var right = pairs[index].right_lookback !== undefined ? pairs[index].right_lookback : pairs[index].denominator_lookback;
      if (!this.allowed(left, role.allowed_lookbacks) || !this.allowed(right, role.allowed_lookbacks)) continue;
      out.push({ left_column: (family.left_output_prefix || family.numerator_output_prefix) + "_" + left + "_day", right_column: (family.right_output_prefix || family.denominator_output_prefix) + "_" + right + "_day", output_column: family.output_prefix + "_" + left + "_day_vs_" + right + "_day" });
    }
    return out;
  }

  ranking_for_role(role) {
    var defaults = this.config.mining.ranking_defaults;
    var override = this.config.mining.role_overrides[role] || {};
    var out = {};
    var keys = Object.keys(defaults);
    for (var index = 0; index < keys.length; index += 1) out[keys[index]] = defaults[keys[index]];
    keys = Object.keys(override);
    for (index = 0; index < keys.length; index += 1) out[keys[index]] = override[keys[index]];
    return out;
  }

  allowed(value, allowed_values) {
    for (var index = 0; index < allowed_values.length; index += 1) if (Number(value) === Number(allowed_values[index])) return true;
    return false;
  }
}

class ohlcv_role_miner {
  constructor(config) { this.config = config; }

  mine(built, mining_collection, testing_collection) {
    var full_mining_rows = this.flatten_without_base_conditions(mining_collection);
    var full_testing_rows = this.flatten_without_base_conditions(testing_collection);
    var mining_rows = this.apply_base_conditions(full_mining_rows);
    var testing_rows = this.apply_base_conditions(full_testing_rows);
    var roles = [];
    for (var role_index = 0; role_index < built.roles.length; role_index += 1) roles.push(this.mine_role(built.roles[role_index], mining_rows, testing_rows, built.target_returns));
    return {
      full_mining_row_count: full_mining_rows.length,
      full_testing_row_count: full_testing_rows.length,
      mining_row_count: mining_rows.length,
      testing_row_count: testing_rows.length,
      base_condition_funnel: this.base_condition_funnel(full_mining_rows, full_testing_rows, built.target_returns),
      baseline: this.baseline_results(mining_rows, testing_rows, built.target_returns),
      roles: roles
    };
  }

  base_condition_funnel(full_mining_rows, full_testing_rows, target) {
    var base = this.config.base_conditions || {};
    var conditions = base.enabled ? (base.conditions || []) : [];
    var out = [];
    var mining_rows = full_mining_rows.slice(0);
    var testing_rows = full_testing_rows.slice(0);
    out.push(this.base_condition_funnel_row("Full data after anomaly filters", "", mining_rows, testing_rows, target, full_mining_rows.length, full_testing_rows.length));

    for (var condition_index = 0; condition_index < conditions.length; condition_index += 1) {
      mining_rows = this.filter_rows_by_condition(mining_rows, conditions[condition_index]);
      testing_rows = this.filter_rows_by_condition(testing_rows, conditions[condition_index]);
      out.push(this.base_condition_funnel_row("After base " + (condition_index + 1), this.condition_expression(conditions[condition_index]), mining_rows, testing_rows, target, full_mining_rows.length, full_testing_rows.length));
    }

    return out;
  }

  base_condition_funnel_row(label, expression, mining_rows, testing_rows, target, full_mining_count, full_testing_count) {
    return {
      label: label,
      expression: expression,
      training_rows: mining_rows.length,
      testing_rows: testing_rows.length,
      training_row_coverage_pct: this.percent(mining_rows.length, full_mining_count),
      testing_row_coverage_pct: this.percent(testing_rows.length, full_testing_count),
      targets: this.baseline_results(mining_rows, testing_rows, target)
    };
  }

  filter_rows_by_condition(rows, condition) {
    var output = [];
    for (var index = 0; index < rows.length; index += 1) {
      if (this.matches(rows[index], condition)) output.push(rows[index]);
    }
    return output;
  }

  condition_expression(condition) {
    if (condition.expression) return condition.expression;
    if (condition.type === "relative_pair_compare") return condition.left_column + " " + condition.operator + " " + condition.right_column;
    if (condition.type === "threshold_compare") return condition.column + " " + condition.operator + " " + condition.right_value;
    if (condition.type === "range" || condition.type === "avoid_range") return condition.column + " between " + condition.min_value + " and " + condition.max_value;
    return "";
  }

  baseline_results(mining_rows, testing_rows, target) {
    var out = [];
    for (var period_index = 0; period_index < target.periods.length; period_index += 1) {
      var target_period = target.periods[period_index];
      var target_column = target.output_prefix + "_" + target_period + "_day";
      for (var threshold_index = 0; threshold_index < target.thresholds_pct.length; threshold_index += 1) {
        var threshold = target.thresholds_pct[threshold_index];
        var training = this.baseline_score(mining_rows, target_column, threshold);
        var testing = this.baseline_score(testing_rows, target_column, threshold);
        out.push({
          target_period: target_period,
          target_threshold_pct: threshold,
          training_density_pct: training.density_pct,
          testing_density_pct: testing.density_pct,
          training_coverage_pct: 100,
          testing_coverage_pct: 100,
          training_rows: training.rows,
          testing_rows: testing.rows,
          training_hits: training.hits,
          testing_hits: testing.hits
        });
      }
    }
    return out;
  }

  baseline_score(rows, target_column, threshold) {
    var valid_rows = 0;
    var hits = 0;
    for (var index = 0; index < rows.length; index += 1) {
      var target_value = rows[index][target_column];
      if (target_value === null || target_value === undefined) continue;
      valid_rows += 1;
      if (Number(target_value) >= Number(threshold)) hits += 1;
    }
    return { rows: valid_rows, hits: hits, density_pct: this.percent(hits, valid_rows) };
  }

  mine_role(role, mining_rows, testing_rows, target) {
    var results = [];
    for (var group_index = 0; group_index < role.condition_groups.length; group_index += 1) {
      var group = role.condition_groups[group_index];
      for (var inst_index = 0; inst_index < group.instructions.length; inst_index += 1) {
        var mined = this.mine_instruction(group, group.instructions[inst_index], mining_rows, testing_rows, target);
        for (var result_index = 0; result_index < mined.length; result_index += 1) results.push(mined[result_index]);
      }
    }
    return { role: role.role, order: role.order, results: this.rank(results, role.ranking) };
  }

  mine_instruction(group, instruction, mining_rows, testing_rows, target) {
    var out = [];
    for (var period_index = 0; period_index < target.periods.length; period_index += 1) {
      var target_period = target.periods[period_index];
      var target_column = target.output_prefix + "_" + target_period + "_day";
      for (var threshold_index = 0; threshold_index < target.thresholds_pct.length; threshold_index += 1) {
        var threshold = target.thresholds_pct[threshold_index];
        if (instruction.type === "threshold_compare") {
          var thresholds = this.threshold_results(group, instruction, mining_rows, testing_rows, target_column, target_period, threshold);
          for (var threshold_result_index = 0; threshold_result_index < thresholds.length; threshold_result_index += 1) out.push(thresholds[threshold_result_index]);
        } else if (instruction.type === "range" || instruction.type === "avoid_range") {
          var ranges = this.range_results(group, instruction, mining_rows, testing_rows, target_column, target_period, threshold);
          for (var range_index = 0; range_index < ranges.length; range_index += 1) out.push(ranges[range_index]);
        } else {
          out.push(this.result(group, instruction, target_period, threshold, this.score(mining_rows, instruction, target_column, threshold), this.score(testing_rows, instruction, target_column, threshold)));
        }
      }
    }
    return out;
  }

  threshold_results(group, instruction, mining_rows, testing_rows, target_column, target_period, threshold) {
    var values = this.threshold_values(instruction, mining_rows, target_column);
    var out = [];
    for (var value_index = 0; value_index < values.length; value_index += 1) {
      var threshold_instruction = {
        type: instruction.type,
        column: instruction.column,
        operator: instruction.operator,
        right_value: values[value_index],
        expression: instruction.column + " " + instruction.operator + " " + values[value_index]
      };
      out.push(this.result(group, threshold_instruction, target_period, threshold, this.score(mining_rows, threshold_instruction, target_column, threshold), this.score(testing_rows, threshold_instruction, target_column, threshold)));
    }
    return out;
  }

  threshold_values(instruction, mining_rows, target_column) {
    var values = [];
    var seen = {};
    this.add_candidate_values(values, seen, instruction.candidate_values || []);
    if (instruction.derive_from_data) {
      this.add_candidate_values(values, seen, this.cutpoints(this.sorted_values(mining_rows, instruction.column, target_column), instruction.percentile_cutpoints || []));
    }
    values.sort(function compare(left, right) { return Number(left) - Number(right); });
    return values;
  }

  add_candidate_values(values, seen, candidates) {
    for (var index = 0; index < candidates.length; index += 1) {
      var value = Number(candidates[index]);
      if (!Number.isFinite(value)) continue;
      value = Math.round(value * 100) / 100;
      if (seen[String(value)]) continue;
      seen[String(value)] = true;
      values.push(value);
    }
  }

  range_results(group, instruction, mining_rows, testing_rows, target_column, target_period, threshold) {
    var cutpoints = this.cutpoints(this.sorted_values(mining_rows, instruction.column, target_column), instruction.percentile_cutpoints);
    var out = [];
    for (var start = 0; start < cutpoints.length - 1; start += 1) {
      for (var end = start + 1; end < cutpoints.length && end <= start + Number(instruction.max_bin_span); end += 1) {
        var range_instruction = { type: instruction.type, column: instruction.column, min_value: cutpoints[start], max_value: cutpoints[end], expression: instruction.column + " between " + cutpoints[start] + " and " + cutpoints[end] };
        out.push(this.result(group, range_instruction, target_period, threshold, this.score(mining_rows, range_instruction, target_column, threshold), this.score(testing_rows, range_instruction, target_column, threshold)));
      }
    }
    return out;
  }

  score(rows, instruction, target_column, threshold) {
    var total_hits = 0; var matches = 0; var hits = 0;
    for (var index = 0; index < rows.length; index += 1) {
      var target_value = rows[index][target_column];
      if (target_value === null || target_value === undefined) continue;
      if (Number(target_value) >= Number(threshold)) total_hits += 1;
      if (!this.matches(rows[index], instruction)) continue;
      matches += 1;
      if (Number(target_value) >= Number(threshold)) hits += 1;
    }
    if (instruction.type === "avoid_range") return { matches: matches, hits: matches - hits, total_hits: rows.length - total_hits, density_pct: this.percent(matches - hits, matches), coverage_pct: this.percent(matches - hits, rows.length - total_hits) };
    return { matches: matches, hits: hits, total_hits: total_hits, density_pct: this.percent(hits, matches), coverage_pct: this.percent(hits, total_hits) };
  }

  matches(row, instruction) {
    if (instruction.type === "threshold_compare") return this.compare(row[instruction.column], instruction.operator, instruction.right_value);
    if (instruction.type === "relative_pair_compare") return this.compare(row[instruction.left_column], instruction.operator, row[instruction.right_column]);
    if (instruction.type === "range" || instruction.type === "avoid_range") return row[instruction.column] !== null && row[instruction.column] !== undefined && Number(row[instruction.column]) >= Number(instruction.min_value) && Number(row[instruction.column]) <= Number(instruction.max_value);
    return false;
  }

  compare(left, operator, right) {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    left = Number(left); right = Number(right);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    if (operator === "<=") return left <= right;
    return left === right;
  }

  result(group, instruction, target_period, threshold, training, testing) {
    return { role: group.role, family: group.family, condition_type: instruction.type, expression: instruction.expression, instruction: this.clone_instruction(instruction), target_period: target_period, target_threshold_pct: threshold, training_density_pct: training.density_pct, testing_density_pct: testing.density_pct, training_coverage_pct: training.coverage_pct, testing_coverage_pct: testing.coverage_pct, training_matches: training.matches, testing_matches: testing.matches, training_hits: training.hits, testing_hits: testing.hits };
  }

  clone_instruction(instruction) {
    var out = {};
    var keys = Object.keys(instruction || {});
    for (var index = 0; index < keys.length; index += 1) out[keys[index]] = instruction[keys[index]];
    return out;
  }

  rank(results, ranking) {
    var out = [];
    for (var index = 0; index < results.length; index += 1) {
      if (results[index].training_matches < Number(ranking.minimum_matching_rows)) continue;
      if (results[index].training_coverage_pct < Number(ranking.minimum_coverage_pct)) continue;
      out.push(results[index]);
    }
    out.sort(function compare(left, right) {
      if (right.training_density_pct !== left.training_density_pct) return right.training_density_pct - left.training_density_pct;
      return right.training_coverage_pct - left.training_coverage_pct;
    });
    return out.slice(0, Number(ranking.top_n));
  }

  flatten_without_base_conditions(collection) {
    var out = [];
    var stocks = Object.keys(collection || {});
    for (var stock_index = 0; stock_index < stocks.length; stock_index += 1) {
      var rows = collection[stocks[stock_index]];
      for (var row_index = 0; row_index < rows.length; row_index += 1) if (rows[row_index].__exclude_from_mining !== true) out.push(rows[row_index]);
    }
    return out;
  }

  flatten(collection) {
    return this.apply_base_conditions(this.flatten_without_base_conditions(collection));
  }

  apply_base_conditions(rows) {
    var out = [];
    for (var index = 0; index < rows.length; index += 1) if (this.row_passes_base_conditions(rows[index])) out.push(rows[index]);
    return out;
  }

  row_passes_base_conditions(row) {
    var base = this.config.base_conditions || {};
    if (!base.enabled) return true;
    return this.conditions_pass(row, base.conditions || [], base.operator || "AND");
  }

  conditions_pass(row, conditions, operator) {
    if (!conditions || conditions.length === 0) return operator === "AND";
    for (var index = 0; index < conditions.length; index += 1) {
      var passed = this.matches(row, conditions[index]);
      if (operator === "AND" && !passed) return false;
      if (operator === "OR" && passed) return true;
    }
    return operator === "AND";
  }

  sorted_values(rows, column, target_column) {
    var out = [];
    for (var index = 0; index < rows.length; index += 1) if (rows[index][target_column] !== null && rows[index][target_column] !== undefined && rows[index][column] !== null && rows[index][column] !== undefined) out.push(Number(rows[index][column]));
    out.sort(function compare(left, right) { return left - right; });
    return out;
  }

  cutpoints(values, percentiles) {
    var out = []; var seen = {};
    for (var index = 0; index < percentiles.length; index += 1) {
      var value = this.percentile(values, percentiles[index]);
      if (value === null) continue;
      value = Math.round(value * 100) / 100;
      if (seen[String(value)]) continue;
      seen[String(value)] = true; out.push(value);
    }
    return out;
  }

  percentile(values, pct) {
    if (!values.length) return null;
    var index = Math.round((Number(pct) / 100) * (values.length - 1));
    return values[index];
  }

  percent(a, b) { return b ? (Number(a) / Number(b)) * 100 : 0; }
}

class ohlcv_condition_selector {
  constructor(config) { this.config = config; }
  select(mining_report, mining_collection) {
    var selected = { regime: [], setup: [], trigger: [], quality: [], risk_avoid: [] };
    var rows = this.flatten(mining_collection);
    var minimum_rows = Number(this.config.selected_conditions.minimum_rows_after_adding_condition);
    if (!Number.isFinite(minimum_rows) || minimum_rows < 1) minimum_rows = 25;

    for (var role_index = 0; role_index < mining_report.roles.length; role_index += 1) {
      var role = mining_report.roles[role_index];
      if (!selected[role.role]) continue;

      for (var result_index = 0; result_index < role.results.length; result_index += 1) {
        var candidate = role.results[result_index];
        var trial = this.clone_selected(selected);
        trial[role.role].push(candidate);

        if (this.count_matching_rows(rows, trial) >= minimum_rows) {
          selected[role.role].push(candidate);
          break;
        }
      }
    }

    return selected;
  }

  count_matching_rows(rows, selected) {
    var count = 0;

    for (var row_index = 0; row_index < rows.length; row_index += 1) {
      if (this.row_passes_selected(rows[row_index], selected)) {
        count += 1;
      }
    }

    return count;
  }

  row_passes_selected(row, selected) {
    if (!this.row_passes_base_conditions(row)) return false;
    if (!this.conditions_pass(row, selected.regime, "AND")) return false;
    if (!this.conditions_pass(row, selected.setup, "AND")) return false;
    if (!this.conditions_pass(row, selected.trigger, "AND")) return false;
    if (!this.conditions_pass(row, selected.quality, "AND")) return false;
    if (this.conditions_pass(row, selected.risk_avoid, "OR")) return false;
    return true;
  }

  conditions_pass(row, conditions, operator) {
    if (!conditions || conditions.length === 0) return operator === "AND";

    for (var index = 0; index < conditions.length; index += 1) {
      var passed = this.row_matches_condition(row, conditions[index]);

      if (operator === "AND" && !passed) return false;
      if (operator === "OR" && passed) return true;
    }

    return operator === "AND";
  }

  row_matches_condition(row, condition) {
    var instruction = condition.instruction || condition;
    if (instruction.type === "threshold_compare") return this.compare(row[instruction.column], instruction.operator, instruction.right_value);
    if (instruction.type === "relative_pair_compare") return this.compare(row[instruction.left_column], instruction.operator, row[instruction.right_column]);
    if (instruction.type === "range" || instruction.type === "avoid_range") return this.value_between(row[instruction.column], Number(instruction.min_value), Number(instruction.max_value));
    return false;
  }

  value_between(value, min_value, max_value) {
    if (value === null || value === undefined) return false;
    value = Number(value);
    return Number.isFinite(value) && value >= min_value && value <= max_value;
  }

  compare(left, operator, right) {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    left = Number(left);
    right = Number(right);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    if (operator === "<=") return left <= right;
    return left === right;
  }

  clone_selected(selected) {
    return {
      regime: selected.regime.slice(0),
      setup: selected.setup.slice(0),
      trigger: selected.trigger.slice(0),
      quality: selected.quality.slice(0),
      risk_avoid: selected.risk_avoid.slice(0)
    };
  }

  flatten(collection) {
    var output = [];
    var stock_names = Object.keys(collection || {});

    for (var stock_index = 0; stock_index < stock_names.length; stock_index += 1) {
      var rows = collection[stock_names[stock_index]];
      for (var row_index = 0; row_index < rows.length; row_index += 1) {
        if (rows[row_index].__exclude_from_mining !== true && this.row_passes_base_conditions(rows[row_index])) output.push(rows[row_index]);
      }
    }

    return output;
  }

  row_passes_base_conditions(row) {
    var base = this.config.base_conditions || {};
    if (!base.enabled) return true;
    return this.conditions_pass(row, base.conditions || [], base.operator || "AND");
  }
}

module.exports = { ohlcv_condition_group_builder: ohlcv_condition_group_builder, ohlcv_role_miner: ohlcv_role_miner, ohlcv_condition_selector: ohlcv_condition_selector };
