import type { CfpCondition, CfpFormDefinition, CfpQuestion, CfpVisibilityRule } from "./types";

export interface CfpNormalizedAnswer {
  readonly questionId: string;
  readonly value: boolean | number | string | readonly string[];
}

export const PROPOSAL_TITLE_QUESTION_IDS: ReadonlySet<string> = new Set([
  "title",
  "proposal-title",
  "session-title",
  "talk-title",
]);
export const PROPOSAL_TITLE_QUESTION_LABELS: ReadonlySet<string> = new Set([
  "title",
  "proposal title",
  "session title",
  "talk title",
]);

function normalizedQuestionLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

export function answerByQuestionMatch(
  definition: CfpFormDefinition,
  answers: readonly { readonly questionId: string; readonly value: unknown }[],
  questionIds: ReadonlySet<string>,
  questionLabels: ReadonlySet<string>,
): string | null {
  const matchingQuestion = definition.sections
    .flatMap(({ questions }) => questions)
    .find(({ id, label }) => questionIds.has(id) || questionLabels.has(normalizedQuestionLabel(label)));
  const answer = answers.find(({ questionId }) => questionId === matchingQuestion?.id)?.value;
  return typeof answer === "string" && answer.trim() !== "" ? answer.trim() : null;
}

export function proposalTitleFromAnswers(
  definition: CfpFormDefinition,
  answers: readonly { readonly questionId: string; readonly value: unknown }[],
): string | null {
  return answerByQuestionMatch(definition, answers, PROPOSAL_TITLE_QUESTION_IDS, PROPOSAL_TITLE_QUESTION_LABELS);
}

export type CfpAnswerValidationResult =
  | { readonly ok: true; readonly answers: readonly CfpNormalizedAnswer[]; readonly categoryKeys: readonly string[] }
  | { readonly ok: false; readonly errors: Readonly<Record<string, readonly string[]>> };

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

function matchesCondition(condition: CfpCondition, value: unknown): boolean {
  if (condition.operator === "is_empty") return isEmpty(value);
  if (condition.operator === "is_not_empty") return !isEmpty(value);
  if (condition.operator === "equals") return sameValue(value, condition.value);
  if (condition.operator === "not_equals") return !sameValue(value, condition.value);
  const choices = Array.isArray(condition.value) ? condition.value : [condition.value];
  const values = Array.isArray(value) ? value : [value];
  const included = values.some((candidate) => choices.some((choice) => sameValue(candidate, choice)));
  return condition.operator === "in" ? included : !included;
}

