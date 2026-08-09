"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { CfpAdminRole, CfpPolicyStatus } from "@/generated/prisma/client";
import { type CfpFormDefinition, validateCfpDefinitionForPublication } from "@/lib/cfp";
import { validateCfpMessageSettings } from "@/lib/cfp/messages";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CfpAdministratorRepository, CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository, type PersistedCfpFormDefinition } from "@/server/cfp/repositories";
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

export interface SaveCfpAdministratorsState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

export interface UpdateCfpPublicationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: readonly string[];
}

const administratorSettingsSchema = z
  .object({
    administratorIds: z.array(z.string().uuid()).min(1, "Assign at least one administrator."),
    newSubmissionAdministratorIds: z.array(z.string().uuid()),
    submissionUpdateAdministratorIds: z.array(z.string().uuid()),
  })
  .superRefine((input, context) => {
    const assigned = new Set(input.administratorIds);
    for (const administratorId of [...input.newSubmissionAdministratorIds, ...input.submissionUpdateAdministratorIds]) {
      if (!assigned.has(administratorId)) {
        context.addIssue({ code: "custom", message: "Alert recipients must also be assigned administrators." });
        break;
      }
    }
  });

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

export interface SaveCfpMessageSettingsState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
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
          adminAssignments: [
            {
              administratorId: administrator.id,
              role: "OWNER",
              notifyOnNewSubmission: false,
              notifyOnSubmissionUpdate: false,
            },
          ],
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

function defaultPolicyDates(startsAt: Date, timezone: string): { opensAt: Date; closesAt: Date } {
  const eventStart = Temporal.Instant.fromEpochMilliseconds(startsAt.getTime()).toZonedDateTimeISO(timezone);
  return {
    opensAt: new Date(eventStart.subtract({ days: 120 }).toInstant().epochMilliseconds),
    closesAt: new Date(eventStart.subtract({ days: 60 }).toInstant().epochMilliseconds),
  };
}

async function createPolicyForForm(
  event: { readonly id: string; readonly startsAt: Date; readonly timezone: string },
  form: PersistedCfpFormDefinition,
  administratorId: string,
  messages: {
    readonly remindersEnabled: boolean;
    readonly reminderDaysBeforeClose: number;
    readonly reminderSendAtMinute: number;
    readonly submissionConfirmation: string;
    readonly thankYou: string;
  },
): Promise<void> {
  const dates = defaultPolicyDates(event.startsAt, event.timezone);
  await new CfpPolicyRepository(getDatabaseClient()).create({
    eventId: event.id,
    key: form.key,
    definition: {
      submissionOpensAt: dates.opensAt,
      submissionClosesAt: dates.closesAt,
      confirmationClosesAt: null,
      draftPolicy: "ALLOWED",
      submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 },
      messages: {
        introduction: form.definition.description ?? `Submit a proposal for ${form.definition.title}.`,
        submissionConfirmation: messages.submissionConfirmation,
        closed: "This call for proposals is closed.",
        thankYou: messages.thankYou,
        reminder: {
          enabled: messages.remindersEnabled,
          daysBeforeClose: messages.reminderDaysBeforeClose,
          sendAtMinute: messages.reminderSendAtMinute,
        },
      },
      conditionalVisibility: [],
      categoryRouting: [],
      adminAssignments: [
        { administratorId, role: "OWNER", notifyOnNewSubmission: false, notifyOnSubmissionUpdate: false },
      ],
    },
  });
}

