"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { type PortalFormField, type PortalFormSection, portalFormFieldTypes } from "@/lib/portal-forms";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database";
import { RepositoryError } from "@/server/events";
import { SpeakerOnboardingRepository } from "@/server/speakers";

import { taskDefinitionView } from "./model";
import type { MutationResult, OnboardingSnapshot, TaskResponseType } from "./types";
import { randomUUID } from "node:crypto";

const definitionSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120),
  description: z.string().trim().max(2_000, "Instructions must be 2,000 characters or fewer."),
  defaultDueOffsetDays: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(365)])
    .transform((value) => (value === "" ? null : value)),
  responseType: z.enum(["NONE", "TEXT", "FILE", "FORM"]),
  formDefinition: z.string().trim().max(12_000, "Form definition must be 12,000 characters or fewer."),
  confirmationSubject: z.string().trim().max(160),
  confirmationMessage: z.string().trim().max(2_000),
  sendConfirmationEmail: z.boolean(),
  confirmedOnly: z.boolean(),
  sessionKinds: z
    .string()
    .transform((value) => [
      ...new Set(
        value
          .split(",")
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
      ),
    ])
    .refine((items) => items.length <= 10, "Enter no more than 10 session kinds.")
    .refine(
      (items) => items.every((item) => /^[A-Z][A-Z0-9_]*$/.test(item)),
      "Use letters, numbers, and underscores for session kinds.",
    ),
});

class FormDefinitionError extends Error {}

function repository(): SpeakerOnboardingRepository {
  return new SpeakerOnboardingRepository(getDatabaseClient());
}

async function requireAdminSession(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication is required.");
}

async function snapshot(eventId: string): Promise<OnboardingSnapshot> {
  const definitions = await repository().listDefinitions(eventId, { includeArchived: true });
  return { eventId, definitions: definitions.map(taskDefinitionView) };
}

async function success(eventId: string, message: string): Promise<MutationResult> {
  revalidatePath("/dashboard/onboarding-tasks");
  return { ok: true, message, snapshot: await snapshot(eventId) };
}

function invalidResult(error: z.ZodError): MutationResult {
  return { ok: false, message: "Review the highlighted fields.", fieldErrors: error.flatten().fieldErrors };
}

function failureResult(error: unknown): MutationResult {
  if (error instanceof FormDefinitionError) {
    return { ok: false, message: "Review the highlighted fields.", fieldErrors: { formDefinition: [error.message] } };
  }
  if (error instanceof RepositoryError || (error instanceof Error && error.message === "Authentication is required.")) {
    return { ok: false, message: error.message };
  }
  console.error(error);
  return { ok: false, message: "The onboarding task could not be saved. Try again." };
}

function parseForm(formData: FormData) {
  return definitionSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    defaultDueOffsetDays: formData.get("defaultDueOffsetDays"),
    responseType: formData.get("responseType"),
    formDefinition: formData.get("formDefinition"),
    confirmationSubject: formData.get("confirmationSubject"),
    confirmationMessage: formData.get("confirmationMessage"),
    sendConfirmationEmail: formData.get("sendConfirmationEmail") === "on",
    confirmedOnly: formData.get("confirmedOnly") === "on",
    sessionKinds: formData.get("sessionKinds"),
  });
}

function formSections(source: string): PortalFormSection[] {
  const sections: PortalFormSection[] = [];
  let current: {
    title: string;
    instructions: string | null;
    fields: PortalFormField[];
  } | null = null;
  const priorFields: PortalFormField[] = [];
  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      const [title, instructions] = line
        .slice(1, -1)
        .split("::", 2)
        .map((part) => part.trim());
      if (!title) throw new FormDefinitionError(`Section on line ${index + 1} needs a title.`);
      current = { title, instructions: instructions || null, fields: [] };
      sections.push({ id: `section-${sections.length + 1}`, ...current });
      continue;
    }
    if (!current) throw new FormDefinitionError(`Add a [Section title] before the field on line ${index + 1}.`);
    const [label, rawType = "text", requiredFlag = "", reusableKey = "", rawVisibility = ""] = line
      .split("|")
      .map((part) => part.trim());
    const type = rawType.toLowerCase();
    if (!label) throw new FormDefinitionError(`Field on line ${index + 1} needs a label.`);
    if (!portalFormFieldTypes.some((candidate) => candidate === type)) {
      throw new FormDefinitionError(`Field on line ${index + 1} has an unsupported type.`);
    }
    let visibleWhen: PortalFormField["visibleWhen"] = null;
    if (rawVisibility !== "") {
      const match = /^when\s+(.+?)\s*=\s*(.+)$/i.exec(rawVisibility);
      if (!match) {
        throw new FormDefinitionError(`Field on line ${index + 1} needs a condition like when Attendance = Online.`);
      }
      const sourceLabel = match[1]?.trim().toLocaleLowerCase();
      const candidates = priorFields.filter(({ label: priorLabel }) => priorLabel.toLocaleLowerCase() === sourceLabel);
      const sourceField = candidates[0];
      if (candidates.length !== 1 || !sourceField) {
        throw new FormDefinitionError(`Field on line ${index + 1} must reference one uniquely named earlier field.`);
      }
      const comparison = match[2]?.trim() ?? "";
      if (sourceField.type === "checkbox") {
        const normalized = comparison.toLocaleLowerCase();
        if (!["checked", "true", "unchecked", "false"].includes(normalized)) {
          throw new FormDefinitionError(`Checkbox condition on line ${index + 1} must use checked or unchecked.`);
        }
        visibleWhen = { fieldId: sourceField.id, equals: normalized === "checked" || normalized === "true" };
      } else {
        visibleWhen = { fieldId: sourceField.id, equals: comparison };
      }
    }
    const field: PortalFormField = {
      id: `field-${sections.length}-${current.fields.length + 1}`,
      label,
      type: type as (typeof portalFormFieldTypes)[number],
      required: requiredFlag.toLowerCase() === "required",
      reusableKey: reusableKey || null,
      visibleWhen,
    };
    current.fields.push(field);
    priorFields.push(field);
  }
  if (sections.length === 0 || sections.some(({ fields }) => fields.length === 0)) {
    throw new FormDefinitionError("Every response form needs at least one section and every section needs a field.");
  }
  return sections;
}

