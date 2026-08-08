import { type CfpParseError, cfpError } from "./errors.ts";
import { cfpFormDefinitionSchema } from "./schema.ts";
import {
  CFP_BUILT_IN_QUESTION_TYPES,
  CFP_SUPPORTED_VERSIONS,
  type CfpFormDefinition,
  type CfpQuestion,
} from "./types.ts";

export type CfpParseResult =
  | { ok: true; definition: CfpFormDefinition; errors: [] }
  | { ok: false; definition: null; errors: CfpParseError[] };

/** Parses and validates a JSON CFP form definition, returning either the typed
 * definition or the full list of structured errors found. */
export function parseCfpDefinition(input: unknown): CfpParseResult {
  const shapeResult = cfpFormDefinitionSchema.safeParse(input);
  if (!shapeResult.success) {
    return {
      ok: false,
      definition: null,
      errors: shapeResult.error.issues.map((issue) =>
        cfpError("malformed_definition", issue.path.join(".") || "(root)", issue.message),
      ),
    };
  }

  const definition = shapeResult.data as CfpFormDefinition;
  const errors: CfpParseError[] = [];

  if (!(CFP_SUPPORTED_VERSIONS as readonly number[]).includes(definition.version)) {
    errors.push(
      cfpError(
        "unsupported_version",
        "version",
        `Unsupported form definition version: ${definition.version}. Supported versions: ${CFP_SUPPORTED_VERSIONS.join(", ")}`,
      ),
    );
  }

  errors.push(...findDuplicateIdErrors(definition));
  errors.push(...findUnknownQuestionTypeErrors(definition));
  errors.push(...findMissingRuleTargetErrors(definition));
  errors.push(...findImpossibleConstraintErrors(definition));
  errors.push(...findQuestionTypeConstraintErrors(definition));
  errors.push(...findVisibilityRuleErrors(definition));

  if (errors.length > 0) {
    return { ok: false, definition: null, errors };
  }
  return { ok: true, definition, errors: [] };
}

function findQuestionTypeConstraintErrors(definition: CfpFormDefinition): CfpParseError[] {
  const errors: CfpParseError[] = [];

  for (const { question, path } of allQuestions(definition)) {
    const constraints = question.constraints;
    if ((definition.customQuestionTypes ?? []).includes(question.type)) continue;
    if (!constraints) {
      if (question.type === "select" || question.type === "multi_select") {
        errors.push(
          cfpError(
            "impossible_rule",
            `${path}.constraints.options`,
            `Question "${question.id}" must declare at least one option`,
          ),
        );
      }
      continue;
    }

    const keys = Object.keys(constraints) as (keyof typeof constraints)[];
    const allowed = new Set<keyof typeof constraints>();
    if (
      question.type === "short_text" ||
      question.type === "long_text" ||
      question.type === "url" ||
      question.type === "email"
    ) {
      allowed.add("minLength").add("maxLength").add("pattern");
    } else if (question.type === "number") {
      allowed.add("min").add("max");
    } else if (question.type === "select" || question.type === "multi_select") {
      allowed.add("options");
    }
    const unsupported = keys.find((key) => !allowed.has(key));
    if (unsupported) {
      errors.push(
        cfpError(
          "impossible_rule",
          `${path}.constraints.${unsupported}`,
          `Question "${question.id}" cannot use ${unsupported} with type "${question.type}"`,
        ),
      );
    }

    if (question.type === "select" || question.type === "multi_select") {
      const values = constraints.options?.map(({ value }) => value) ?? [];
      if (values.length === 0) {
        errors.push(
          cfpError(
            "impossible_rule",
            `${path}.constraints.options`,
            `Question "${question.id}" must declare at least one option`,
          ),
        );
      } else if (new Set(values).size !== values.length) {
        errors.push(
          cfpError(
            "duplicate_id",
            `${path}.constraints.options`,
            `Question "${question.id}" has duplicate option values`,
          ),
        );
      }
    }
  }

  return errors;
}

function allQuestions(definition: CfpFormDefinition): { question: CfpQuestion; path: string }[] {
  return definition.sections.flatMap((section, sectionIndex) =>
    section.questions.map((question, questionIndex) => ({
      question,
      path: `sections.${sectionIndex}.questions.${questionIndex}`,
    })),
  );
}

function findDuplicateIdErrors(definition: CfpFormDefinition): CfpParseError[] {
  const errors: CfpParseError[] = [];

  const seenSectionIds = new Map<string, number>();
  definition.sections.forEach((section, index) => {
    const firstIndex = seenSectionIds.get(section.id);
    if (firstIndex !== undefined) {
      errors.push(cfpError("duplicate_id", `sections.${index}.id`, `Duplicate section id "${section.id}"`));
    } else {
      seenSectionIds.set(section.id, index);
    }
  });

  const seenQuestionIds = new Map<string, string>();
  for (const { question, path } of allQuestions(definition)) {
    if (seenQuestionIds.has(question.id)) {
      errors.push(cfpError("duplicate_id", `${path}.id`, `Duplicate question id "${question.id}"`));
    } else {
      seenQuestionIds.set(question.id, path);
    }
  }

  const seenCategoryIds = new Map<string, number>();
  (definition.categories ?? []).forEach((category, index) => {
    const firstIndex = seenCategoryIds.get(category.id);
    if (firstIndex !== undefined) {
      errors.push(cfpError("duplicate_id", `categories.${index}.id`, `Duplicate category id "${category.id}"`));
    } else {
      seenCategoryIds.set(category.id, index);
    }
  });

  const seenRoutingIds = new Map<string, number>();
  (definition.categoryRouting ?? []).forEach((rule, index) => {
    const firstIndex = seenRoutingIds.get(rule.id);
    if (firstIndex !== undefined) {
      errors.push(
        cfpError("duplicate_id", `categoryRouting.${index}.id`, `Duplicate category routing rule id "${rule.id}"`),
      );
    } else {
      seenRoutingIds.set(rule.id, index);
    }
  });

  return errors;
}

