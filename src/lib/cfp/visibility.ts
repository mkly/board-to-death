import type { CfpCondition, CfpConditionOperator, CfpQuestion, CfpVisibilityRule } from "./types.ts";

const EMPTY_OPERATORS = ["is_empty", "is_not_empty"] as const;
const EQUALITY_OPERATORS = ["equals", "not_equals"] as const;
const MEMBERSHIP_OPERATORS = ["in", "not_in"] as const;

export const CFP_CONDITION_OPERATOR_LABELS: Readonly<Record<CfpConditionOperator, string>> = {
  equals: "Equals",
  not_equals: "Does not equal",
  in: "Is one of",
  not_in: "Is not one of",
  is_empty: "Is empty",
  is_not_empty: "Is not empty",
};

export function conditionOperatorsForQuestion(type: string): readonly CfpConditionOperator[] {
  if (type === "select") return [...EQUALITY_OPERATORS, ...MEMBERSHIP_OPERATORS, ...EMPTY_OPERATORS];
  if (type === "multi_select") return [...MEMBERSHIP_OPERATORS, ...EMPTY_OPERATORS];
  if (
    type === "short_text" ||
    type === "long_text" ||
    type === "checkbox" ||
    type === "number" ||
    type === "url" ||
    type === "email" ||
    type === "date"
  ) {
    return [...EQUALITY_OPERATORS, ...EMPTY_OPERATORS];
  }
  return EMPTY_OPERATORS;
}

function isEmptyAnswer(answer: unknown): boolean {
  return answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");
}

function optionValues(question: CfpQuestion): Set<string> {
  return new Set(question.constraints?.options?.map(({ value }) => value) ?? []);
}

export function validateConditionForQuestion(condition: CfpCondition, question: CfpQuestion): string | null {
  const operators = conditionOperatorsForQuestion(question.type);
  if (!operators.includes(condition.operator)) {
    return `Question "${question.id}" cannot use ${CFP_CONDITION_OPERATOR_LABELS[condition.operator].toLowerCase()} comparisons with type "${question.type}"`;
  }

  if (condition.operator === "is_empty" || condition.operator === "is_not_empty") {
    return condition.value === undefined
      ? null
      : `Question "${question.id}" must not include a comparison value for ${CFP_CONDITION_OPERATOR_LABELS[condition.operator].toLowerCase()}`;
  }

  if (condition.operator === "in" || condition.operator === "not_in") {
    if (!isStringArray(condition.value)) {
      return `Question "${question.id}" requires at least one string comparison value`;
    }
    const options = optionValues(question);
    return condition.value.every((value) => options.has(value))
      ? null
      : `Question "${question.id}" has a comparison value that is not one of its configured options`;
  }

  if (question.type === "checkbox") {
    return typeof condition.value === "boolean" ? null : `Question "${question.id}" requires a true or false value`;
  }
  if (question.type === "number") {
    return typeof condition.value === "number" && Number.isFinite(condition.value)
      ? null
      : `Question "${question.id}" requires a finite number value`;
  }
  if (typeof condition.value !== "string") {
    return `Question "${question.id}" requires a text comparison value`;
  }
  if (question.type === "select" && !optionValues(question).has(condition.value)) {
    return `Question "${question.id}" has a comparison value that is not one of its configured options`;
  }
  return null;
}

export function evaluateCfpCondition(condition: CfpCondition, answer: unknown): boolean {
  if (condition.operator === "is_empty") return isEmptyAnswer(answer);
  if (condition.operator === "is_not_empty") return !isEmptyAnswer(answer);
  if (condition.operator === "equals") return answer === condition.value;
  if (condition.operator === "not_equals") return answer !== condition.value;

  const expected = Array.isArray(condition.value) ? condition.value : [];
  const matches = Array.isArray(answer) ? answer.some((value) => expected.includes(value)) : expected.includes(answer);
  return condition.operator === "in" ? matches : !matches;
}

export function evaluateCfpVisibilityRule(
  rule: CfpVisibilityRule | undefined,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if (!rule) return true;
  const results = rule.conditions.map((condition) => evaluateCfpCondition(condition, answers[condition.questionId]));
  return rule.logic === "all" ? results.every(Boolean) : results.some(Boolean);
}
