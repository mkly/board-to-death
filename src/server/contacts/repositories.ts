import type {
  Contact,
  ContactGroup,
  ContactGroupKind,
  ContactGroupTier,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface CreateContactInput {
  readonly eventId: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organization?: string | null;
  readonly jobTitle?: string | null;
  readonly phone?: string | null;
}

export type UpdateContactInput = Partial<Omit<CreateContactInput, "eventId">>;

export interface CreateContactGroupInput {
  readonly eventId: string;
  readonly kind: ContactGroupKind;
  readonly name: string;
  readonly slug?: string;
  readonly tierId?: string | null;
  readonly primaryContactId?: string | null;
}

export type UpdateContactGroupInput = Partial<Omit<CreateContactGroupInput, "eventId" | "kind">>;

export interface ListContactsOptions {
  readonly includeArchived?: boolean;
}

export interface ListContactGroupsOptions extends ListContactsOptions {
  readonly kind?: ContactGroupKind;
  readonly tierIds?: readonly string[];
  readonly sortBy?: "name" | "tier";
}

export interface CreateContactGroupTierInput {
  readonly eventId: string;
  readonly kind: ContactGroupKind;
  readonly name: string;
}

export type ContactGroupWithDetails = Prisma.ContactGroupGetPayload<{
  include: { tier: true; primaryContact: true; members: { include: { contact: true } } };
}>;

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") invalid(`${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeEmail(value: string): string {
  const normalized = requiredText(value, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    invalid("email must be a valid address.");
  }
  return normalized;
}

/**
 * Groups are addressed by slug in portal URLs, so the slug has to survive round-tripping
 * through a path segment. Anything outside the safe set collapses to a single hyphen.
 */
export function slugifyGroupName(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") invalid("name must contain at least one alphanumeric character.");
  return slug;
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") {
      throw new RepositoryError("conflict", "A contact or group with that identity already exists for this event.");
    }
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "An event-owned contact reference was not found.");
    }
  }
  throw error;
}