export async function saveCfpMessageSettings(
  eventSlug: string,
  formId: string,
  _previousState: SaveCfpMessageSettingsState,
  formData: FormData,
): Promise<SaveCfpMessageSettingsState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isAuthorizedAdminSession(session)) {
    return { status: "error", message: "Your session expired. Sign in and try again." };
  }

  const validation = validateCfpMessageSettings({
    remindersEnabled: value(formData, "remindersEnabled") === "true",
    reminderDaysBeforeClose: value(formData, "reminderDaysBeforeClose"),
    reminderSendAt: value(formData, "reminderSendAt"),
    submissionConfirmation: value(formData, "submissionConfirmation"),
    thankYou: value(formData, "thankYou"),
  });
  if (!validation.fields) {
    return { status: "error", message: "Fix the highlighted message settings.", errors: validation.errors };
  }
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event || shell.activeEvent?.id !== event.id) notFound();

  const client = getDatabaseClient();
  const form = await new CfpFormRepository(client).get(event.id, formId);
  if (!form) notFound();

  const policies = new CfpPolicyRepository(client);
  try {
    const existing = await policies.getByKey(event.id, form.key);
    if (existing) {
      await policies.createVersion(event.id, existing.id, {
        ...existing.definition,
        messages: {
          ...existing.definition.messages,
          submissionConfirmation: validation.fields.submissionConfirmation,
          thankYou: validation.fields.thankYou,
          reminder: {
            enabled: validation.fields.remindersEnabled,
            daysBeforeClose: validation.fields.reminderDaysBeforeClose,
            sendAtMinute: validation.fields.reminderSendAtMinute,
          },
        },
      });
    } else {
      const administrator = await new CfpAdministratorRepository(client).ensure({
        eventId: event.id,
        externalId: session.user.email,
        displayName: session.user.name.trim() || session.user.email,
      });
      await createPolicyForForm(event, form, administrator.id, validation.fields);
    }
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp/forms/${encodeURIComponent(formId)}/setup`);
    return {
      status: "success",
      message: existing ? "Message settings saved as a new version." : "Message settings saved.",
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function saveCfpAdministrators(
  eventSlug: string,
  formId: string,
  _previousState: SaveCfpAdministratorsState,
  formData: FormData,
): Promise<SaveCfpAdministratorsState> {
  const validation = administratorSettingsSchema.safeParse({
    administratorIds: formData.getAll("administratorIds"),
    newSubmissionAdministratorIds: formData.getAll("newSubmissionAdministratorIds"),
    submissionUpdateAdministratorIds: formData.getAll("submissionUpdateAdministratorIds"),
  });
  if (!validation.success) {
    return { status: "error", message: validation.error.issues[0]?.message ?? "Review the administrator settings." };
  }
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event || shell.activeEvent?.id !== event.id) notFound();

  const client = getDatabaseClient();
  const form = await new CfpFormRepository(client).get(event.id, formId);
  if (!form) notFound();
  const policies = new CfpPolicyRepository(client);
  const policy = await policies.getByKey(event.id, form.key);
  if (!policy) notFound();

  const currentAssignments = new Map(
    policy.definition.adminAssignments.map((assignment) => [assignment.administratorId, assignment]),
  );
  const notifyOnNewSubmission = new Set(validation.data.newSubmissionAdministratorIds);
  const notifyOnSubmissionUpdate = new Set(validation.data.submissionUpdateAdministratorIds);

  try {
    await policies.updateAdministratorAssignments(
      event.id,
      policy.id,
      shell.user.email.toLowerCase(),
      validation.data.administratorIds.map((administratorId) => ({
        administratorId,
        role: currentAssignments.get(administratorId)?.role ?? CfpAdminRole.EDITOR,
        notifyOnNewSubmission: notifyOnNewSubmission.has(administratorId),
        notifyOnSubmissionUpdate: notifyOnSubmissionUpdate.has(administratorId),
      })),
    );
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp`);
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp/forms/${encodeURIComponent(formId)}/setup`);
    return { status: "success", message: "Administrator assignments and alert preferences saved." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function updateCfpPublication(
  eventSlug: string,
  formId: string,
  expectedVersionNumber: number,
  _previousState: UpdateCfpPublicationState,
  formData: FormData,
): Promise<UpdateCfpPublicationState> {
  const intent = value(formData, "intent");
  if (intent !== "publish" && intent !== "close" && intent !== "reopen") {
    return { status: "error", message: "Choose a valid publication action." };
  }

  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event || shell.activeEvent?.id !== event.id) notFound();

  const client = getDatabaseClient();
  const form = await new CfpFormRepository(client).get(event.id, formId);
  if (!form) notFound();

  if (intent === "publish") {
    const issues = validateCfpDefinitionForPublication(form.definition);
    if (issues.length > 0) {
      return {
        status: "error",
        message: "Complete the saved form setup before publishing.",
        errors: issues.map(({ message }) => message),
      };
    }
  }

  const policies = new CfpPolicyRepository(client);
  try {
    if (intent === "publish") {
      await policies.publishByForm(event.id, formId, expectedVersionNumber, shell.user.email);
    } else {
      await policies.transitionByForm(
        event.id,
        formId,
        intent === "close" ? CfpPolicyStatus.CLOSED : CfpPolicyStatus.PUBLISHED,
        shell.user.email,
      );
    }
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp`);
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/cfp/forms/${encodeURIComponent(formId)}/setup`);
    let message = "CFP form reopened.";
    if (intent === "publish") message = "CFP form published.";
    if (intent === "close") message = "CFP form closed.";
    return {
      status: "success",
      message,
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
