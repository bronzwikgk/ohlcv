// Coding instructions for this folder:
// - Do not use arrow functions.
// - Do not use forEach.
// - Do not use object/property shorthand.
// - Prefer explicit function declarations and plain loops.

import {
  addColumn,
  getColumnIndex,
  setDataFrameValue,
  toNumber,
} from "./utility.js";

export class RuleEngine {
  constructor(dataframe) {
    this.dataframe = dataframe;
  }

  getValueFromColumn(columnName, rowIndex) {
    const columnIndex = getColumnIndex(this.dataframe, columnName);
    const dataRowIndex = rowIndex + 1;

    if (columnIndex === -1) {
      return null;
    }

    if (dataRowIndex < 1 || dataRowIndex >= this.dataframe.data.length) {
      return null;
    }

    return this.dataframe.data[dataRowIndex][columnIndex];
  }

  evaluateOperand(operand, rowIndex) {
    let actualRowIndex = rowIndex;

    if (operand === null || operand === undefined) {
      return null;
    }

    if (typeof operand !== "object") {
      return operand;
    }

    if (operand.row_offset !== undefined) {
      actualRowIndex = rowIndex + Number(operand.row_offset);
    }

    if (operand.type === "value") {
      return operand.value;
    }

    if (operand.type === "column") {
      return this.getValueFromColumn(operand.column, actualRowIndex);
    }

    if (operand.type === "expression") {
      return this.evaluateExpression(operand, rowIndex);
    }

    if (operand.column !== undefined) {
      return this.getValueFromColumn(operand.column, actualRowIndex);
    }

    if (operand.value !== undefined) {
      return operand.value;
    }

    return null;
  }

  evaluateExpression(expression, rowIndex) {
    const leftValue = this.evaluateOperand(expression.left, rowIndex);
    const rightValue = this.evaluateOperand(expression.right, rowIndex);
    const leftNumber = toNumber(leftValue);
    const rightNumber = toNumber(rightValue);

    if (leftNumber === null || rightNumber === null) {
      return null;
    }

    if (expression.operator === "add") {
      return leftNumber + rightNumber;
    }

    if (expression.operator === "subtract") {
      return leftNumber - rightNumber;
    }

    if (expression.operator === "multiply") {
      return leftNumber * rightNumber;
    }

    if (expression.operator === "divide") {
      if (rightNumber === 0) {
        return null;
      }

      return leftNumber / rightNumber;
    }

    if (expression.operator === "mean") {
      return (leftNumber + rightNumber) / 2;
    }

    if (expression.operator === "percentChange") {
      if (leftNumber === 0) {
        return null;
      }

      return ((rightNumber - leftNumber) / leftNumber) * 100;
    }

    return null;
  }

  compareValues(operator, leftValue, rightValue, rowIndex, rule) {
    const leftNumber = toNumber(leftValue);
    const rightNumber = toNumber(rightValue);

    if (operator === "greaterThan") {
      if (leftNumber === null || rightNumber === null) {
        return false;
      }

      return leftNumber > rightNumber;
    }

    if (operator === "lessThan") {
      if (leftNumber === null || rightNumber === null) {
        return false;
      }

      return leftNumber < rightNumber;
    }

    if (operator === "equalTo") {
      return String(leftValue) === String(rightValue);
    }

    if (operator === "inRange") {
      return this.evaluateRange(leftNumber, rule.range);
    }

    if (operator === "notInRange") {
      return !this.evaluateRange(leftNumber, rule.range);
    }

    if (operator === "crossOver") {
      return this.evaluateCross("crossOver", rule.left, rule.right, rowIndex);
    }

    if (operator === "crossBelow") {
      return this.evaluateCross("crossBelow", rule.left, rule.right, rowIndex);
    }

    return false;
  }

  evaluateRange(value, rangeObject) {
    let minimum = null;
    let maximum = null;
    let includeMinimum = true;
    let includeMaximum = true;

    if (rangeObject === null || rangeObject === undefined) {
      return false;
    }

    if (value === null || value === undefined) {
      return false;
    }

    if (rangeObject.min !== undefined) {
      minimum = Number(rangeObject.min);
    }

    if (rangeObject.max !== undefined) {
      maximum = Number(rangeObject.max);
    }

    if (rangeObject.include_min !== undefined) {
      includeMinimum = Boolean(rangeObject.include_min);
    }

    if (rangeObject.include_max !== undefined) {
      includeMaximum = Boolean(rangeObject.include_max);
    }

    if (minimum !== null) {
      if (includeMinimum && value < minimum) {
        return false;
      }

      if (!includeMinimum && value <= minimum) {
        return false;
      }
    }

    if (maximum !== null) {
      if (includeMaximum && value > maximum) {
        return false;
      }

      if (!includeMaximum && value >= maximum) {
        return false;
      }
    }

    return true;
  }

