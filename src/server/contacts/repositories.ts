import type {
  Contact,
  ContactGroup,
  ContactGroupKind,
  ContactGroupTier,
  Person,
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

export interface DirectoryPersonSummary extends Person {
  readonly linkedEventIds: readonly string[];
}

export interface DirectoryPeopleFilters {
  readonly query?: string;
  readonly organization?: string;
  readonly jobTitle?: string;
  readonly eventId?: string;
}

export interface DirectoryPersonEventLink {
  readonly contact: Contact;
  readonly event: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly startsAt: Date;
  };
  readonly relationship: "new" | "returning";
}

export interface DirectoryPersonProfile {
  readonly person: Person;
  readonly events: readonly DirectoryPersonEventLink[];
}

export interface DirectoryDuplicatePerson {
  readonly id: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organization: string | null;
  readonly jobTitle: string | null;
  readonly eventCount: number;
  readonly noteCount: number;
}

export interface DirectoryDuplicateMatch {
  readonly people: readonly [DirectoryDuplicatePerson, DirectoryDuplicatePerson];
  readonly reasons: readonly ("email" | "name")[];
}

export interface CreateContactGroupTierInput {
  readonly eventId: string;
  readonly kind: ContactGroupKind;
  readonly name: string;
}

export type ContactGroupWithDetails = Prisma.ContactGroupGetPayload<{
  include: { tier: true; primaryContact: true; members: { include: { contact: true } } };
}>;

const contactProgramSessionParticipationInclude = {
  sessionVersion: { include: { session: true } },
  speaker: true,
} as const satisfies Prisma.ProgramSessionParticipantInclude;

