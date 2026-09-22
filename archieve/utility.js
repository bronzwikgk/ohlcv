// Coding instructions for this folder:
// - Do not use arrow functions.
// - Do not use forEach.
// - Do not use object/property shorthand.
// - Prefer explicit function declarations and plain loops.
// - Keep dataframe-style operations here so miner_gk.js can execute methods in sequence.

export function parseCsvLine(line) {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

export function parseCsvToArray(csvText) {
  const cleanedText = String(csvText || "").replace(/^\uFEFF/, "");
  const lines = cleanedText.split(/\r?\n/);
  const table = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "") {
      table.push(parseCsvLine(lines[i]));
    }
  }

  return table;
}

export function createDataFrame(name) {
  return {
    name: name || "",
    symbol: "",
    file_path: "",
    columns: [],
    data: [],
    rows: [],
  };
}

export function setDataFrameFromArray(dataframe, table, options) {
  const safeOptions = options || {};
  const safeTable = table || [];
  let columns = [];
  const data = safeTable;
  const rows = [];

  if (safeTable.length > 0) {
    columns = safeTable[0];
  }

  for (let rowIndex = 1; rowIndex < safeTable.length; rowIndex += 1) {
    const sourceRow = safeTable[rowIndex];
    const rowObject = {};

    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      rowObject[columns[columnIndex]] = sourceRow[columnIndex];
    }

    rows.push(rowObject);
  }

  dataframe.symbol = safeOptions.symbol || "";
  dataframe.file_path = safeOptions.file_path || "";
  dataframe.columns = columns;
  dataframe.data = data;
  dataframe.rows = rows;

  return dataframe;
}

export function getColumnIndex(dataframe, columnName) {
  for (let i = 0; i < dataframe.columns.length; i += 1) {
    if (dataframe.columns[i] === columnName) {
      return i;
    }
  }

  return -1;
}

export function selectColumn(dataframe, columnName) {
  const columnIndex = getColumnIndex(dataframe, columnName);
  const values = [];

  if (columnIndex === -1) {
    return values;
  }

  for (let i = 1; i < dataframe.data.length; i += 1) {
    values.push(dataframe.data[i][columnIndex]);
  }

  return values;
}

export function head(dataframe, rowCount) {
  const count = rowCount || 5;
  const output = [];

  for (let i = 0; i < dataframe.rows.length && i < count; i += 1) {
    output.push(dataframe.rows[i]);
  }

  return output;
}

export function rowCount(dataframe) {
  if (dataframe.data.length > 0) {
    return dataframe.data.length - 1;
  }

  return 0;
}

export function createDataFrameSchema(name, columns) {
  return {
    name: name || "",
    columns: columns || [],
    require_unique_columns: true,
    require_data_header_match: true,
    require_rows_match_data: true,
  };
}

export function createValidationReport(schemaName) {
  return {
    schema_name: schemaName || "",
    is_valid: true,
    errors: [],
    warnings: [],
    metrics: {
      column_count: 0,
      row_count: 0,
      object_row_count: 0,
      missing_required_columns: 0,
      duplicate_columns: 0,
      row_length_errors: 0,
      type_errors: 0,
    },
  };
}

export function addValidationError(report, message) {
  report.is_valid = false;
  report.errors.push(message);
}

export function addValidationWarning(report, message) {
  report.warnings.push(message);
}

export function schemaColumnByName(schema, columnName) {
  for (let i = 0; i < schema.columns.length; i += 1) {
    if (schema.columns[i].name === columnName) {
      return schema.columns[i];
    }
  }

  return null;
}

export function validateDataFrameShape(dataframe, schema, report) {
  if (dataframe === null || dataframe === undefined) {
    addValidationError(report, "Dataframe is missing.");
    return report;
  }

  if (!Array.isArray(dataframe.columns)) {
    addValidationError(report, "Dataframe columns must be an array.");
  }

  if (!Array.isArray(dataframe.data)) {
    addValidationError(report, "Dataframe data must be a 2D array.");
  }

  if (!Array.isArray(dataframe.rows)) {
    addValidationError(report, "Dataframe rows must be an array.");
  }

  if (!Array.isArray(dataframe.columns) || !Array.isArray(dataframe.data) || !Array.isArray(dataframe.rows)) {
    return report;
  }

  report.metrics.column_count = dataframe.columns.length;
  report.metrics.row_count = rowCount(dataframe);
  report.metrics.object_row_count = dataframe.rows.length;

  if (schema.require_data_header_match && dataframe.data.length > 0) {
    if (dataframe.data[0].length !== dataframe.columns.length) {
      addValidationError(report, "Header row length does not match dataframe.columns length.");
    }

    for (let columnIndex = 0; columnIndex < dataframe.columns.length; columnIndex += 1) {
      if (dataframe.data[0][columnIndex] !== dataframe.columns[columnIndex]) {
        addValidationError(report, "Header row value does not match dataframe.columns at index " + String(columnIndex) + ".");
      }
    }
  }

  if (schema.require_rows_match_data && dataframe.rows.length !== report.metrics.row_count) {
    addValidationError(report, "Object row count does not match data row count.");
  }

  return report;
}

