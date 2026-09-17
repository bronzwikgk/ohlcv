"use strict";

var ohlcv_project_config = {
  project: {
    name: "ohlcv_role_based_signal_mining",
    version: "v0.1_config_first",
    objective: "Mine role-based short-term trading conditions, validate on held-out stocks, then pass selected rules into backtesting.",
    default_run_mode: "mine",
    active_roles: ["regime", "setup", "trigger", "quality", "risk_avoid"],
    notes: [
      "Keep config as the single source of truth.",
      "Feature families are defined once in feature_registry.",
      "Roles reference feature families; they do not redefine formulas.",
      "Condition types are enabled per role to avoid duplicated search space.",
      "Backtesting consumes selected mined rules, not every mined condition."
    ]
  },

  conventions: {
    coding: ["no_foreach", "no_arrow_function", "no_shorthands"],
    naming: {
      target_returns_key: "target_returns",
      feature_family_names_are_role_meaning_based: true,
      generated_column_style: "prefix_period_day"
    }
  },

  data_loading: {
    enabled: true,
    source_dir: "D:\\0dot1_Aug_2016_master\\data\\mstock_mtf_daily_data",
    file_pattern: ".csv",
    number_of_stocks_to_load: 250,
    number_of_years_of_data: 6,
    seed: 21,
    window_end_date: "2023-12-31",
    import_columns: ["Date", "Adj Close", "Volume"],
    column_map: {
      "Date": "date",
      "Adj Close": "adj_close",
      "Volume": "volume"
    },
    cleaning: {
      remove_weekend_rows: true,
      remove_zero_volume_rows: false
    }
  },

  data_split: {
    enabled: true,
    mode: "loaded_stock_ratio",
    mining_ratio: 0.6,
    testing_ratio: 0.4,
    split_axis: "rows_per_stock",
    note: "Current v2 splitter splits each stock by date rows. Later we may add stock-level holdout."
  },

  source_columns: {
    date_column: "date",
    price_column: "adj_close",
    volume_column: "volume"
  },

  target_returns: {
    enabled: true,
    type: "future_return_pct",
    input_column: "adj_close",
    output_prefix: "target_adj_close_future_return_pct",
    periods: [1, 3, 5, 8],
    thresholds_pct: [3],
    role_usage: ["all_mining_roles", "backtest_evaluation"]
  },

  base_conditions: {
    enabled: true,
    operator: "AND",
    conditions: [
      {
        type: "relative_pair_compare",
        left_column: "adj_close",
        operator: ">",
        right_column: "adj_close_sma_21_day",
        expression: "adj_close > adj_close_sma_21_day"
      }
    ],
    rationale: "Mandatory universe filter applied before mining, selection, and backtesting."
  },

  anomaly_cleaning: {
    enabled: true,
    mode: "mark_and_exclude_from_mining",
    input_column: "adj_close",
    daily_return_column: "adj_close_daily_return_pct",
    positive_threshold_pct: 20,
    negative_threshold_pct: -20,
    exclude_from_mining_column: "__exclude_from_mining",
    anomaly_reason_column: "__anomaly_reason",
    exclude_anomaly_row: true,
    exclude_rows_before_anomaly: 5,
    exclude_rows_after_anomaly: 2,
    report: {
      enabled: true,
      include_split_summary: true,
      include_stock_summary: true
    },
    rationale: "Large one-day jumps distort both features and future-return labels. Keep raw rows, but exclude anomaly-affected rows from mining."
  },

  feature_registry: {
    first_order_derivatives: [
      {
        enabled: true,
        family: "sma",
        owner: "feature_registry",
        input_column: "adj_close",
        output_prefix: "adj_close_sma",
        lookbacks: [5, 13, 21, 55],
        description: "Simple moving average of adjusted close."
      }
    ],

    second_order_derivatives: [
      {
        enabled: true,
        family: "price_distance_from_sma_pct",
        owner: "setup",
        type: "difference_pct",
        left_column: "adj_close",
        right_family: "sma",
        right_output_prefix: "adj_close_sma",
        output_prefix: "adj_close_vs_sma_pct",
        lookbacks: [5, 13, 21, 55],
        primary_roles: ["setup", "trigger", "risk_avoid"],
        description: "Close distance from SMA. Helps identify pullback, breakout, and over-extension."
      },
      {
        enabled: true,
        family: "sma_trend_stack_gap_pct",
        owner: "regime",
        type: "pair_difference_pct",
        left_output_prefix: "adj_close_sma",
        right_output_prefix: "adj_close_sma",
        output_prefix: "adj_close_sma_vs_sma_pct",
        comparison_pairs: [
          { left_lookback: 5, right_lookback: 13 },
          { left_lookback: 5, right_lookback: 21 },
          { left_lookback: 13, right_lookback: 21 },
          { left_lookback: 13, right_lookback: 55 },
          { left_lookback: 21, right_lookback: 55 }
        ],
        primary_roles: ["regime", "setup", "trigger", "quality"],
        description: "Percent gap between fast and slow SMA. Captures trend stack, compression, and expansion."
      },
      {
        enabled: false,
        family: "sma_trend_stack_ratio",
        owner: "regime",
        type: "pair_ratio",
        numerator_output_prefix: "adj_close_sma",
        denominator_output_prefix: "adj_close_sma",
        output_prefix: "adj_close_sma_ratio",
        comparison_pairs: [
          { numerator_lookback: 5, denominator_lookback: 13 },
          { numerator_lookback: 13, denominator_lookback: 21 },
          { numerator_lookback: 21, denominator_lookback: 55 }
        ],
        primary_roles: ["regime", "setup", "quality"],
        description: "Ratio between fast and slow SMA. Disabled by default because it duplicates trend stack gap."
      },
      {
        enabled: true,
        family: "sma_momentum_pct",
        owner: "regime",
        type: "slope_pct",
        input_output_prefix: "adj_close_sma",
        output_prefix: "adj_close_sma_slope_pct",
        lookbacks: [5, 13, 21, 55],
        slope_periods: [1],
        primary_roles: ["regime", "trigger", "quality"],
        description: "One-row SMA slope. Captures trend direction and recent trend momentum."
      },
      {
        enabled: true,
        family: "sma_momentum_spread_pct",
        owner: "trigger",
        type: "pair_difference_pct",
        left_output_prefix: "adj_close_sma_slope_pct",
        right_output_prefix: "adj_close_sma_slope_pct",
        output_prefix: "adj_close_sma_slope_vs_slope_pct",
        comparison_pairs: [
          { left_lookback: 5, right_lookback: 13 },
          { left_lookback: 5, right_lookback: 21 },
          { left_lookback: 13, right_lookback: 21 },
          { left_lookback: 21, right_lookback: 55 }
        ],
        primary_roles: ["trigger", "quality"],
        description: "Short SMA momentum compared with longer SMA momentum. Captures acceleration."
      }
    ]
  },

  role_definitions: [
    {
      role: "regime",
      enabled: true,
      order: 1,
      purpose: "Broad market/stock state filter.",
      allowed_families: ["sma_trend_stack_gap_pct", "sma_momentum_pct"],
      allowed_lookbacks: [21, 55],
      allowed_condition_types: ["threshold_compare", "relative_pair_compare"],
      conflict_policy: "do_not_use_setup_trigger_or_risk_only_features"
    },
    {
      role: "setup",
      enabled: true,
      order: 2,
      purpose: "Pre-entry price structure inside selected regime.",
      run_inside_roles: ["regime"],
      allowed_families: ["price_distance_from_sma_pct", "sma_trend_stack_gap_pct"],
      allowed_lookbacks: [13, 21, 55],
      allowed_condition_types: ["range"],
      conflict_policy: "range_only_no_threshold_duplication"
    },
    {
      role: "trigger",
      enabled: true,
      order: 3,
      purpose: "Actual row-level entry timing.",
      run_inside_roles: ["regime", "setup"],
      allowed_families: ["price_distance_from_sma_pct", "sma_trend_stack_gap_pct", "sma_momentum_pct", "sma_momentum_spread_pct"],
      allowed_lookbacks: [5, 13, 21],
      allowed_condition_types: ["threshold_compare", "relative_pair_compare", "range"],
      conflict_policy: "shorter_lookbacks_only_for_entry_timing"
    },
    {
      role: "quality",
      enabled: true,
      order: 4,
      purpose: "Confirm the signal is not noisy.",
      run_inside_roles: ["regime", "setup", "trigger"],
      allowed_families: ["sma_trend_stack_gap_pct", "sma_momentum_pct"],
      allowed_lookbacks: [13, 21, 55],
      allowed_condition_types: ["range"],
      conflict_policy: "quality_filters_do_not_create_entry_by_themselves"
    },
    {
      role: "risk_avoid",
      enabled: true,
      order: 5,
      purpose: "Find conditions to exclude from trading.",
      run_inside_roles: ["regime", "setup", "trigger"],
      allowed_families: ["price_distance_from_sma_pct", "sma_trend_stack_gap_pct", "sma_momentum_pct"],
      allowed_lookbacks: [5, 13, 21, 55],
      allowed_condition_types: ["avoid_range"],
      conflict_policy: "mined_as_not_filter_only"
    }
  ],

  condition_type_library: {
    threshold_compare: {
      enabled: true,
      operators: [">"],
      candidate_values: [0],
      derive_from_data: true,
      percentile_cutpoints: [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95],
      output_kind: "fixed_expression"
    },
    relative_pair_compare: {
      enabled: true,
      operators: [">"],
      pair_source: "configured_pairs",
      output_kind: "fixed_expression"
    },
    range: {
      enabled: true,
      percentile_cutpoints: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
      max_bin_span: 3,
      output_kind: "mined_lower_upper_range"
    },
    avoid_range: {
      enabled: true,
      target_outcome: "no_target",
      percentile_cutpoints: [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
      max_bin_span: 2,
      output_kind: "not_filter_range"
    }
  },

  mining: {
    enabled: true,
    target_periods: [1],
    target_thresholds_pct: [3],
    ranking_defaults: {
      priority: "density_then_coverage",
      minimum_coverage_pct: 5,
      minimum_matching_rows: 100,
      top_n: 20
    },
    role_overrides: {
      regime: {
        minimum_coverage_pct: 5,
        minimum_matching_rows: 100,
        top_n: 20
      },
      setup: {
        minimum_coverage_pct: 3,
        minimum_matching_rows: 100,
        top_n: 20
      },
      trigger: {
        minimum_coverage_pct: 2,
        minimum_matching_rows: 50,
        top_n: 20
      },
      quality: {
        minimum_coverage_pct: 2,
        minimum_matching_rows: 50,
        top_n: 20
      },
      risk_avoid: {
        priority: "no_target_density_then_coverage",
        minimum_coverage_pct: 2,
        minimum_matching_rows: 50,
        top_n: 20
      }
    },
    conflict_free_rules: {
      derivative_family_defined_once: true,
      role_can_only_reference_existing_enabled_family: true,
      role_can_only_use_allowed_condition_types: true,
      duplicated_family_with_same_condition_type_across_same_role: "disallow",
      ratio_and_gap_duplicate_policy: "prefer_gap_disable_ratio_unless_explicitly_enabled",
      active_roles_control_pipeline_scope: true
    }
  },

  selected_conditions: {
    enabled: true,
    source: "manual_or_report_selection",
    selection_mode: "sequential_compatible_top_condition",
    minimum_rows_after_adding_condition: 25,
    baseline: [],
    setup: [],
    trigger: [],
    quality: [],
    risk_avoid: []
  },

  backtesting: {
    enabled: true,
    class_source: "code_gk_2/ohlcv_gk_backtesting.js",
    dataset: {
      source: "pipeline_result",
      split: "testing"
    },
    initial_capital: 1000000,
    position_sizing: {
      enabled: true,
      mode: "percent_of_capital",
      value: 25
    },
    risk: {
      maximum_open_positions: 10,
      allow_multiple_entries_same_stock: false,
      maximum_allocation_per_stock_pct: 100
    },
    holding: {
      enforce_max_holding_days: true,
      max_holding_days: 5,
      day_bar_column: "date"
    },
    strategy_recipes: [
      { name: "base_only", roles: [] },
      { name: "base_plus_regime", roles: ["regime"] },
      { name: "base_plus_regime_setup", roles: ["regime", "setup"] },
      { name: "base_plus_regime_trigger", roles: ["regime", "trigger"] },
      { name: "base_plus_regime_setup_trigger", roles: ["regime", "setup", "trigger"] },
      { name: "base_plus_regime_setup_trigger_quality", roles: ["regime", "setup", "trigger", "quality"] },
      { name: "full_stack", roles: ["regime", "setup", "trigger", "quality", "risk_avoid"] }
    ],
    execution: {
      slippage: {
        enabled: true,
        mode: "bps",
        value: 10
      },
      broker_fees: {
        enabled: true,
        mode: "percent_per_side",
        value: 0.0005
      },
      taxes: {
        enabled: true,
        mode: "percent",
        buy_value: 0,
        sell_value: 0.0001
      },
      per_trade_minimum_cost: 0
    },
    rule_sets: {
      regime_rule_set: {
        enabled: true,
        operator: "AND",
        selected_condition_source: "selected_conditions.baseline"
      },
      setup_rule_set: {
        enabled: true,
        operator: "AND",
        selected_condition_source: "selected_conditions.setup"
      },
      entry_rule_set: {
        enabled: true,
        operator: "AND",
        selected_condition_source: "selected_conditions.trigger"
      },
      quality_rule_set: {
        enabled: true,
        operator: "AND",
        selected_condition_source: "selected_conditions.quality"
      },
      risk_avoid_rule_set: {
        enabled: true,
        operator: "OR",
        selected_condition_source: "selected_conditions.risk_avoid",
        apply_as: "NOT"
      },
      exit_rule_set: {
        enabled: false,
        operator: "OR",
        conditions: []
      },
      stop_loss_set: {
        enabled: true,
        fixed_percent_loss: {
          enabled: true,
          value: 1.5
        },
        trailing_percent: {
          enabled: true,
          trail_value: 8
        },
        take_profit: {
          enabled: true,
          value: 3
        }
      }
    }
  },

  reporting: {
    output_dir: "output",
    report_indexing: {
      enabled: true,
      index_digits: 3,
      latest_alias_enabled: true
    },
    reports: {
      combined: {
        enabled: true,
        file_prefix: "ohlcv_run_report",
        file_extension: "html",
        title: "OHLCV Run Report"
      },
      mining: {
        enabled: false,
        file_prefix: "role_mining_report",
        file_extension: "html",
        title: "Role Mining Report"
      },
      backtest: {
        enabled: false,
        file_prefix: "backtest_report",
        file_extension: "html",
        title: "Backtest Report"
      }
    }
  }
};

module.exports = {
  ohlcv_project_config: ohlcv_project_config
};
