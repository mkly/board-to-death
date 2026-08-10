"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import {
  type ContactGroupKind,
  type CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldType,
} from "@/generated/prisma/client";
import {
  acceptContactGroupIntakeSubmission,
  closeContactGroupIntakeForm,
  publishContactGroupIntakeForm,
  rejectContactGroupIntakeSubmission,
} from "@/server/contacts/group-intake";
import {
  createContactGroup,
  createContactGroupTier,
  listContactGroupTiers,
  removeContactGroupTier,
  renameContactGroupTier,
  reorderContactGroupTiers,
  updateContactGroup,
} from "@/server/contacts/repositories";
import { storeCustomFieldFile } from "@/server/custom-fields/files";
import { parseCustomFieldFormData } from "@/server/custom-fields/form-values";
import { CustomFieldRepository, type CustomFieldTarget } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";

const KINDS: readonly ContactGroupKind[] = ["SPONSOR", "EXHIBITOR"];

async function requireAuthorizedEvent(eventSlug: string) {
  return (await requireAuthorizedEventContext(eventSlug)).event;
}

async function requireAuthorizedEventContext(eventSlug: string) {
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event || shell.activeEvent?.id !== event.id) notFound();
  return { event, reviewerId: shell.user.id };
}

function value(formData: FormData, name: string): string {
  const field = formData.get(name);
  return typeof field === "string" ? field.trim() : "";
}

function kindValue(formData: FormData): ContactGroupKind {
  const kind = value(formData, "kind");
  const parsed = KINDS.find((candidate) => candidate === kind);
  if (!parsed) throw new RepositoryError("invalid-input", "Choose sponsors or exhibitors.");
  return parsed;
}

function optionalId(formData: FormData, name: string): string | null {
  const id = value(formData, name);
  return id === "" || id === "unassigned" ? null : id;
}

function path(eventSlug: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/groups`;
}

function message(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  console.error(error);
  return "The group change could not be saved. Try again.";
}

function finish(eventSlug: string, notice: string): never {
  revalidatePath(path(eventSlug));
  revalidatePath(`/dashboard/events/${encodeURIComponent(eventSlug)}/communications/audience`);
  redirect(`${path(eventSlug)}?notice=${encodeURIComponent(notice)}`);
}

function fail(eventSlug: string, error: unknown): never {
  redirect(`${path(eventSlug)}?error=${encodeURIComponent(message(error))}`);
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

  const storage = getConfiguredFileStorage();
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
export async function createTierAction(eventSlug: string, formData: FormData): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await createContactGroupTier(getDatabaseClient(), {
      eventId: event.id,
      kind: kindValue(formData),
      name: value(formData, "name"),
    });
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, "Tier created.");
}

export async function renameTierAction(eventSlug: string, tierId: string, formData: FormData): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await renameContactGroupTier(getDatabaseClient(), event.id, tierId, value(formData, "name"));
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, "Tier renamed.");
}

export async function moveTierAction(eventSlug: string, tierId: string, direction: "up" | "down"): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    const client = getDatabaseClient();
    const selected = await client.contactGroupTier.findUnique({
      where: { eventId_id: { eventId: event.id, id: tierId } },
    });
    if (!selected) throw new RepositoryError("not-found", "The event-owned group tier was not found.");
    const tiers = [...(await listContactGroupTiers(client, event.id, selected.kind))];
    const index = tiers.findIndex(({ id }) => id === tierId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index >= 0 && target >= 0 && target < tiers.length) {
      const currentTier = tiers[index];
      const targetTier = tiers[target];
      if (!currentTier || !targetTier) throw new RepositoryError("not-found", "The tier order changed. Try again.");
      tiers[index] = targetTier;
      tiers[target] = currentTier;
      await reorderContactGroupTiers(
        client,
        event.id,
        selected.kind,
        tiers.map(({ id }) => id),
      );
    }
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, "Tier order updated.");
}

export async function removeTierAction(eventSlug: string, tierId: string): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await removeContactGroupTier(getDatabaseClient(), event.id, tierId);
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, "Tier removed.");
}

export async function createGroupAction(eventSlug: string, formData: FormData): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    const client = getDatabaseClient();
    const definitions = await new CustomFieldRepository(client).listDefinitions(
      event.id,
      CustomFieldEntityType.CONTACT_GROUP,
    );
    const group = await createContactGroup(client, {
      eventId: event.id,
      kind: kindValue(formData),
      name: value(formData, "name"),
      tierId: optionalId(formData, "tierId"),
      primaryContactId: optionalId(formData, "primaryContactId"),
    });
    await saveCustomFields({
      eventId: event.id,
      target: { entityType: CustomFieldEntityType.CONTACT_GROUP, groupId: group.id },
      definitions,
      formData,
      pathSegment: `groups/${group.id}`,
    });
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, "Group created.");
}

export async function updateGroupAction(eventSlug: string, groupId: string, formData: FormData): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    const client = getDatabaseClient();
    const definitions = await new CustomFieldRepository(client).listDefinitions(
      event.id,
      CustomFieldEntityType.CONTACT_GROUP,
    );
    const group = await updateContactGroup(client, event.id, groupId, {
      name: value(formData, "name"),
      tierId: optionalId(formData, "tierId"),
      primaryContactId: optionalId(formData, "primaryContactId"),
    });
    await saveCustomFields({
      eventId: event.id,
      target: { entityType: CustomFieldEntityType.CONTACT_GROUP, groupId: group.id },
      definitions,
      formData,
      pathSegment: `groups/${group.id}`,
    });
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, "Group updated.");
}

export async function publishIntakeFormAction(
  eventSlug: string,
  kind: ContactGroupKind,
  formData: FormData,
): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await publishContactGroupIntakeForm(getDatabaseClient(), event.id, kind, {
      title: value(formData, "title"),
      description: value(formData, "description"),
    });
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, `${kind === "SPONSOR" ? "Sponsor" : "Exhibitor"} intake form published.`);
}

export async function closeIntakeFormAction(eventSlug: string, kind: ContactGroupKind): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await closeContactGroupIntakeForm(getDatabaseClient(), event.id, kind);
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, `${kind === "SPONSOR" ? "Sponsor" : "Exhibitor"} intake form closed.`);
}

export async function reviewIntakeSubmissionAction(
  eventSlug: string,
  submissionId: string,
  decision: "accept" | "reject",
): Promise<never> {
  const { event, reviewerId } = await requireAuthorizedEventContext(eventSlug);
  try {
    if (decision === "accept") {
      await acceptContactGroupIntakeSubmission(getDatabaseClient(), event.id, submissionId, reviewerId);
    } else {
      await rejectContactGroupIntakeSubmission(getDatabaseClient(), event.id, submissionId, reviewerId);
    }
  } catch (error) {
    fail(event.slug, error);
  }
  return finish(event.slug, decision === "accept" ? "Intake submission accepted." : "Intake submission rejected.");
}