  evaluateCross(crossOperator, leftOperand, rightOperand, rowIndex) {
    const currentLeft = toNumber(this.evaluateOperand(leftOperand, rowIndex));
    const currentRight = toNumber(this.evaluateOperand(rightOperand, rowIndex));
    const previousLeft = toNumber(this.evaluateOperand(leftOperand, rowIndex - 1));
    const previousRight = toNumber(this.evaluateOperand(rightOperand, rowIndex - 1));

    if (currentLeft === null || currentRight === null || previousLeft === null || previousRight === null) {
      return false;
    }

    if (crossOperator === "crossOver") {
      return previousLeft <= previousRight && currentLeft > currentRight;
    }

    if (crossOperator === "crossBelow") {
      return previousLeft >= previousRight && currentLeft < currentRight;
    }

    return false;
  }

  evaluateRule(rule, rowIndex) {
    if (rule === null || rule === undefined) {
      return false;
    }

    if (rule.logic === "and") {
      return this.evaluateAnd(rule.rules, rowIndex);
    }

    if (rule.logic === "or") {
      return this.evaluateOr(rule.rules, rowIndex);
    }

    if (rule.logic === "not") {
      return !this.evaluateRule(rule.rule, rowIndex);
    }

    if (rule.logic === "none") {
      return this.evaluateNone(rule.rules, rowIndex);
    }

    if (rule.type === "condition") {
      return this.evaluateCondition(rule, rowIndex);
    }

    return this.evaluateCondition(rule, rowIndex);
  }

  evaluateAnd(rules, rowIndex) {
    if (!Array.isArray(rules)) {
      return false;
    }

    for (let i = 0; i < rules.length; i += 1) {
      if (!this.evaluateRule(rules[i], rowIndex)) {
        return false;
      }
    }

    return true;
  }

  evaluateOr(rules, rowIndex) {
    if (!Array.isArray(rules)) {
      return false;
    }

    for (let i = 0; i < rules.length; i += 1) {
      if (this.evaluateRule(rules[i], rowIndex)) {
        return true;
      }
    }

    return false;
  }

  evaluateNone(rules, rowIndex) {
    if (!Array.isArray(rules)) {
      return false;
    }

    for (let i = 0; i < rules.length; i += 1) {
      if (this.evaluateRule(rules[i], rowIndex)) {
        return false;
      }
    }

    return true;
  }

  evaluateCondition(rule, rowIndex) {
    const leftValue = this.evaluateOperand(rule.left, rowIndex);
    const rightValue = this.evaluateOperand(rule.right, rowIndex);

    return this.compareValues(rule.operator, leftValue, rightValue, rowIndex, rule);
  }

  addComputedColumn(columnName, expression) {
    addColumn(this.dataframe, columnName, "");

    for (let rowIndex = 0; rowIndex < this.dataframe.rows.length; rowIndex += 1) {
      const value = this.evaluateOperand(expression, rowIndex);
      setDataFrameValue(this.dataframe, rowIndex, columnName, value);
    }

    return this.dataframe;
  }

  addRuleLabelColumn(columnName, rule, trueValue, falseValue) {
    addColumn(this.dataframe, columnName, "");

    for (let rowIndex = 0; rowIndex < this.dataframe.rows.length; rowIndex += 1) {
      if (this.evaluateRule(rule, rowIndex)) {
        setDataFrameValue(this.dataframe, rowIndex, columnName, trueValue);
      } else {
        setDataFrameValue(this.dataframe, rowIndex, columnName, falseValue);
      }
    }

    return this.dataframe;
  }

  addTargetEntryExitLabels(configObject) {
    let unknownValue = "";

    if (configObject.unknown_label_value !== undefined) {
      unknownValue = configObject.unknown_label_value;
    }

    this.addComputedColumn(configObject.change_column, configObject.change_expression);
    this.addRuleLabelColumn(configObject.target_label_column, configObject.target_rule, 1, 0);
    this.addRuleLabelColumn(configObject.enter_label_column, configObject.enter_rule, 1, 0);
    this.addRuleLabelColumn(configObject.exit_label_column, configObject.exit_rule, 1, 0);

    for (let rowIndex = 0; rowIndex < this.dataframe.rows.length; rowIndex += 1) {
      if (this.getValueFromColumn(configObject.change_column, rowIndex) === null) {
        setDataFrameValue(this.dataframe, rowIndex, configObject.target_label_column, unknownValue);
        setDataFrameValue(this.dataframe, rowIndex, configObject.enter_label_column, unknownValue);
        setDataFrameValue(this.dataframe, rowIndex, configObject.exit_label_column, unknownValue);
      }
    }

    return this.dataframe;
  }
}
