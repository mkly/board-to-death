import type { CfpFormDefinition, CfpVisibilityRule } from "./types.ts";
import { evaluateCfpVisibilityRule, validateConditionForQuestion } from "./visibility.ts";

export interface CfpPolicyCategoryRoute {
  readonly categoryId: string;
  readonly condition: CfpVisibilityRule;
}

/** Validate category-routing rules against the form's live questions and the event's
 * live categories: unknown questions, incompatible operator/value pairs, categories the
 * route does not own, duplicate targets, and routes whose conditions are structurally
 * identical but target different categories. */
export function validateCfpPolicyCategoryRouting(
  routes: readonly CfpPolicyCategoryRoute[],
  definition: CfpFormDefinition,
  categoryIds: ReadonlySet<string>,
): string[] {
  const questions = new Map(
    definition.sections.flatMap((section) => section.questions.map((question) => [question.id, question] as const)),
  );
  const errors: string[] = [];
  const seenCategoryIds = new Set<string>();
  const conditionOwners = new Map<string, string>();

  routes.forEach((route, index) => {
    const label = `Route ${index + 1}`;

    if (!categoryIds.has(route.categoryId)) {
      errors.push(`${label}: category is not owned by this event.`);
    } else if (seenCategoryIds.has(route.categoryId)) {
      errors.push(`${label}: category already has a route configured.`);
    }
    seenCategoryIds.add(route.categoryId);

    if (route.condition.conditions.length === 0) {
      errors.push(`${label}: add at least one condition.`);
    }

    for (const condition of route.condition.conditions) {
      const question = questions.get(condition.questionId);
      if (!question) {
        errors.push(`${label}: references a question that is not part of this form.`);
        continue;
      }
      const conditionError = validateConditionForQuestion(condition, question);
      if (conditionError) errors.push(`${label}: ${conditionError}`);
    }

    const conditionKey = JSON.stringify({ logic: route.condition.logic, conditions: route.condition.conditions });
    const owner = conditionOwners.get(conditionKey);
    if (owner !== undefined && owner !== route.categoryId) {
      errors.push(`${label}: this condition conflicts with another route targeting a different category.`);
    } else {
      conditionOwners.set(conditionKey, route.categoryId);
    }
  });

  return errors;
}

/** Resolve the first route (in configured order) whose condition matches the given
 * answers, so ambiguous answers deterministically choose the earliest matching route. */
export function resolveCfpPolicyCategoryId(
  routes: readonly CfpPolicyCategoryRoute[],
  answers: Readonly<Record<string, unknown>>,
): string | null {
  const match = routes.find((route) => evaluateCfpVisibilityRule(route.condition, answers));
  return match?.categoryId ?? null;
}