function matchesRule(rule: CfpVisibilityRule, values: Readonly<Record<string, unknown>>): boolean {
  const results = rule.conditions.map((condition) => matchesCondition(condition, values[condition.questionId]));
  return rule.logic === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** Resolve visibility recursively so an answer belonging to a hidden controller
 * can never reveal another question. Definition parsing rejects cycles first. */
export function visibleCfpQuestionIds(
  definition: CfpFormDefinition,
  values: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  const questions = new Map(
    definition.sections.flatMap((section) => section.questions.map((question) => [question.id, question] as const)),
  );
  const visibility = new Map<string, boolean>();

  function isVisible(question: CfpQuestion): boolean {
    const known = visibility.get(question.id);
    if (known !== undefined) return known;
    if (!question.visibleWhen) {
      visibility.set(question.id, true);
      return true;
    }
    const visible =
      question.visibleWhen.conditions.every((condition) => {
        const controller = questions.get(condition.questionId);
        return controller !== undefined && isVisible(controller);
      }) && matchesRule(question.visibleWhen, values);
    visibility.set(question.id, visible);
    return visible;
  }

  return new Set([...questions.values()].filter(isVisible).map(({ id }) => id));
}

function addError(errors: Record<string, string[]>, questionId: string, message: string): void {
  const questionErrors = errors[questionId] ?? [];
  questionErrors.push(message);
  errors[questionId] = questionErrors;
}

function textAnswer(question: CfpQuestion, value: unknown, errors: Record<string, string[]>): string | undefined {
  if (typeof value !== "string") {
    addError(errors, question.id, "Enter a text response.");
    return undefined;
  }
  const normalized = value.trim();
  const { minLength, maxLength, pattern } = question.constraints ?? {};
  if (minLength !== undefined && normalized.length < minLength) {
    addError(errors, question.id, `Enter at least ${minLength} characters.`);
  }
  if (maxLength !== undefined && normalized.length > maxLength) {
    addError(errors, question.id, `Enter no more than ${maxLength} characters.`);
  }
  if (pattern !== undefined) {
    try {
      if (!new RegExp(pattern).test(normalized))
        addError(errors, question.id, "Enter a response in the requested format.");
    } catch {
      addError(errors, question.id, "This question has an invalid configured format.");
    }
  }
  return normalized;
}

function normalizeAnswer(
  question: CfpQuestion,
  value: unknown,
  errors: Record<string, string[]>,
): CfpNormalizedAnswer["value"] | undefined {
  if (question.type === "checkbox") {
    if (typeof value !== "boolean") {
      addError(errors, question.id, "Choose whether this applies.");
      return undefined;
    }
    if (question.required && !value) addError(errors, question.id, "This checkbox is required.");
    return value;
  }
  if (isEmpty(value)) {
    if (question.required) addError(errors, question.id, "This question is required.");
    return undefined;
  }
  if (question.type === "number") {
    const normalized = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(normalized)) {
      addError(errors, question.id, "Enter a valid number.");
      return undefined;
    }
    const { min, max } = question.constraints ?? {};
    if (min !== undefined && normalized < min) addError(errors, question.id, `Enter a number of at least ${min}.`);
    if (max !== undefined && normalized > max) addError(errors, question.id, `Enter a number no greater than ${max}.`);
    return normalized;
  }
  if (question.type === "multi_select") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      addError(errors, question.id, "Choose one or more valid options.");
      return undefined;
    }
    const allowed = new Set(question.constraints?.options?.map(({ value: option }) => option) ?? []);
    const normalized = [...new Set(value)];
    if (normalized.some((option) => !allowed.has(option))) addError(errors, question.id, "Choose only listed options.");
    return normalized;
  }

  const normalized = textAnswer(question, value, errors);
  if (normalized === undefined) return undefined;
  if (question.type === "select") {
    const allowed = new Set(question.constraints?.options?.map(({ value: option }) => option) ?? []);
    if (!allowed.has(normalized)) addError(errors, question.id, "Choose a listed option.");
  } else if (question.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    addError(errors, question.id, "Enter a valid email address.");
  } else if (question.type === "url") {
    try {
      const url = new URL(normalized);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      addError(errors, question.id, "Enter a valid http or https URL.");
    }
  } else if (question.type === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    const parsed = match ? new Date(`${normalized}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
      addError(errors, question.id, "Enter a valid date.");
    }
  }
  return normalized;
}

export function validateCfpAnswers(
  definition: CfpFormDefinition,
  values: Readonly<Record<string, unknown>>,
): CfpAnswerValidationResult {
  const questions = definition.sections.flatMap((section) => section.questions);
  const questionIds = new Set(questions.map(({ id }) => id));
  const errors: Record<string, string[]> = {};
  for (const questionId of Object.keys(values)) {
    if (!questionIds.has(questionId)) addError(errors, questionId, "This question is not part of the published form.");
  }
  const visibleIds = visibleCfpQuestionIds(definition, values);
  const answers = questions.flatMap((question): CfpNormalizedAnswer[] => {
    if (!visibleIds.has(question.id)) return [];
    const normalized = normalizeAnswer(question, values[question.id], errors);
    return normalized === undefined ? [] : [{ questionId: question.id, value: normalized }];
  });
  const answerValues = Object.fromEntries(answers.map(({ questionId, value }) => [questionId, value]));
  const categoryKeys = (definition.categoryRouting ?? [])
    .filter(({ when }) => matchesRule(when, answerValues))
    .map(({ categoryId }) => categoryId);
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers, categoryKeys };
}
