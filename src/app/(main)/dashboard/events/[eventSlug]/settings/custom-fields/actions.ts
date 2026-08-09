"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { CustomFieldEntityType, CustomFieldType } from "@/generated/prisma/client";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CustomFieldRepository } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

export interface CustomFieldActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function value(formData: FormData, key: string): string {
  const input = formData.get(key);
  return typeof input === "string" ? input.trim() : "";
}

function enumValue<EnumValue extends string>(candidate: string, values: readonly EnumValue[]): EnumValue | null {
  return values.find((entry) => entry === candidate) ?? null;
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return null;
  return getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
}

function errorState(error: unknown): CustomFieldActionState {
  if (error instanceof RepositoryError) return { status: "error", message: error.message };
  throw error;
}

function refresh(eventSlug: string) {
  revalidatePath(`/dashboard/events/${eventSlug}/settings/custom-fields`);
  revalidatePath(`/dashboard/events/${eventSlug}/sessions`);
}

export async function createCustomField(
  eventSlug: string,
  _previousState: CustomFieldActionState,
  formData: FormData,
): Promise<CustomFieldActionState> {
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const entityType = enumValue(value(formData, "entityType"), Object.values(CustomFieldEntityType));
  const type = enumValue(value(formData, "type"), Object.values(CustomFieldType));
  if (!entityType || !type) return { status: "error", message: "Choose a supported record and field type." };
  const limitValue = value(formData, "characterLimit");
  try {
    await new CustomFieldRepository(getDatabaseClient()).createDefinition(event.id, {
      entityType,
      type,
      key: value(formData, "key"),
      label: value(formData, "label"),
      description: value(formData, "description"),
      required: formData.get("required") === "on",
      characterLimit: limitValue === "" ? null : Number(limitValue),
      options: value(formData, "options")
        .split("\n")
        .map((option) => option.trim())
        .filter(Boolean),
    });
    refresh(event.slug);
    return { status: "success", message: "Custom field created." };
  } catch (error) {
    return errorState(error);
  }
}

export async function updateCustomField(
  eventSlug: string,
  definitionId: string,
  _previousState: CustomFieldActionState,
  formData: FormData,
): Promise<CustomFieldActionState> {
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const type = enumValue(value(formData, "type"), Object.values(CustomFieldType));
  if (!type) return { status: "error", message: "Choose a supported field type." };
  const limitValue = value(formData, "characterLimit");
  try {
    await new CustomFieldRepository(getDatabaseClient()).updateDefinition(event.id, definitionId, {
      type,
      key: value(formData, "key"),
      label: value(formData, "label"),
      description: value(formData, "description"),
      required: formData.get("required") === "on",
      characterLimit: limitValue === "" ? null : Number(limitValue),
      options: value(formData, "options")
        .split("\n")
        .map((option) => option.trim())
        .filter(Boolean),
    });
    refresh(event.slug);
    return { status: "success", message: "Custom field updated." };
  } catch (error) {
    return errorState(error);
  }
}

export async function deleteCustomField(eventSlug: string, definitionId: string): Promise<CustomFieldActionState> {
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  try {
    await new CustomFieldRepository(getDatabaseClient()).deleteDefinition(event.id, definitionId);
    refresh(event.slug);
    return { status: "success", message: "Custom field deleted." };
  } catch (error) {
    return errorState(error);
  }
}

export async function moveCustomField(
  eventSlug: string,
  entityType: CustomFieldEntityType,
  orderedIds: readonly string[],
): Promise<CustomFieldActionState> {
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  try {
    await new CustomFieldRepository(getDatabaseClient()).reorderDefinitions(event.id, entityType, orderedIds);
    refresh(event.slug);
    return { status: "success", message: "Custom fields reordered." };
  } catch (error) {
    return errorState(error);
  }
}
