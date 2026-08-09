"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { z } from "zod";

import type { CfpFormDefinition } from "@/lib/cfp";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CfpAdministratorRepository, CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

import { getDashboardShellData } from "../../../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../../../_lib/dashboard-shell";
import { validateCfpPolicySettings } from "./schema";

const setupSchema = z.object({
  step: z.literal("setup"),
  title: z.string().trim().min(3, "Enter a form name with at least 3 characters.").max(120),
  submissionKind: z.enum(["ABSTRACT", "GUARANTEED_SESSION"], {
    error: "Choose the kind of submission this form accepts.",
  }),
  accessPolicy: z.enum(["OPEN", "RESTRICTED"], { error: "Choose who can access this form." }),
});

const welcomeSchema = z.object({
  step: z.literal("welcome"),
  welcomeTitle: z.string().trim().min(3, "Enter a welcome heading with at least 3 characters.").max(120),
  welcomeContent: z.string().trim().min(10, "Enter at least 10 characters for the welcome message.").max(4_000),
  instructions: z.string().trim().min(10, "Enter at least 10 characters of instructions.").max(4_000),
});

const speakerSchema = z
  .object({
    step: z.literal("speakers"),
    minimumSpeakerCount: z.coerce.number().int().min(1, "Require at least one speaker.").max(20),
    maximumSpeakerCount: z.coerce.number().int().min(1, "Allow at least one speaker.").max(20),
    biographyRequired: z.boolean(),
    contactRequired: z.boolean(),
    consentRequired: z.boolean(),
  })
  .superRefine(({ maximumSpeakerCount, minimumSpeakerCount }, context) => {
    if (minimumSpeakerCount > maximumSpeakerCount) {
      context.addIssue({
        code: "custom",
        path: ["maximumSpeakerCount"],
        message: "Maximum speakers must be greater than or equal to minimum speakers.",
      });
    }
  });

const termsSchema = z
  .object({
    step: z.literal("terms"),
    termsContent: z.string().trim().max(8_000),
    consentRequired: z.boolean(),
  })
  .superRefine(({ consentRequired, termsContent }, context) => {
    if (consentRequired && termsContent.length < 10) {
      context.addIssue({
        code: "custom",
        path: ["termsContent"],
        message: "Enter at least 10 characters of terms when consent is required.",
      });
    }
  });

type SetupStep = "setup" | "speakers" | "welcome" | "terms";

export interface SaveCfpSetupState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

function value(formData: FormData, name: string): string {
  const result = formData.get(name);
  return typeof result === "string" ? result : "";
}

function validationInput(formData: FormData) {
  const step = value(formData, "step") as SetupStep;
  if (step === "setup") {
    return setupSchema.safeParse({
      step,
      title: value(formData, "title"),
      submissionKind: value(formData, "submissionKind"),
      accessPolicy: value(formData, "accessPolicy"),
    });
  }
  if (step === "welcome") {
    return welcomeSchema.safeParse({
      step,
      welcomeTitle: value(formData, "welcomeTitle"),
      welcomeContent: value(formData, "welcomeContent"),
      instructions: value(formData, "instructions"),
    });
  }
  if (step === "speakers") {
    return speakerSchema.safeParse({
      step,
      minimumSpeakerCount: value(formData, "minimumSpeakerCount"),
      maximumSpeakerCount: value(formData, "maximumSpeakerCount"),
      biographyRequired: value(formData, "biographyRequired") === "true",
      contactRequired: value(formData, "contactRequired") === "true",
      consentRequired: value(formData, "speakerConsentRequired") === "true",
    });
  }
  return termsSchema.safeParse({
    step,
    termsContent: value(formData, "termsContent"),
    consentRequired: value(formData, "consentRequired") === "true",
  });
}

function updatedDefinition(
  definition: CfpFormDefinition,
  input:
    | z.infer<typeof setupSchema>
    | z.infer<typeof speakerSchema>
    | z.infer<typeof welcomeSchema>
    | z.infer<typeof termsSchema>,
): CfpFormDefinition {
  if (input.step === "setup") {
    return {
      ...definition,
      title: input.title,
      submissionKind: input.submissionKind,
      accessPolicy: input.accessPolicy,
    };
  }
  if (input.step === "welcome") {
    return {
      ...definition,
      welcomeTitle: input.welcomeTitle,
      welcomeContent: input.welcomeContent,
      instructions: input.instructions,
    };
  }
  if (input.step === "speakers") {
    return {
      ...definition,
      minimumSpeakerCount: input.minimumSpeakerCount,
      maximumSpeakerCount: input.maximumSpeakerCount,
      requiredSpeakerFields: [
        ...(input.biographyRequired ? (["biography"] as const) : []),
        ...(input.contactRequired ? (["contact"] as const) : []),
        ...(input.consentRequired ? (["consent"] as const) : []),
      ],
    };
  }
  return {
    ...definition,
    termsContent: input.termsContent,
    consentRequired: input.consentRequired,
  };
}

export async function saveCfpSetupStep(
  eventSlug: string,
  formId: string,
  _previousState: SaveCfpSetupState,
  formData: FormData,
): Promise<SaveCfpSetupState> {
  const validation = validationInput(formData);
  if (!validation.success) {
    return {
      status: "error",
      message: "Fix the highlighted fields before continuing.",
      errors: validation.error.flatten().fieldErrors,
    };
  }

  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event || shell.activeEvent?.id !== event.id) notFound();

  const repository = new CfpFormRepository(getDatabaseClient());
  const current = await repository.get(event.id, formId);
  if (!current) notFound();

  try {
    await repository.createVersion(event.id, formId, updatedDefinition(current.definition, validation.data));
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp`);
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp/forms/${encodeURIComponent(formId)}/setup`);
    return { status: "success", message: "Changes saved as a new draft version." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export interface SaveCfpPolicySettingsState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

export async function saveCfpPolicySettings(
  _previousState: SaveCfpPolicySettingsState,
  formData: FormData,
): Promise<SaveCfpPolicySettingsState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isAuthorizedAdminSession(session)) {
    return { status: "error", message: "Your session expired. Sign in and try again." };
  }

  const eventSlug = value(formData, "eventSlug");
  const formId = value(formData, "formId");
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
      submissionOpensAt: value(formData, "submissionOpensAt"),
      submissionClosesAt: value(formData, "submissionClosesAt"),
      draftPolicy: value(formData, "draftPolicy"),
      maxSubmissionsPerSpeaker: value(formData, "maxSubmissionsPerSpeaker"),
      maxParticipantsPerSubmission: value(formData, "maxParticipantsPerSubmission"),
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
    revalidatePath(
      `/dashboard/events/${encodeURIComponent(event.slug)}/cfp/forms/${encodeURIComponent(form.formId)}/setup`,
    );
    return {
      status: "success",
      message: existing ? "Submission settings saved as a new version." : "Submission settings saved.",
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
