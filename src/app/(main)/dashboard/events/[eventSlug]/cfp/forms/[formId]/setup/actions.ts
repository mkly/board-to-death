"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CfpAdministratorRepository, CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

import { validateCfpPolicySettings } from "./schema";

export interface SaveCfpPolicySettingsState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveCfpPolicySettings(
  _previousState: SaveCfpPolicySettingsState,
  formData: FormData,
): Promise<SaveCfpPolicySettingsState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isAuthorizedAdminSession(session)) {
    return { status: "error", message: "Your session expired. Sign in and try again." };
  }

  const eventSlug = fieldValue(formData, "eventSlug");
  const formId = fieldValue(formData, "formId");
  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true, timezone: true },
  });
  if (!event) return { status: "error", message: "This event is not available." };

  const form = await new CfpFormRepository(client).get(event.id, formId);
  if (!form) return { status: "error", message: "This CFP form is not available for the selected event." };

  const validation = validateCfpPolicySettings(
    {
      submissionOpensAt: fieldValue(formData, "submissionOpensAt"),
      submissionClosesAt: fieldValue(formData, "submissionClosesAt"),
      draftPolicy: fieldValue(formData, "draftPolicy"),
      maxSubmissionsPerSpeaker: fieldValue(formData, "maxSubmissionsPerSpeaker"),
      maxParticipantsPerSubmission: fieldValue(formData, "maxParticipantsPerSubmission"),
    },
    event.timezone,
  );
  if (!validation.fields) {
    return { status: "error", message: "Fix the highlighted submission settings.", errors: validation.errors };
  }

  const policies = new CfpPolicyRepository(client);
  try {
    const existing = await policies.getByKey(event.id, form.key);
    const settings = validation.fields;
    if (existing) {
      await policies.createVersion(event.id, existing.id, {
        ...existing.definition,
        submissionOpensAt: settings.submissionOpensAtInstant,
        submissionClosesAt: settings.submissionClosesAtInstant,
        draftPolicy: settings.draftPolicy,
        submissionLimits: {
          maxSubmissionsPerSpeaker: settings.maxSubmissionsPerSpeaker,
          maxParticipantsPerSubmission: settings.maxParticipantsPerSubmission,
        },
      });
    } else {
      const administrator = await new CfpAdministratorRepository(client).ensure({
        eventId: event.id,
        externalId: session.user.email,
        displayName: session.user.name.trim() || session.user.email,
      });
      await policies.create({
        eventId: event.id,
        key: form.key,
        definition: {
          submissionOpensAt: settings.submissionOpensAtInstant,
          submissionClosesAt: settings.submissionClosesAtInstant,
          confirmationClosesAt: null,
          draftPolicy: settings.draftPolicy,
          submissionLimits: {
            maxSubmissionsPerSpeaker: settings.maxSubmissionsPerSpeaker,
            maxParticipantsPerSubmission: settings.maxParticipantsPerSubmission,
          },
          messages: {
            introduction: form.definition.description ?? `Submit a proposal for ${form.definition.title}.`,
            submissionConfirmation: "Your proposal has been submitted.",
            closed: "This call for proposals is closed.",
          },
          conditionalVisibility: [],
          categoryRouting: [],
          adminAssignments: [{ administratorId: administrator.id, role: "OWNER" }],
        },
      });
    }
    revalidatePath(`/dashboard/events/${event.slug}/cfp/forms/${form.formId}/setup`);
    return {
      status: "success",
      message: existing ? "Submission settings saved as a new version." : "Submission settings saved.",
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
