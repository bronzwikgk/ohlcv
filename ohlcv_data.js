"use strict";

const fs = require("fs");
const path = require("path");

class ohlcv_seeded_random {
  constructor(seed) {
    this.state = Number(seed) || 1;
  }

  next() {
    this.state = (this.state * 1103515245 + 12345) % 2147483648;
    return this.state / 2147483648;
  }
}

class ohlcv_csv_util {
  split_line(line) {
    var result = [];
    var field = "";
    var quoted = false;

    for (var index = 0; index < line.length; index += 1) {
      var character = line[index];
      var next_character = line[index + 1];

      if (character === "\"" && quoted && next_character === "\"") {
        field += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        result.push(field);
        field = "";
      } else {
        field += character;
      }
    }

    result.push(field);
    return result;
  }

  parse(text) {
    var lines = text.split(/\r?\n/);
    var rows = [];

    if (lines.length === 0) {
      return { headers: [], rows: rows };
    }

    var headers = this.split_line(lines[0]);

    for (var index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === "") continue;
      rows.push(this.split_line(lines[index]));
    }

    return { headers: headers, rows: rows };
  }
}

class ohlcv_data_loader {
  constructor(config) {
    this.config = config;
    this.csv = new ohlcv_csv_util();
    this.report = {
      seed: config.data_loading.seed,
      total_number_of_stocks: 0,
      rows_loaded: 0,
      source_files_selected: 0,
      selected_stock_names: [],
      loaded_stock_names: [],
      skipped_stock_names: []
    };
  }

  load() {
    var files = this.select_files(this.scan_files());
    var output = {};

    for (var file_index = 0; file_index < files.length; file_index += 1) {
      var file = files[file_index];
      var stock_name = this.stock_name_from_file(file.name);
      var rows = this.parse_file(file.path);
      rows = this.filter_window(rows);
      rows = this.clean_rows(rows);

      if (rows.length === 0) {
        this.report.skipped_stock_names.push(stock_name);
        continue;
      }

      output[stock_name] = rows;
      this.report.loaded_stock_names.push(stock_name);
      this.report.total_number_of_stocks += 1;
      this.report.rows_loaded += rows.length;
    }

    return output;
  }

  scan_files() {
    var load_config = this.config.data_loading;
    var names = fs.readdirSync(load_config.source_dir);
    var files = [];

    for (var index = 0; index < names.length; index += 1) {
      if (names[index].indexOf(load_config.file_pattern) !== -1) {
        files.push({ name: names[index], path: path.join(load_config.source_dir, names[index]) });
      }
    }

    return files;
  }

  select_files(files) {
    var rng = new ohlcv_seeded_random(this.config.data_loading.seed);
    var max_stocks = Number(this.config.data_loading.number_of_stocks_to_load);
    var selected = [];

    for (var index = files.length - 1; index > 0; index -= 1) {
      var swap_index = Math.floor(rng.next() * (index + 1));
      var temp = files[index];
      files[index] = files[swap_index];
      files[swap_index] = temp;
    }

    for (var file_index = 0; file_index < files.length && file_index < max_stocks; file_index += 1) {
      selected.push(files[file_index]);
      this.report.selected_stock_names.push(this.stock_name_from_file(files[file_index].name));
    }

    this.report.source_files_selected = selected.length;
    return selected;
  }

  parse_file(file_path) {
    var text = fs.readFileSync(file_path, "utf8");
    var parsed = this.csv.parse(text);
    var rows = [];
    var indexes = {};
    var load_config = this.config.data_loading;

    for (var column_index = 0; column_index < load_config.import_columns.length; column_index += 1) {
      var source_column = load_config.import_columns[column_index];
      indexes[source_column] = parsed.headers.indexOf(source_column);
    }

    for (var row_index = 0; row_index < parsed.rows.length; row_index += 1) {
      var input = parsed.rows[row_index];
      var row = {};

      for (var import_index = 0; import_index < load_config.import_columns.length; import_index += 1) {
        var column = load_config.import_columns[import_index];
        var output_column = load_config.column_map[column];
        var value = input[indexes[column]];

        if (output_column === "date") {
          row[output_column] = new Date(value);
        } else {
          row[output_column] = this.to_number(value);
        }
      }

      rows.push(row);
    }

    rows.sort(function compare_dates(left, right) {
      return left.date - right.date;
    });

    return rows;
  }

  filter_window(rows) {
    var end_date = new Date(this.config.data_loading.window_end_date);
    var start_date = new Date(end_date);
    start_date.setMonth(start_date.getMonth() - (Number(this.config.data_loading.number_of_years_of_data) * 12));

    var output = [];
    for (var index = 0; index < rows.length; index += 1) {
      if (rows[index].date >= start_date && rows[index].date <= end_date) {
        output.push(rows[index]);
      }
    }
    return output;
  }

  clean_rows(rows) {
    var output = [];
    var cleaning = this.config.data_loading.cleaning || {};

    for (var index = 0; index < rows.length; index += 1) {
      var row = rows[index];
      if (!(row.date instanceof Date) || Number.isNaN(row.date.getTime())) continue;
      if (row.adj_close === null || row.adj_close === undefined) continue;
      if (row.volume === null || row.volume === undefined) continue;
      if (cleaning.remove_weekend_rows && (row.date.getDay() === 0 || row.date.getDay() === 6)) continue;
      if (cleaning.remove_zero_volume_rows && row.volume <= 0) continue;
      output.push(row);
    }

    return output;
  }

  stock_name_from_file(file_name) {
    return file_name.replace(/\.csv$/i, "");
  }

  to_number(value) {
    if (value === null || value === undefined || value === "") return null;
    var number_value = Number(String(value).replace(/[, ]/g, ""));
    if (!Number.isFinite(number_value)) return null;
    return number_value;
  }
}

class ohlcv_data_splitter {
  constructor(config) {
    this.config = config;
  }

  split(collection) {
    var mining = {};
    var testing = {};
    var names = Object.keys(collection || {});
    var ratio = Number(this.config.data_split.mining_ratio);

    for (var stock_index = 0; stock_index < names.length; stock_index += 1) {
      var stock = names[stock_index];
      var rows = collection[stock];
      var cut = Math.floor(rows.length * ratio);
      mining[stock] = rows.slice(0, cut);
      testing[stock] = rows.slice(cut);
    }

    return { mining: mining, testing: testing };
  }
}

module.exports = {
  ohlcv_seeded_random: ohlcv_seeded_random,
  ohlcv_csv_util: ohlcv_csv_util,
  ohlcv_data_loader: ohlcv_data_loader,
  ohlcv_data_splitter: ohlcv_data_splitter
};