function responseDefinition(
  responseType: TaskResponseType,
  options: {
    readonly formDefinition: string;
    readonly confirmationSubject: string;
    readonly confirmationMessage: string;
    readonly sendConfirmationEmail: boolean;
  },
): {
  readonly responseRequired: boolean;
  readonly responseSchema?: Prisma.InputJsonValue;
} {
  if (responseType === "TEXT") return { responseRequired: true, responseSchema: { type: "string", minLength: 1 } };
  if (responseType === "FILE") {
    return {
      responseRequired: true,
      responseSchema: {
        type: "object",
        required: ["objectKey"],
        properties: { objectKey: { type: "string", minLength: 1 } },
      },
    };
  }
  if (responseType === "FORM") {
    return {
      responseRequired: true,
      responseSchema: {
        kind: "portal-form",
        sections: formSections(options.formDefinition),
        confirmation: {
          subject: options.confirmationSubject || "Response received",
          message: options.confirmationMessage || "Thank you. Your response was submitted.",
          sendEmail: options.sendConfirmationEmail,
        },
      } as unknown as Prisma.InputJsonValue,
    };
  }
  return { responseRequired: false };
}

function definitionInput(value: z.infer<typeof definitionSchema>, sortOrder: number) {
  return {
    sortOrder,
    title: value.title,
    description: value.description || null,
    applicability: { confirmedOnly: value.confirmedOnly, sessionKinds: value.sessionKinds },
    defaultDueOffsetDays: value.defaultDueOffsetDays,
    ...responseDefinition(value.responseType, value),
  };
}

export async function createDefinition(eventId: string, formData: FormData): Promise<MutationResult> {
  const parsed = parseForm(formData);
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    await requireAdminSession();
    const tasks = repository();
    const definitions = await tasks.listDefinitions(eventId);
    await tasks.createDefinition({
      eventId,
      key: `task-${randomUUID()}`,
      ...definitionInput(parsed.data, definitions.length),
    });
    return success(eventId, "Onboarding task created.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function updateDefinition(
  eventId: string,
  definitionId: string,
  formData: FormData,
): Promise<MutationResult> {
  const parsed = parseForm(formData);
  if (!parsed.success) return invalidResult(parsed.error);
  try {
    await requireAdminSession();
    const tasks = repository();
    const definition = await tasks.getDefinition(eventId, definitionId);
    const latest = definition?.versions.at(-1);
    if (!definition || !latest || definition.archivedAt) {
      throw new RepositoryError("not-found", "The active event-owned task definition was not found.");
    }
    await tasks.createDefinitionVersion(eventId, definitionId, definitionInput(parsed.data, latest.sortOrder));
    return success(eventId, "Onboarding task updated.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function moveDefinition(eventId: string, definitionId: string, offset: -1 | 1): Promise<MutationResult> {
  try {
    await requireAdminSession();
    const tasks = repository();
    const definitions = await tasks.listDefinitions(eventId);
    const index = definitions.findIndex(({ id }) => id === definitionId);
    const destination = index + offset;
    if (index < 0 || destination < 0 || destination >= definitions.length) {
      return { ok: false, message: "That onboarding task cannot move any farther." };
    }
    const ids = definitions.map(({ id }) => id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    await tasks.reorderDefinitions(eventId, ids);
    return success(eventId, "Onboarding task order updated.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function archiveDefinition(eventId: string, definitionId: string): Promise<MutationResult> {
  try {
    await requireAdminSession();
    await repository().archiveDefinition(eventId, definitionId);
    return success(eventId, "Onboarding task archived.");
  } catch (error) {
    return failureResult(error);
  }
}

export async function duplicateDefinition(eventId: string, definitionId: string): Promise<MutationResult> {
  try {
    await requireAdminSession();
    await repository().duplicateDefinition(eventId, definitionId, `task-${randomUUID()}`);
    return success(eventId, "Onboarding task duplicated.");
  } catch (error) {
    return failureResult(error);
  }
}
