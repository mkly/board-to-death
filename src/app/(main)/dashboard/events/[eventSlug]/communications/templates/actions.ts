"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { validateEmailTemplate } from "@/lib/communications/email-templates";
import { auth } from "@/server/auth/auth";
import { EmailTemplateRepository, type PersistedEmailTemplate } from "@/server/communications/templates";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

export interface SaveEmailTemplateState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly templateId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorsByField(issues: readonly { field: string; message: string }[]) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) errors[issue.field] = [...(errors[issue.field] ?? []), issue.message];
  return errors;
}

export async function saveEmailTemplate(
  _previousState: SaveEmailTemplateState,
  formData: FormData,
): Promise<SaveEmailTemplateState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { status: "error", message: "Your session expired. Sign in and try again." };

  const eventSlug = fieldValue(formData, "eventSlug");
  const templateId = fieldValue(formData, "templateId");
  const definition = {
    key: fieldValue(formData, "key"),
    name: fieldValue(formData, "name"),
    subjectTemplate: fieldValue(formData, "subjectTemplate"),
    bodyTemplate: fieldValue(formData, "bodyTemplate"),
    textTemplate: fieldValue(formData, "textTemplate"),
  };
  const validation = validateEmailTemplate(definition);
  if (!validation.ok) {
    return {
      status: "error",
      message: "Fix the highlighted template fields.",
      errors: errorsByField(validation.issues),
    };
  }

  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
  if (!event) return { status: "error", message: "This event is not available." };

  const repository = new EmailTemplateRepository(client);
  try {
    let saved: PersistedEmailTemplate;
    if (templateId === "") {
      saved = await repository.create({ eventId: event.id, ...validation.definition });
    } else {
      saved = await repository.createVersion(event.id, templateId, validation.definition);
    }
    revalidatePath(`/dashboard/events/${event.slug}/communications/templates`);
    return {
      status: "success",
      message: templateId === "" ? "Template created." : "Template saved as a new version.",
      templateId: saved.id,
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