export function validateDuplicateColumns(dataframe, schema, report) {
  const seenColumns = {};

  if (!schema.require_unique_columns) {
    return report;
  }

  for (let columnIndex = 0; columnIndex < dataframe.columns.length; columnIndex += 1) {
    const columnName = dataframe.columns[columnIndex];

    if (seenColumns[columnName] === true) {
      report.metrics.duplicate_columns += 1;
      addValidationError(report, "Duplicate column found: " + columnName);
    }

    seenColumns[columnName] = true;
  }

  return report;
}

export function validateRequiredColumns(dataframe, schema, report) {
  for (let schemaIndex = 0; schemaIndex < schema.columns.length; schemaIndex += 1) {
    const schemaColumn = schema.columns[schemaIndex];
    const columnIndex = getColumnIndex(dataframe, schemaColumn.name);

    if (schemaColumn.required && columnIndex === -1) {
      report.metrics.missing_required_columns += 1;
      addValidationError(report, "Required column is missing: " + schemaColumn.name);
    }
  }

  return report;
}

export function isBlankValue(value) {
  if (value === null || value === undefined || value === "") {
    return true;
  }

  return false;
}

export function validateValueType(value, schemaColumn) {
  let numberValue = null;

  if (isBlankValue(value)) {
    if (schemaColumn.allow_blank) {
      return true;
    }

    if (schemaColumn.nullable) {
      return true;
    }

    return false;
  }

  if (schemaColumn.type === "any") {
    return true;
  }

  if (schemaColumn.type === "string") {
    return typeof value === "string";
  }

  if (schemaColumn.type === "number") {
    numberValue = Number(value);
    return !Number.isNaN(numberValue);
  }

  if (schemaColumn.type === "integer") {
    numberValue = Number(value);

    if (Number.isNaN(numberValue)) {
      return false;
    }

    return Number.isInteger(numberValue);
  }

  if (schemaColumn.type === "label") {
    if (value === 0 || value === 1 || value === "0" || value === "1") {
      return true;
    }

    if (schemaColumn.allow_blank && value === "") {
      return true;
    }

    return false;
  }

  if (schemaColumn.type === "date") {
    if (typeof value !== "string") {
      return false;
    }

    return /^\d{4}-\d{2}-\d{2}/.test(value);
  }

  return true;
}

export function validateRowLengths(dataframe, report) {
  for (let dataRowIndex = 0; dataRowIndex < dataframe.data.length; dataRowIndex += 1) {
    if (dataframe.data[dataRowIndex].length !== dataframe.columns.length) {
      report.metrics.row_length_errors += 1;
      addValidationError(report, "Data row length mismatch at data index " + String(dataRowIndex) + ".");
    }
  }

  return report;
}

export function validateColumnTypes(dataframe, schema, report) {
  for (let schemaIndex = 0; schemaIndex < schema.columns.length; schemaIndex += 1) {
    const schemaColumn = schema.columns[schemaIndex];
    const columnIndex = getColumnIndex(dataframe, schemaColumn.name);

    if (columnIndex === -1) {
      continue;
    }

    for (let dataRowIndex = 1; dataRowIndex < dataframe.data.length; dataRowIndex += 1) {
      if (!validateValueType(dataframe.data[dataRowIndex][columnIndex], schemaColumn)) {
        report.metrics.type_errors += 1;
        addValidationError(
          report,
          "Type validation failed for column " + schemaColumn.name + " at data index " + String(dataRowIndex) + ".",
        );
      }
    }
  }

  return report;
}

export function validateObjectRows(dataframe, report) {
  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < dataframe.columns.length; columnIndex += 1) {
      const columnName = dataframe.columns[columnIndex];

      if (dataframe.rows[rowIndex][columnName] === undefined) {
        addValidationError(report, "Object row missing column " + columnName + " at row index " + String(rowIndex) + ".");
      }
    }
  }

  return report;
}

