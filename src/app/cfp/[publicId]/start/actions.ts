"use server";

import type { CfpFormDefinition } from "@/lib/cfp";
import { validateCfpAnswers } from "@/lib/cfp";
import { CfpPublicAccessRepository } from "@/server/cfp/public-access";
import { CfpCategoryRepository, CfpSubmissionRepository } from "@/server/cfp/submissions";
import { getDatabaseClient } from "@/server/database/client";

export interface PublicCfpFormActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
  readonly submissionId?: string;
}

function valuesFromFormData(definition: CfpFormDefinition, formData: FormData): Record<string, unknown> {
  const questions = definition.sections.flatMap((section) => section.questions);
  const values: Record<string, unknown> = {};
  for (const question of questions) {
    const name = `answer.${question.id}`;
    if (question.type === "checkbox") values[question.id] = formData.get(name) !== null;
    else if (question.type === "multi_select") values[question.id] = formData.getAll(name);
    else values[question.id] = formData.get(name) ?? undefined;
  }
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("answer.")) values[name.slice("answer.".length)] ??= value;
  }
  return values;
}

export async function submitPublicCfpForm(
  publicId: string,
  _previousState: PublicCfpFormActionState,
  formData: FormData,
): Promise<PublicCfpFormActionState> {
  const client = getDatabaseClient();
  const lookup = await new CfpPublicAccessRepository(client).findByPublicId(publicId);
  if (lookup.status !== "open") {
    return { status: "error", message: "This CFP is no longer accepting responses. Refresh the page to continue." };
  }
  const validation = validateCfpAnswers(lookup.form.definition, valuesFromFormData(lookup.form.definition, formData));
  const consentErrors: Readonly<Record<string, readonly string[]>> =
    lookup.form.consentRequired && formData.get("consent") === null ? { consent: ["Consent is required."] } : {};
  if (!validation.ok || Object.keys(consentErrors).length > 0) {
    return {
      status: "error",
      message: "Review the form and fix the highlighted questions.",
      errors: { ...(validation.ok ? {} : validation.errors), ...consentErrors },
    };
  }

  try {
    const categories = await new CfpCategoryRepository(client).list(lookup.event.id);
    const categoryByKey = new Map(categories.map((category) => [category.key, category.id]));
    const categoryIds = validation.categoryKeys.flatMap((key) => {
      const categoryId = categoryByKey.get(key);
      return categoryId ? [categoryId] : [];
    });
    if (categoryIds.length !== validation.categoryKeys.length) {
      return { status: "error", message: "This CFP has an invalid category configuration. Contact the organizer." };
    }
    const submission = await new CfpSubmissionRepository(client).createDraft({
      eventId: lookup.event.id,
      formVersionId: lookup.form.versionId,
      kind: lookup.form.definition.submissionKind ?? "ABSTRACT",
      answers: validation.answers,
      categoryIds,
    });
    return {
      status: "success",
      message: "Your responses were saved.",
      submissionId: submission.id,
    };
  } catch {
    return { status: "error", message: "Your responses could not be saved. Try again." };
  }
}
