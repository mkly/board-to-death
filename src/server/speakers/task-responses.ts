import type { Prisma } from "@/generated/prisma/client";

import { parsePortalFormAnswers, parsePortalFormDefinition, validatePortalFormAnswers } from "../../lib/portal-forms.ts";
import { RepositoryError } from "../events/repositories.ts";

export type SpeakerTaskResponseKind = "CONFIRMATION" | "FILE" | "FORM" | "NONE" | "TEXT";

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function requiredProperties(schema: Readonly<Record<string, unknown>>): readonly string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
}

export function speakerTaskResponseKind(
  responseRequired: boolean,
  responseSchema: Prisma.JsonValue | null,
): SpeakerTaskResponseKind {
  if (!responseRequired) return "NONE";
  if (parsePortalFormDefinition(responseSchema) !== null) return "FORM";
  const schema = objectValue(responseSchema);
  if (schema?.type === "string") return "TEXT";
  if (schema?.type === "boolean") return "CONFIRMATION";
  if (schema?.type === "object") {
    const required = requiredProperties(schema);
    if (required.includes("objectKey")) return "FILE";
    if (required.includes("approved")) return "CONFIRMATION";
  }
  throw new RepositoryError("invalid-input", "This task has an unsupported response definition.");
}

export function normalizeSpeakerTaskResponse(
  responseRequired: boolean,
  responseSchema: Prisma.JsonValue | null,
  response: Prisma.InputJsonValue | undefined,
): Prisma.InputJsonValue | undefined {
  const kind = speakerTaskResponseKind(responseRequired, responseSchema);
  if (kind === "NONE") return undefined;

  if (kind === "TEXT") {
    if (typeof response !== "string" || response.trim() === "") {
      throw new RepositoryError("invalid-input", "A written response is required.");
    }
    const schema = objectValue(responseSchema);
    const minimum = typeof schema?.minLength === "number" ? schema.minLength : 1;
    const maximum = typeof schema?.maxLength === "number" ? schema.maxLength : 10_000;
    const normalized = response.trim();
    if (normalized.length < minimum || normalized.length > maximum) {
      throw new RepositoryError(
        "invalid-input",
        `The written response must be between ${minimum} and ${maximum} characters.`,
      );
    }
    return normalized;
  }

  if (kind === "FORM") {
    const form = parsePortalFormDefinition(responseSchema);
    if (!form) throw new RepositoryError("invalid-input", "This task has an unsupported response definition.");
    const answers = parsePortalFormAnswers(response ?? null);
    const errors = validatePortalFormAnswers(form, answers);
    if (Object.keys(errors).length > 0) {
      throw new RepositoryError("invalid-input", "Complete the required fields.");
    }
    return answers as Prisma.InputJsonValue;
  }

  const value = objectValue(response ?? null);
  if (kind === "CONFIRMATION") {
    if (response === true) return true;
    if (value?.approved === true) return { approved: true };
    throw new RepositoryError("invalid-input", "Confirmation is required before this task can be submitted.");
  }

  if (typeof value?.objectKey !== "string" || value.objectKey.trim() === "") {
    throw new RepositoryError("invalid-input", "A file is required.");
  }
  return response;
}
