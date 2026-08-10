"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { z } from "zod";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { type CustomFieldDefinition, CustomFieldEntityType, CustomFieldType } from "@/generated/prisma/client";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { createContact, linkDirectoryPersonToEvent, updateContact } from "@/server/contacts/repositories";
import { storeCustomFieldFile } from "@/server/custom-fields/files";
import { parseCustomFieldFormData } from "@/server/custom-fields/form-values";
import { CustomFieldRepository, type CustomFieldTarget } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { createFileStorage } from "@/server/infrastructure";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";

export interface ContactRecordMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly recordId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const contactSchema = z.object({
  eventSlug: z.string().trim().min(1),
  contactId: z.union([z.literal(""), z.uuid("The selected contact is invalid.")]),
  email: z.email("Enter a valid email address."),
  givenName: z.string().trim().min(1, "Enter a first name.").max(100),
  familyName: z.string().trim().min(1, "Enter a last name.").max(100),
  organization: z.string().trim().max(200),
  jobTitle: z.string().trim().max(200),
  phone: z.string().trim().max(50),
});

function stringValue(formData: FormData, name: string): string {
  const entry = formData.get(name);
  return typeof entry === "string" ? entry : "";
}

function errors(error: z.ZodError): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    result[field] = [...(result[field] ?? []), issue.message];
  }
  return result;
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return null;
  return getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
}

function actionError(error: unknown): ContactRecordMutationState {
  if (error instanceof RepositoryError) return { status: "error", message: error.message };
  throw error;
}

async function saveCustomFields({
  eventId,
  target,
  definitions,
  formData,
  pathSegment,
}: {
  readonly eventId: string;
  readonly target: CustomFieldTarget;
  readonly definitions: readonly CustomFieldDefinition[];
  readonly formData: FormData;
  readonly pathSegment: string;
}): Promise<void> {
  const repository = new CustomFieldRepository(getDatabaseClient());
  const parsed = parseCustomFieldFormData(formData, definitions);
  const existing = await repository.listValues(eventId, target);
  const uploadedDefinitionIds = new Set(parsed.files.map(({ definition }) => definition.id));
  const missingRequiredFile = definitions.find(
    (definition) =>
      definition.type === CustomFieldType.FILE &&
      definition.required &&
      !uploadedDefinitionIds.has(definition.id) &&
      !existing.some(({ definitionId }) => definitionId === definition.id),
  );
  if (missingRequiredFile) throw new RepositoryError("invalid-input", `${missingRequiredFile.label} is required.`);

  for (const entry of parsed.values) {
    await repository.setValue(eventId, entry.definition.id, target, entry.value);
  }

  const storage = createFileStorage({ driver: "local", rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH });
  for (const { definition, file } of parsed.files) {
    const stored = await storeCustomFieldFile({
      eventId,
      definitionId: definition.id,
      fieldLabel: definition.label,
      pathSegment,
      file,
      storage,
    });
    try {
      await repository.setValue(eventId, definition.id, target, stored);
    } catch (error) {
      await storage.delete(stored.objectKey);
      throw error;
    }
    const previous = existing.find(({ definitionId }) => definitionId === definition.id)?.value;
    if (typeof previous === "object" && previous !== null && !Array.isArray(previous) && "objectKey" in previous) {
      const previousKey = previous.objectKey;
      if (typeof previousKey === "string" && previousKey !== stored.objectKey) await storage.delete(previousKey);
    }
  }
}

export async function saveContactRecord(
  _previousState: ContactRecordMutationState,
  formData: FormData,
): Promise<ContactRecordMutationState> {
  const parsed = contactSchema.safeParse({
    eventSlug: stringValue(formData, "eventSlug"),
    contactId: stringValue(formData, "contactId"),
    email: stringValue(formData, "email"),
    givenName: stringValue(formData, "givenName"),
    familyName: stringValue(formData, "familyName"),
    organization: stringValue(formData, "organization"),
    jobTitle: stringValue(formData, "jobTitle"),
    phone: stringValue(formData, "phone"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Review the highlighted contact fields.", errors: errors(parsed.error) };
  }
  const event = await authorizedEvent(parsed.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    const client = getDatabaseClient();
    const definitions = await new CustomFieldRepository(client).listDefinitions(
      event.id,
      CustomFieldEntityType.CONTACT,
    );
    const input = {
      email: parsed.data.email,
      givenName: parsed.data.givenName,
      familyName: parsed.data.familyName,
      organization: parsed.data.organization,
      jobTitle: parsed.data.jobTitle,
      phone: parsed.data.phone,
    };
    const contact =
      parsed.data.contactId === ""
        ? await createContact(client, { eventId: event.id, ...input })
        : await updateContact(client, event.id, parsed.data.contactId, input);
    await saveCustomFields({
      eventId: event.id,
      target: { entityType: CustomFieldEntityType.CONTACT, contactId: contact.id },
      definitions,
      formData,
      pathSegment: `contacts/${contact.id}`,
    });
    revalidatePath(`/dashboard/events/${event.slug}/contacts`);
    return {
      status: "success",
      message: parsed.data.contactId === "" ? "Contact created." : "Contact changes saved.",
      recordId: contact.id,
    };
  } catch (error) {
    return actionError(error);
  }
}

function contactsPath(eventSlug: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/contacts`;
}

export async function linkDirectoryPersonAction(eventSlug: string, personId: string): Promise<never> {
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event || shell.activeEvent?.id !== event.id) notFound();

  try {
    await linkDirectoryPersonToEvent(getDatabaseClient(), event.id, personId);
  } catch (error) {
    const message = error instanceof RepositoryError ? error.message : "The directory contact could not be linked.";
    redirect(`${contactsPath(event.slug)}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(contactsPath(event.slug));
  redirect(`${contactsPath(event.slug)}?notice=${encodeURIComponent("Contact added from the directory.")}`);
}