export function validateDataFrame(dataframe, schema) {
  const report = createValidationReport(schema.name);

  validateDataFrameShape(dataframe, schema, report);

  if (dataframe === null || dataframe === undefined) {
    return report;
  }

  if (!Array.isArray(dataframe.columns) || !Array.isArray(dataframe.data) || !Array.isArray(dataframe.rows)) {
    return report;
  }

  validateDuplicateColumns(dataframe, schema, report);
  validateRequiredColumns(dataframe, schema, report);
  validateRowLengths(dataframe, report);
  validateColumnTypes(dataframe, schema, report);
  validateObjectRows(dataframe, report);

  return report;
}

export function addColumn(dataframe, columnName, defaultValue) {
  const existingIndex = getColumnIndex(dataframe, columnName);

  if (existingIndex !== -1) {
    return existingIndex;
  }

  dataframe.columns.push(columnName);

  if (dataframe.data.length === 0) {
    dataframe.data.push([]);
  }

  if (dataframe.data[0] !== dataframe.columns) {
    dataframe.data[0].push(columnName);
  }

  for (let rowIndex = 1; rowIndex < dataframe.data.length; rowIndex += 1) {
    dataframe.data[rowIndex].push(defaultValue);
  }

  for (let objectRowIndex = 0; objectRowIndex < dataframe.rows.length; objectRowIndex += 1) {
    dataframe.rows[objectRowIndex][columnName] = defaultValue;
  }

  return dataframe.columns.length - 1;
}

export function setDataFrameValue(dataframe, rowIndex, columnName, value) {
  const columnIndex = addColumn(dataframe, columnName, "");
  const dataRowIndex = rowIndex + 1;

  if (dataRowIndex >= dataframe.data.length) {
    return dataframe;
  }

  dataframe.data[dataRowIndex][columnIndex] = value;

  if (rowIndex < dataframe.rows.length) {
    dataframe.rows[rowIndex][columnName] = value;
  }

  return dataframe;
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    return null;
  }

  return numberValue;
}

export function escapeCsvValue(value) {
  let text = "";
  let shouldQuote = false;
  let escapedText = "";

  if (value === null || value === undefined) {
    text = "";
  } else {
    text = String(value);
  }

  if (text.indexOf(",") !== -1) {
    shouldQuote = true;
  }

  if (text.indexOf('"') !== -1) {
    shouldQuote = true;
  }

  if (text.indexOf("\n") !== -1) {
    shouldQuote = true;
  }

  if (text.indexOf("\r") !== -1) {
    shouldQuote = true;
  }

  if (!shouldQuote) {
    return text;
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '"') {
      escapedText += '""';
    } else {
      escapedText += text[i];
    }
  }

  return '"' + escapedText + '"';
}

export function appendTimestampToFileName(fileName, timestampText) {
  const safeFileName = String(fileName || "");
  const safeTimestampText = String(timestampText || "");
  const extensionIndex = safeFileName.lastIndexOf(".");

  if (safeTimestampText === "") {
    return safeFileName;
  }

  if (extensionIndex <= 0) {
    return safeFileName + "_" + safeTimestampText;
  }

  return safeFileName.slice(0, extensionIndex) + "_" + safeTimestampText + safeFileName.slice(extensionIndex);
}

export function createRunTimestamp(dateObject) {
  const activeDate = dateObject || new Date();
  const year = String(activeDate.getFullYear());
  const month = String(activeDate.getMonth() + 1).padStart(2, "0");
  const day = String(activeDate.getDate()).padStart(2, "0");
  const hours = String(activeDate.getHours()).padStart(2, "0");
  const minutes = String(activeDate.getMinutes()).padStart(2, "0");
  const seconds = String(activeDate.getSeconds()).padStart(2, "0");

  return year + month + day + "_" + hours + minutes + seconds;
}

export function createOutputFileName(configObject, fileName) {
  if (configObject === null || configObject === undefined) {
    return fileName;
  }

  return appendTimestampToFileName(fileName, configObject.run_timestamp);
}

export function dataFrameToCsv(dataframe) {
  const lines = [];
  let headerLine = "";

  for (let columnIndex = 0; columnIndex < dataframe.columns.length; columnIndex += 1) {
    if (columnIndex > 0) {
      headerLine += ",";
    }

    headerLine += escapeCsvValue(dataframe.columns[columnIndex]);
  }

  lines.push(headerLine);

  for (let rowIndex = 0; rowIndex < dataframe.rows.length; rowIndex += 1) {
    let rowLine = "";

    for (let columnIndex = 0; columnIndex < dataframe.columns.length; columnIndex += 1) {
      const columnName = dataframe.columns[columnIndex];
      const value = dataframe.rows[rowIndex][columnName];

      if (columnIndex > 0) {
        rowLine += ",";
      }

      rowLine += escapeCsvValue(value);
    }

    lines.push(rowLine);
  }

  return lines.join("\n");
}
