"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { parseCfpDefinition } from "@/lib/cfp";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

export interface SaveCfpQuestionsState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly versionNumber?: number;
  readonly errors?: readonly string[];
}

const requestSchema = z.object({
  eventSlug: z.string().trim().min(1),
  formId: z.uuid(),
  definition: z.string().max(250_000, "The question definition is too large."),
});

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveCfpQuestions(
  _previousState: SaveCfpQuestionsState,
  formData: FormData,
): Promise<SaveCfpQuestionsState> {
  const request = requestSchema.safeParse({
    eventSlug: stringValue(formData, "eventSlug"),
    formId: stringValue(formData, "formId"),
    definition: stringValue(formData, "definition"),
  });
  if (!request.success) {
    return { status: "error", message: "The question editor request is invalid." };
  }

  let rawDefinition: unknown;
  try {
    rawDefinition = JSON.parse(request.data.definition);
  } catch {
    return { status: "error", message: "The question definition is not valid JSON." };
  }

  const validation = parseCfpDefinition(rawDefinition);
  if (!validation.ok) {
    return {
      status: "error",
      message: "Fix the question definition before saving.",
      errors: validation.errors.map(({ path, message }) => `${path}: ${message}`),
    };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) {
    return { status: "error", message: "Your session expired. Sign in and try again." };
  }

  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: request.data.eventSlug },
    select: { id: true, slug: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    const saved = await new CfpFormRepository(client).createVersion(
      event.id,
      request.data.formId,
      validation.definition,
    );
    revalidatePath(`/dashboard/events/${event.slug}/cfp/forms/${saved.formId}/setup`);
    return {
      status: "success",
      message: `Questions saved as version ${saved.versionNumber}.`,
      versionNumber: saved.versionNumber,
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
