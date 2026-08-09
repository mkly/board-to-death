"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { z } from "zod";

import { CfpAdminRole } from "@/generated/prisma/client";
import type { CfpFormDefinition } from "@/lib/cfp";
import { CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

import { getDashboardShellData } from "../../../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../../../_lib/dashboard-shell";

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

type SetupStep = "setup" | "welcome" | "terms";

export interface SaveCfpSetupState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

export interface SaveCfpAdministratorsState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
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
  return termsSchema.safeParse({
    step,
    termsContent: value(formData, "termsContent"),
    consentRequired: value(formData, "consentRequired") === "true",
  });
}

function updatedDefinition(
  definition: CfpFormDefinition,
  input: z.infer<typeof setupSchema> | z.infer<typeof welcomeSchema> | z.infer<typeof termsSchema>,
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