export type ContactProgramSessionParticipation = Prisma.ProgramSessionParticipantGetPayload<{
  include: typeof contactProgramSessionParticipationInclude;
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

function normalizeDuplicatePart(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function duplicateReasons(
  first: Pick<Person, "email" | "givenName" | "familyName">,
  second: Pick<Person, "email" | "givenName" | "familyName">,
): readonly ("email" | "name")[] {
  const reasons: ("email" | "name")[] = [];
  if (normalizeDuplicatePart(first.email) === normalizeDuplicatePart(second.email)) reasons.push("email");
  if (
    normalizeDuplicatePart(first.givenName) === normalizeDuplicatePart(second.givenName) &&
    normalizeDuplicatePart(first.familyName) === normalizeDuplicatePart(second.familyName)
  ) {
    reasons.push("name");
  }
  return reasons;
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
  const email = normalizeEmail(input.email);
  const givenName = requiredText(input.givenName, "givenName");
  const familyName = requiredText(input.familyName, "familyName");
  const organization = optionalText(input.organization);
  const jobTitle = optionalText(input.jobTitle);
  const phone = optionalText(input.phone);

  try {
    const event = await client.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { orgId: true } });
    const person = await client.person.upsert({
      where: { orgId_email: { orgId: event.orgId, email } },
      update: {},
      create: { orgId: event.orgId, email, givenName, familyName, organization, jobTitle, phone },
    });
    return await client.contact.create({
      data: {
        eventId: input.eventId,
        personId: person.id,
        email,
        givenName,
        familyName,
        organization,
        jobTitle,
        phone,
      },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

/** Search the person directory of the organization that owns the given event. */
export async function searchDirectoryPeople(
  client: Prisma.TransactionClient,
  eventId: string,
  input: string | DirectoryPeopleFilters,
): Promise<readonly DirectoryPersonSummary[]> {
  const event = await client.event.findUniqueOrThrow({ where: { id: eventId }, select: { orgId: true } });
  const filters = typeof input === "string" ? { query: input } : input;
  const query = filters.query?.trim() ?? "";
  const organization = filters.organization?.trim() ?? "";
  const jobTitle = filters.jobTitle?.trim() ?? "";
  const participatedEventId = filters.eventId?.trim() ?? "";
  const and: Prisma.PersonWhereInput[] = [];
  if (query !== "") {
    and.push({
      OR: [
        { email: { contains: query, mode: "insensitive" } },
        { givenName: { contains: query, mode: "insensitive" } },
        { familyName: { contains: query, mode: "insensitive" } },
        { organization: { contains: query, mode: "insensitive" } },
      ],
    });
  }
  if (organization !== "") and.push({ organization: { contains: organization, mode: "insensitive" } });
  if (jobTitle !== "") and.push({ jobTitle: { contains: jobTitle, mode: "insensitive" } });
  if (participatedEventId !== "") {
    and.push({ contacts: { some: { eventId: participatedEventId, archivedAt: null } } });
  }
  const people = await client.person.findMany({
    where: { orgId: event.orgId, AND: and },
    include: { contacts: { where: { archivedAt: null }, select: { eventId: true } } },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    take: 200,
  });

  return people.map(({ contacts, ...person }) => ({
    ...person,
    linkedEventIds: contacts.map(({ eventId }) => eventId),
  }));
}

/** Surface exact email and full-name matches inside the event owner's organization. */
export async function listDirectoryDuplicateMatches(
  client: Prisma.TransactionClient,
  eventId: string,
): Promise<readonly DirectoryDuplicateMatch[]> {
  const event = await client.event.findUniqueOrThrow({ where: { id: eventId }, select: { orgId: true } });
  const people = await client.person.findMany({
    where: { orgId: event.orgId },
    include: {
      contacts: { where: { archivedAt: null }, select: { id: true } },
      prospects: {
        select: { activities: { where: { note: { not: null } }, select: { id: true } } },
      },
    },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }, { email: "asc" }],
  });

  const matches: DirectoryDuplicateMatch[] = [];
  for (const [index, first] of people.entries()) {
    for (const second of people.slice(index + 1)) {
      const reasons = duplicateReasons(first, second);
      if (reasons.length === 0) continue;
      const { contacts: firstContacts, prospects: firstProspects, ...firstPerson } = first;
      const { contacts: secondContacts, prospects: secondProspects, ...secondPerson } = second;
      matches.push({
        people: [
          {
            ...firstPerson,
            eventCount: firstContacts.length,
            noteCount: firstProspects.reduce((count, prospect) => count + prospect.activities.length, 0),
          },
          {
            ...secondPerson,
            eventCount: secondContacts.length,
            noteCount: secondProspects.reduce((count, prospect) => count + prospect.activities.length, 0),
          },
        ],
        reasons,
      });
    }
  }
  return matches;
}

async function mergeContactRows(
  client: Prisma.TransactionClient,
  source: Pick<Contact, "id" | "eventId">,
  target: Pick<Contact, "id" | "eventId">,
): Promise<void> {
  const memberships = await client.contactGroupMember.findMany({
    where: { eventId: source.eventId, contactId: source.id },
    select: { groupId: true },
  });
  if (memberships.length > 0) {
    await client.contactGroupMember.createMany({
      data: memberships.map(({ groupId }) => ({ eventId: target.eventId, groupId, contactId: target.id })),
      skipDuplicates: true,
    });
    await client.contactGroupMember.deleteMany({ where: { eventId: source.eventId, contactId: source.id } });
  }

  await Promise.all([
    client.contactGroup.updateMany({
      where: { eventId: source.eventId, primaryContactId: source.id },
      data: { primaryContactId: target.id },
    }),
    client.contactGroupIntakeSubmission.updateMany({
      where: { eventId: source.eventId, acceptedContactId: source.id },
      data: { acceptedContactId: target.id },
    }),
    client.fileRequestFile.updateMany({
      where: { uploadedByContactId: source.id },
      data: { uploadedByContactId: target.id },
    }),
    client.fileRequestFulfillmentLink.updateMany({
      where: { contactId: source.id },
      data: { contactId: target.id },
    }),
  ]);

  const assignments = await client.fileRequestAssignment.findMany({
    where: { eventId: source.eventId, contactId: source.id },
    select: { id: true, requestId: true },
  });
  for (const assignment of assignments) {
    const targetAssignment = await client.fileRequestAssignment.findUnique({
      where: { requestId_contactId: { requestId: assignment.requestId, contactId: target.id } },
      select: { id: true },
    });
    if (!targetAssignment) {
      await client.fileRequestAssignment.update({ where: { id: assignment.id }, data: { contactId: target.id } });
      continue;
    }
    await Promise.all([
      client.fileRequestFile.updateMany({
        where: { assignmentId: assignment.id },
        data: { assignmentId: targetAssignment.id },
      }),
      client.fileRequestFulfillmentLink.updateMany({
        where: { assignmentId: assignment.id },
        data: { assignmentId: targetAssignment.id, contactId: target.id },
      }),
    ]);
    await client.fileRequestAssignment.delete({ where: { id: assignment.id } });
  }

  const values = await client.customFieldValue.findMany({
    where: { eventId: source.eventId, contactId: source.id },
    select: { id: true, definitionId: true },
  });
  for (const value of values) {
    const targetValue = await client.customFieldValue.findUnique({
      where: { definitionId_contactId: { definitionId: value.definitionId, contactId: target.id } },
      select: { id: true },
    });
    if (targetValue) await client.customFieldValue.delete({ where: { id: value.id } });
    else await client.customFieldValue.update({ where: { id: value.id }, data: { contactId: target.id } });
  }

  // Keep the old event snapshot as an archived audit record after its live relationships move.
  await client.contact.update({
    where: { eventId_id: { eventId: source.eventId, id: source.id } },
    data: { personId: null, archivedAt: new Date() },
  });
}

async function moveProgramSessionParticipations(
  client: Prisma.TransactionClient,
  eventId: string,
  sourceSpeakerId: string,
  targetSpeakerId: string,
): Promise<number> {
  const sourceParticipations = await client.programSessionParticipant.findMany({
    where: { eventId, speakerId: sourceSpeakerId },
    select: { sessionVersionId: true },
  });
  for (const participation of sourceParticipations) {
    const targetParticipation = await client.programSessionParticipant.findUnique({
      where: {
        sessionVersionId_speakerId: {
          sessionVersionId: participation.sessionVersionId,
          speakerId: targetSpeakerId,
        },
      },
      select: { speakerId: true },
    });
    if (targetParticipation) {
      await client.programSessionParticipant.delete({
        where: {
          sessionVersionId_speakerId: {
            sessionVersionId: participation.sessionVersionId,
            speakerId: sourceSpeakerId,
          },
        },
      });
    } else {
      await client.programSessionParticipant.update({
        where: {
          sessionVersionId_speakerId: {
            sessionVersionId: participation.sessionVersionId,
            speakerId: sourceSpeakerId,
          },
        },
        data: { speakerId: targetSpeakerId },
      });
    }
  }
  return sourceParticipations.length;
}

/** Merge one likely duplicate into a chosen primary while retaining cross-event history and notes. */
export async function mergeDirectoryPeople(
  client: PrismaClient,
  eventId: string,
  primaryPersonId: string,
  duplicatePersonId: string,
): Promise<Person> {
  if (primaryPersonId === duplicatePersonId) invalid("Choose two different directory people to merge.");

  try {
    return await client.$transaction(
      async (transaction) => {
        const event = await transaction.event.findUnique({ where: { id: eventId }, select: { orgId: true } });
        if (!event) throw new RepositoryError("not-found", "The event was not found.");
        const [primary, duplicate] = await Promise.all([
          transaction.person.findFirst({ where: { id: primaryPersonId, orgId: event.orgId } }),
          transaction.person.findFirst({ where: { id: duplicatePersonId, orgId: event.orgId } }),
        ]);
        if (!primary || !duplicate) {
          throw new RepositoryError("not-found", "A directory person was not found in this organization.");
        }
        if (duplicateReasons(primary, duplicate).length === 0) {
          invalid("These people no longer match by email or full name.");
        }

        const sourceContacts = await transaction.contact.findMany({ where: { personId: duplicate.id } });
        for (const sourceContact of sourceContacts) {
          const targetContact = await transaction.contact.findUnique({
            where: { eventId_personId: { eventId: sourceContact.eventId, personId: primary.id } },
          });
          if (targetContact) await mergeContactRows(transaction, sourceContact, targetContact);
          else {
            await transaction.contact.update({
              where: { eventId_id: { eventId: sourceContact.eventId, id: sourceContact.id } },
              data: { personId: primary.id },
            });
          }
        }

        const sourceProspects = await transaction.speakerProspect.findMany({ where: { personId: duplicate.id } });
        for (const sourceProspect of sourceProspects) {
          const targetProspect = await transaction.speakerProspect.findUnique({
            where: { eventId_personId: { eventId: sourceProspect.eventId, personId: primary.id } },
            select: { id: true },
          });
          if (!targetProspect) {
            await transaction.speakerProspect.update({
              where: { id: sourceProspect.id },
              data: { personId: primary.id },
            });
            continue;
          }
          await transaction.speakerProspectActivity.updateMany({
            where: { eventId: sourceProspect.eventId, prospectId: sourceProspect.id },
            data: { prospectId: targetProspect.id },
          });
          await transaction.speakerProspect.delete({ where: { id: sourceProspect.id } });
        }

        const sourceSpeakers = await transaction.speaker.findMany({
          where: { personId: duplicate.id },
          select: { id: true, eventId: true },
        });
        for (const sourceSpeaker of sourceSpeakers) {
          const targetSpeaker = await transaction.speaker.findUnique({
            where: { eventId_personId: { eventId: sourceSpeaker.eventId, personId: primary.id } },
            select: { id: true },
          });
          if (!targetSpeaker) {
            await transaction.speaker.update({
              where: { id: sourceSpeaker.id },
              data: { personId: primary.id },
              select: { id: true },
            });
            continue;
          }
          await moveProgramSessionParticipations(
            transaction,
            sourceSpeaker.eventId,
            sourceSpeaker.id,
            targetSpeaker.id,
          );
          await transaction.speaker.update({
            where: { id: sourceSpeaker.id },
            data: { personId: null },
            select: { id: true },
          });
        }

        await transaction.person.delete({ where: { id: duplicate.id } });
        return primary;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    mapDatabaseError(error);
  }
}

async function reviveContact(client: Prisma.TransactionClient, contactId: string, personId: string): Promise<Contact> {
  try {
    return await client.contact.update({ where: { id: contactId }, data: { personId, archivedAt: null } });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function linkDirectoryPersonToEvent(
  client: Prisma.TransactionClient,
  eventId: string,
  personId: string,
): Promise<Contact> {
  const person = await client.person.findUnique({ where: { id: personId } });
  if (!person) throw new RepositoryError("not-found", "The directory person was not found.");

  // An archived row still occupies this event's (eventId, personId) and (eventId, email) slots, so
  // re-adding the person has to revive that row: listContacts hides archived contacts, and leaving it
  // archived would report a successful link that never appears in the event.
  const linked = await client.contact.findUnique({ where: { eventId_personId: { eventId, personId } } });
  if (linked) return linked.archivedAt === null ? linked : await reviveContact(client, linked.id, personId);

  const legacyContact = await client.contact.findUnique({ where: { eventId_email: { eventId, email: person.email } } });
  if (legacyContact) return await reviveContact(client, legacyContact.id, personId);

  try {
    return await client.contact.create({
      data: {
        eventId,
        personId,
        email: person.email,
        givenName: person.givenName,
        familyName: person.familyName,
        organization: person.organization,
        jobTitle: person.jobTitle,
        phone: person.phone,
      },
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}

export async function getDirectoryPersonProfile(
  client: Prisma.TransactionClient,
  personId: string,
): Promise<DirectoryPersonProfile | null> {
  const person = await client.person.findUnique({
    where: { id: personId },
    include: {
      contacts: {
        where: { archivedAt: null },
        include: { event: { select: { id: true, name: true, slug: true, startsAt: true } } },
        orderBy: [{ event: { startsAt: "asc" } }, { createdAt: "asc" }],
      },
    },
  });
  if (!person) return null;

  const { contacts, ...directoryPerson } = person;
  return {
    person: directoryPerson,
    events: contacts.map(({ event, ...contact }, index) => ({
      contact,
      event,
      relationship: index === 0 ? "new" : "returning",
    })),
  };
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

export async function listContactProgramSessionParticipations(
  client: Prisma.TransactionClient,
  eventId: string,
  contactId: string,
): Promise<readonly ContactProgramSessionParticipation[]> {
  const contact = await client.contact.findUnique({
    where: { eventId_id: { eventId, id: contactId } },
    select: { personId: true },
  });
  if (!contact) throw new RepositoryError("not-found", "The event-owned contact was not found.");
  if (!contact.personId) return [];

  const participations = await client.programSessionParticipant.findMany({
    where: { eventId, speaker: { personId: contact.personId } },
    include: contactProgramSessionParticipationInclude,
    orderBy: [{ sessionVersion: { createdAt: "asc" } }, { sortOrder: "asc" }],
  });
  if (participations.length === 0) return [];

  // Editing a session writes a new version and keeps the superseded ones, so a participant row
  // survives for every version the person ever appeared in. Only the highest-numbered version of
  // each session describes the current lineup; without this filter one edited session reports
  // several participations and a removed speaker keeps reporting one.
  const currentVersionIds = await currentSessionVersionIds(
    client,
    eventId,
    participations.map(({ sessionVersion }) => sessionVersion.sessionId),
  );
  return participations.filter(({ sessionVersionId }) => currentVersionIds.has(sessionVersionId));
}

async function currentSessionVersionIds(
  client: Prisma.TransactionClient,
  eventId: string,
  sessionIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const versions = await client.programSessionVersion.findMany({
    where: { eventId, sessionId: { in: [...new Set(sessionIds)] } },
    select: { id: true, sessionId: true, versionNumber: true },
  });
  const current = new Map<string, { id: string; versionNumber: number }>();
  for (const version of versions) {
    const previous = current.get(version.sessionId);
    if (!previous || version.versionNumber > previous.versionNumber) current.set(version.sessionId, version);
  }
  return new Set([...current.values()].map(({ id }) => id));
}

/**
 * Move the source contact's program participation identity to the target contact.
 * When both identities already occur in one session version, the target row wins;
 * deleting the source row avoids both participant-key and participant-order conflicts.
 */
export async function reassignContactProgramSessionParticipations(
  client: PrismaClient,
  eventId: string,
  sourceContactId: string,
  targetContactId: string,
): Promise<number> {
  if (sourceContactId === targetContactId) invalid("Source and target contacts must be different.");

  try {
    return await client.$transaction(
      async (transaction) => {
        const [sourceContact, targetContact] = await Promise.all([
          transaction.contact.findUnique({
            where: { eventId_id: { eventId, id: sourceContactId } },
            select: { personId: true },
          }),
          transaction.contact.findUnique({
            where: { eventId_id: { eventId, id: targetContactId } },
            select: { personId: true },
          }),
        ]);
        if (!sourceContact || !targetContact) {
          throw new RepositoryError("not-found", "An event-owned source or target contact was not found.");
        }
        if (!sourceContact.personId || !targetContact.personId) {
          invalid("Source and target contacts must be linked to directory people.");
        }

        const [sourceSpeaker, targetSpeaker] = await Promise.all([
          transaction.speaker.findUnique({
            where: { eventId_personId: { eventId, personId: sourceContact.personId } },
            select: { id: true },
          }),
          transaction.speaker.findUnique({
            where: { eventId_personId: { eventId, personId: targetContact.personId } },
            select: { id: true },
          }),
        ]);
        if (!sourceSpeaker || sourceSpeaker.id === targetSpeaker?.id) return 0;

        const sourceParticipations = await transaction.programSessionParticipant.findMany({
          where: { eventId, speakerId: sourceSpeaker.id },
          select: { sessionVersionId: true },
        });
        if (!targetSpeaker) {
          await transaction.speaker.update({
            where: { eventId_id: { eventId, id: sourceSpeaker.id } },
            data: { personId: targetContact.personId },
          });
          return sourceParticipations.length;
        }

        for (const participation of sourceParticipations) {
          const targetParticipation = await transaction.programSessionParticipant.findUnique({
            where: {
              sessionVersionId_speakerId: {
                sessionVersionId: participation.sessionVersionId,
                speakerId: targetSpeaker.id,
              },
            },
            select: { speakerId: true },
          });
          if (targetParticipation) {
            await transaction.programSessionParticipant.delete({
              where: {
                sessionVersionId_speakerId: {
                  sessionVersionId: participation.sessionVersionId,
                  speakerId: sourceSpeaker.id,
                },
              },
            });
          } else {
            await transaction.programSessionParticipant.update({
              where: {
                sessionVersionId_speakerId: {
                  sessionVersionId: participation.sessionVersionId,
                  speakerId: sourceSpeaker.id,
                },
              },
              data: { speakerId: targetSpeaker.id },
            });
          }
        }
        return sourceParticipations.length;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    mapDatabaseError(error);
  }
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
  const data: Prisma.ContactGroupUncheckedUpdateInput = {};
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
  if (input.tierId !== undefined) data.tierId = input.tierId;
  if (input.primaryContactId !== undefined) data.primaryContactId = input.primaryContactId;

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