function findUnknownQuestionTypeErrors(definition: CfpFormDefinition): CfpParseError[] {
  const knownTypes = new Set<string>([...CFP_BUILT_IN_QUESTION_TYPES, ...(definition.customQuestionTypes ?? [])]);
  const errors: CfpParseError[] = [];

  for (const { question, path } of allQuestions(definition)) {
    if (!knownTypes.has(question.type)) {
      errors.push(
        cfpError(
          "unknown_question_type",
          `${path}.type`,
          `Question "${question.id}" uses unknown type "${question.type}". Declare it in customQuestionTypes to use it.`,
        ),
      );
    }
  }

  return errors;
}

function findMissingRuleTargetErrors(definition: CfpFormDefinition): CfpParseError[] {
  const errors: CfpParseError[] = [];
  const questionIds = new Set(allQuestions(definition).map(({ question }) => question.id));
  const categoryIds = new Set((definition.categories ?? []).map((category) => category.id));

  for (const { question, path } of allQuestions(definition)) {
    if (!question.visibleWhen) continue;
    question.visibleWhen.conditions.forEach((condition, conditionIndex) => {
      if (!questionIds.has(condition.questionId)) {
        errors.push(
          cfpError(
            "missing_rule_target",
            `${path}.visibleWhen.conditions.${conditionIndex}.questionId`,
            `Question "${question.id}" has a visibility rule referencing unknown question "${condition.questionId}"`,
          ),
        );
      }
    });
  }

  (definition.categoryRouting ?? []).forEach((rule, ruleIndex) => {
    rule.when.conditions.forEach((condition, conditionIndex) => {
      if (!questionIds.has(condition.questionId)) {
        errors.push(
          cfpError(
            "missing_rule_target",
            `categoryRouting.${ruleIndex}.when.conditions.${conditionIndex}.questionId`,
            `Category routing rule "${rule.id}" references unknown question "${condition.questionId}"`,
          ),
        );
      }
    });
    if (!categoryIds.has(rule.categoryId)) {
      errors.push(
        cfpError(
          "missing_rule_target",
          `categoryRouting.${ruleIndex}.categoryId`,
          `Category routing rule "${rule.id}" targets unknown category "${rule.categoryId}"`,
        ),
      );
    }
  });

  return errors;
}

function findImpossibleConstraintErrors(definition: CfpFormDefinition): CfpParseError[] {
  const errors: CfpParseError[] = [];

  for (const { question, path } of allQuestions(definition)) {
    const constraints = question.constraints;
    if (!constraints) continue;
    if (
      constraints.minLength !== undefined &&
      constraints.maxLength !== undefined &&
      constraints.minLength > constraints.maxLength
    ) {
      errors.push(
        cfpError(
          "impossible_rule",
          `${path}.constraints`,
          `Question "${question.id}" has minLength (${constraints.minLength}) greater than maxLength (${constraints.maxLength})`,
        ),
      );
    }
    if (constraints.min !== undefined && constraints.max !== undefined && constraints.min > constraints.max) {
      errors.push(
        cfpError(
          "impossible_rule",
          `${path}.constraints`,
          `Question "${question.id}" has min (${constraints.min}) greater than max (${constraints.max})`,
        ),
      );
    }
  }

  return errors;
}

/** Detects self-referencing and cyclic conditional-visibility dependency chains
 * across all questions in the definition. Only runs over rule targets that are
 * known to exist; findMissingRuleTargetErrors reports the rest. */
function findVisibilityRuleErrors(definition: CfpFormDefinition): CfpParseError[] {
  const errors: CfpParseError[] = [];
  const questions = allQuestions(definition);
  const pathById = new Map(questions.map(({ question, path }) => [question.id, path]));
  const dependsOn = new Map<string, Set<string>>();

  for (const { question } of questions) {
    const deps = new Set<string>();
    for (const condition of question.visibleWhen?.conditions ?? []) {
      if (pathById.has(condition.questionId)) {
        deps.add(condition.questionId);
      }
    }
    dependsOn.set(question.id, deps);
  }

  for (const [questionId, deps] of dependsOn) {
    if (deps.has(questionId)) {
      errors.push(
        cfpError(
          "impossible_rule",
          `${pathById.get(questionId)}.visibleWhen`,
          `Question "${questionId}" has a visibility rule that depends on itself`,
        ),
      );
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const reportedCycles = new Set<string>();

  const visit = (questionId: string, stack: string[]): void => {
    const status = state.get(questionId);
    if (status === "done") return;
    if (status === "visiting") {
      const cycleStart = stack.indexOf(questionId);
      const cycle = [...stack.slice(cycleStart), questionId];
      const cycleKey = [...cycle].sort().join(",");
      if (cycle.length > 2 && !reportedCycles.has(cycleKey)) {
        reportedCycles.add(cycleKey);
        errors.push(
          cfpError(
            "cyclic_rule",
            `${pathById.get(questionId)}.visibleWhen`,
            `Visibility rules form a cycle: ${cycle.join(" -> ")}`,
          ),
        );
      }
      return;
    }

    state.set(questionId, "visiting");
    for (const dep of dependsOn.get(questionId) ?? []) {
      if (dep === questionId) continue;
      visit(dep, [...stack, questionId]);
    }
    state.set(questionId, "done");
  };

  for (const { question } of questions) {
    if (!state.has(question.id)) {
      visit(question.id, []);
    }
  }

  return errors;
}