export async function createContact(client: Prisma.TransactionClient, input: CreateContactInput): Promise<Contact> {
  try {
    return await client.contact.create({
      data: {
        eventId: input.eventId,
        email: normalizeEmail(input.email),
        givenName: requiredText(input.givenName, "givenName"),
        familyName: requiredText(input.familyName, "familyName"),
        organization: optionalText(input.organization),
        jobTitle: optionalText(input.jobTitle),
        phone: optionalText(input.phone),
      },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function updateContact(
  client: Prisma.TransactionClient,
  eventId: string,
  contactId: string,
  input: UpdateContactInput,
): Promise<Contact> {
  const data: Prisma.ContactUpdateInput = {};
  if (input.email !== undefined) data.email = normalizeEmail(input.email);
  if (input.givenName !== undefined) data.givenName = requiredText(input.givenName, "givenName");
  if (input.familyName !== undefined) data.familyName = requiredText(input.familyName, "familyName");
  if (input.organization !== undefined) data.organization = optionalText(input.organization);
  if (input.jobTitle !== undefined) data.jobTitle = optionalText(input.jobTitle);
  if (input.phone !== undefined) data.phone = optionalText(input.phone);

  try {
    // Scoping the update by the compound key keeps a contact id from one event
    // from ever resolving against another event's row.
    return await client.contact.update({ where: { eventId_id: { eventId, id: contactId } }, data });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function archiveContact(
  client: Prisma.TransactionClient,
  eventId: string,
  contactId: string,
): Promise<Contact> {
  try {
    return await client.contact.update({
      where: { eventId_id: { eventId, id: contactId } },
      data: { archivedAt: new Date() },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function listContacts(
  client: Prisma.TransactionClient,
  eventId: string,
  options: ListContactsOptions = {},
): Promise<readonly Contact[]> {
  return await client.contact.findMany({
    where: { eventId, ...(options.includeArchived === true ? {} : { archivedAt: null }) },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
  });
}

export async function createContactGroup(
  client: Prisma.TransactionClient,
  input: CreateContactGroupInput,
): Promise<ContactGroup> {
  const name = requiredText(input.name, "name");
  const slug = input.slug === undefined ? slugifyGroupName(name) : slugifyGroupName(input.slug);
  await requireGroupKindEnabled(client, input.eventId, input.kind);
  if (input.tierId) await requireMatchingTier(client, input.eventId, input.kind, input.tierId);
  if (input.primaryContactId) await requireContact(client, input.eventId, input.primaryContactId);
  try {
    const group = await client.contactGroup.create({
      data: {
        eventId: input.eventId,
        kind: input.kind,
        name,
        slug,
        tierId: input.tierId,
        primaryContactId: input.primaryContactId,
      },
    });
    if (input.primaryContactId) {
      await client.contactGroupMember.create({
        data: { eventId: input.eventId, groupId: group.id, contactId: input.primaryContactId },
      });
    }
    return group;
  } catch (error) {
    mapDatabaseError(error);
  }
}

async function requireContact(client: Prisma.TransactionClient, eventId: string, contactId: string): Promise<void> {
  const contact = await client.contact.findUnique({
    where: { eventId_id: { eventId, id: contactId } },
    select: { id: true },
  });
  if (!contact) throw new RepositoryError("not-found", "The event-owned contact was not found.");
}

async function requireMatchingTier(
  client: Prisma.TransactionClient,
  eventId: string,
  kind: ContactGroupKind,
  tierId: string,
): Promise<void> {
  const tier = await client.contactGroupTier.findUnique({
    where: { eventId_id: { eventId, id: tierId } },
    select: { kind: true },
  });
  if (!tier) throw new RepositoryError("not-found", "The event-owned group tier was not found.");
  if (tier.kind !== kind) invalid("The selected tier belongs to a different group kind.");
}

/**
 * Exhibitor and sponsor groups are separately switchable per event, and the admin UI
 * greys out a disabled kind. Enforce it here too so a direct call cannot create a group
 * the event has not turned on.
 */
async function requireGroupKindEnabled(
  client: Prisma.TransactionClient,
  eventId: string,
  kind: ContactGroupKind,
): Promise<void> {
  const event = await client.event.findUnique({
    where: { id: eventId },
    select: { exhibitorsEnabled: true, sponsorsEnabled: true },
  });
  if (!event) throw new RepositoryError("not-found", "The event was not found.");
  const enabled = kind === "EXHIBITOR" ? event.exhibitorsEnabled : event.sponsorsEnabled;
  if (!enabled) {
    throw new RepositoryError(
      "invalid-input",
      `${kind === "EXHIBITOR" ? "Exhibitors" : "Sponsors"} are not enabled for this event.`,
    );
  }
}

export async function updateContactGroup(
  client: Prisma.TransactionClient,
  eventId: string,
  groupId: string,
  input: UpdateContactGroupInput,
): Promise<ContactGroup> {
  const data: Prisma.ContactGroupUpdateInput = {};
  if (input.name !== undefined) data.name = requiredText(input.name, "name");
  if (input.slug !== undefined) data.slug = slugifyGroupName(input.slug);

  const group = await client.contactGroup.findUnique({
    where: { eventId_id: { eventId, id: groupId } },
    select: { kind: true },
  });
  if (!group) throw new RepositoryError("not-found", "The event-owned contact group was not found.");
  if (input.tierId) await requireMatchingTier(client, eventId, group.kind, input.tierId);
  if (input.primaryContactId) {
    await requireContact(client, eventId, input.primaryContactId);
    await client.contactGroupMember.upsert({
      where: { groupId_contactId: { groupId, contactId: input.primaryContactId } },
      create: { eventId, groupId, contactId: input.primaryContactId },
      update: {},
    });
  }
  if (input.tierId !== undefined)
    data.tier = input.tierId ? { connect: { eventId_id: { eventId, id: input.tierId } } } : { disconnect: true };
  if (input.primaryContactId !== undefined) {
    data.primaryContact = input.primaryContactId
      ? { connect: { eventId_id: { eventId, id: input.primaryContactId } } }
      : { disconnect: true };
  }

  try {
    return await client.contactGroup.update({ where: { eventId_id: { eventId, id: groupId } }, data });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function archiveContactGroup(
  client: Prisma.TransactionClient,
  eventId: string,
  groupId: string,
): Promise<ContactGroup> {
  try {
    return await client.contactGroup.update({
      where: { eventId_id: { eventId, id: groupId } },
      data: { archivedAt: new Date() },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function listContactGroups(
  client: Prisma.TransactionClient,
  eventId: string,
  options: ListContactGroupsOptions = {},
): Promise<readonly ContactGroupWithDetails[]> {
  return await client.contactGroup.findMany({
    where: {
      eventId,
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      ...(options.tierIds === undefined || options.tierIds.length === 0
        ? {}
        : { tierId: { in: [...options.tierIds] } }),
      ...(options.includeArchived === true ? {} : { archivedAt: null }),
    },
    include: { tier: true, primaryContact: true, members: { include: { contact: true } } },
    orderBy:
      options.sortBy === "tier"
        ? [{ kind: "asc" }, { tier: { sortOrder: "asc" } }, { name: "asc" }]
        : [{ kind: "asc" }, { name: "asc" }],
  });
}

export async function listContactGroupTiers(
  client: Prisma.TransactionClient,
  eventId: string,
  kind?: ContactGroupKind,
): Promise<readonly ContactGroupTier[]> {
  return client.contactGroupTier.findMany({
    where: { eventId, ...(kind ? { kind } : {}) },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createContactGroupTier(
  client: PrismaClient,
  input: CreateContactGroupTierInput,
): Promise<ContactGroupTier> {
  await requireGroupKindEnabled(client, input.eventId, input.kind);
  const name = requiredText(input.name, "name");
  try {
    return await client.$transaction(async (transaction) => {
      const last = await transaction.contactGroupTier.findFirst({
        where: { eventId: input.eventId, kind: input.kind },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      return transaction.contactGroupTier.create({
        data: { eventId: input.eventId, kind: input.kind, name, sortOrder: (last?.sortOrder ?? -1) + 1 },
      });
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function renameContactGroupTier(
  client: Prisma.TransactionClient,
  eventId: string,
  tierId: string,
  name: string,
): Promise<ContactGroupTier> {
  try {
    return await client.contactGroupTier.update({
      where: { eventId_id: { eventId, id: tierId } },
      data: { name: requiredText(name, "name") },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function reorderContactGroupTiers(
  client: PrismaClient,
  eventId: string,
  kind: ContactGroupKind,
  orderedTierIds: readonly string[],
): Promise<void> {
  if (new Set(orderedTierIds).size !== orderedTierIds.length) invalid("Each tier may appear only once.");
  await client.$transaction(async (transaction) => {
    const tiers = await transaction.contactGroupTier.findMany({ where: { eventId, kind }, select: { id: true } });
    if (tiers.length !== orderedTierIds.length || tiers.some(({ id }) => !orderedTierIds.includes(id))) {
      invalid("The tier order must include every tier for this group kind.");
    }
    await Promise.all(
      orderedTierIds.map((id, index) =>
        transaction.contactGroupTier.update({
          where: { eventId_id: { eventId, id } },
          data: { sortOrder: -index - 1 },
        }),
      ),
    );
    for (const [sortOrder, id] of orderedTierIds.entries()) {
      await transaction.contactGroupTier.update({ where: { eventId_id: { eventId, id } }, data: { sortOrder } });
    }
  });
}

export async function removeContactGroupTier(
  client: Prisma.TransactionClient,
  eventId: string,
  tierId: string,
): Promise<void> {
  const tier = await client.contactGroupTier.findUnique({
    where: { eventId_id: { eventId, id: tierId } },
    select: { _count: { select: { groups: true } } },
  });
  if (!tier) throw new RepositoryError("not-found", "The event-owned group tier was not found.");
  if (tier._count.groups > 0) invalid("Move groups out of this tier before removing it.");
  await client.contactGroupTier.delete({ where: { eventId_id: { eventId, id: tierId } } });
}

export async function addContactToGroup(
  client: Prisma.TransactionClient,
  eventId: string,
  groupId: string,
  contactId: string,
): Promise<void> {
  // Both sides are re-read under the event scope: a membership row is the one place
  // a contact from another event could otherwise be attached to this event's group.
  const [group, contact] = await Promise.all([
    client.contactGroup.findUnique({ where: { eventId_id: { eventId, id: groupId } }, select: { id: true } }),
    client.contact.findUnique({ where: { eventId_id: { eventId, id: contactId } }, select: { id: true } }),
  ]);
  if (!group) throw new RepositoryError("not-found", "The event-owned contact group was not found.");
  if (!contact) throw new RepositoryError("not-found", "The event-owned contact was not found.");

  try {
    await client.contactGroupMember.create({ data: { eventId, groupId, contactId } });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function removeContactFromGroup(
  client: Prisma.TransactionClient,
  eventId: string,
  groupId: string,
  contactId: string,
): Promise<void> {
  const result = await client.contactGroupMember.deleteMany({ where: { eventId, groupId, contactId } });
  if (result.count === 0) {
    throw new RepositoryError("not-found", "The contact is not a member of that group.");
  }
}

export async function listGroupMembers(
  client: Prisma.TransactionClient,
  eventId: string,
  groupId: string,
): Promise<readonly Contact[]> {
  const members = await client.contactGroupMember.findMany({
    where: { eventId, groupId, contact: { archivedAt: null } },
    include: { contact: true },
    orderBy: { contact: { familyName: "asc" } },
  });
  return members.map((member) => member.contact);
}
