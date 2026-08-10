import { PrismaPg } from "@prisma/adapter-pg";

import {
  EventType,
  PrismaClient,
  ProgramSessionParticipantRole,
  SpeakerProspectActivityActor,
  SpeakerProspectActivityKind,
  SpeakerProspectStageBehavior,
} from "../../generated/prisma/client.ts";
import { EventRepository } from "../events/repositories.ts";
import { ProgramSessionRepository } from "../sessions/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { DirectorySegmentRepository } from "./directory-segments.ts";
import {
  archiveContact,
  createContact,
  getDirectoryPersonProfile,
  linkDirectoryPersonToEvent,
  listContactProgramSessionParticipations,
  listContacts,
  listDirectoryDuplicateMatches,
  mergeDirectoryPeople,
  reassignContactProgramSessionParticipations,
  searchDirectoryPeople,
  updateContact,
} from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for contact directory integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const sessions = new ProgramSessionRepository(client);
const speakers = new SpeakerRepository(client);
const segments = new DirectorySegmentRepository(client);

async function createEvent(slug: string, startsAt: string) {
  return events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 86_400_000),
  });
}

describe("organization contact directory", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.directorySegment.deleteMany();
    await client.event.deleteMany();
    await client.person.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("searches and links one person across isolated event contact snapshots", async () => {
    const firstEvent = await createEvent("directory-first", "2027-03-01T17:00:00.000Z");
    const nextEvent = await createEvent("directory-next", "2028-03-01T17:00:00.000Z");
    const firstContact = await createContact(client, {
      eventId: firstEvent.id,
      email: " Dana@Example.Test ",
      givenName: "Dana",
      familyName: "Reed",
      organization: "Reed Robotics",
      jobTitle: "Founder",
    });
    assert.ok(firstContact.personId);

    const [result] = await searchDirectoryPeople(client, firstEvent.id, "robotics");
    assert.equal(result?.email, "dana@example.test");
    assert.deepEqual(result?.linkedEventIds, [firstEvent.id]);

    await updateContact(client, firstEvent.id, firstContact.id, {
      givenName: "Dani",
      organization: "Event-specific sponsor",
    });
    const directoryPerson = await client.person.findUniqueOrThrow({ where: { id: firstContact.personId } });
    assert.equal(directoryPerson.givenName, "Dana");
    assert.equal(directoryPerson.organization, "Reed Robotics");

    const linked = await linkDirectoryPersonToEvent(client, nextEvent.id, directoryPerson.id);
    assert.equal(linked.givenName, "Dana");
    assert.equal(linked.organization, "Reed Robotics");
    assert.deepEqual(
      (await listContacts(client, firstEvent.id)).map(({ id }) => id),
      [firstContact.id],
    );
    assert.deepEqual(
      (await listContacts(client, nextEvent.id)).map(({ id }) => id),
      [linked.id],
    );

    const profile = await getDirectoryPersonProfile(client, directoryPerson.id);
    assert.deepEqual(
      profile?.events.map(({ contact, event, relationship }) => ({
        event: event.slug,
        name: contact.givenName,
        organization: contact.organization,
        relationship,
      })),
      [
        { event: firstEvent.slug, name: "Dani", organization: "Event-specific sponsor", relationship: "new" },
        { event: nextEvent.slug, name: "Dana", organization: "Reed Robotics", relationship: "returning" },
      ],
    );
  });

  test("surfaces same-name people and merges their event history and pipeline notes", async () => {
    const sourceEvent = await createEvent("duplicate-source", "2027-03-01T17:00:00.000Z");
    const primaryEvent = await createEvent("duplicate-primary", "2028-03-01T17:00:00.000Z");
    const sharedEvent = await createEvent("duplicate-shared", "2029-03-01T17:00:00.000Z");
    const sourceContact = await createContact(client, {
      eventId: sourceEvent.id,
      email: "priya.alt@example.test",
      givenName: "Priya",
      familyName: "Raman",
      organization: "Alternate Labs",
    });
    const primaryContact = await createContact(client, {
      eventId: primaryEvent.id,
      email: "priya@example.test",
      givenName: "Priya",
      familyName: "Raman",
      organization: "Primary Labs",
    });
    assert.ok(sourceContact.personId);
    assert.ok(primaryContact.personId);
    const sourceSharedContact = await linkDirectoryPersonToEvent(client, sharedEvent.id, sourceContact.personId);
    await linkDirectoryPersonToEvent(client, sharedEvent.id, primaryContact.personId);

    const stage = await client.speakerProspectStage.create({
      data: {
        eventId: sharedEvent.id,
        name: "Researching",
        behavior: SpeakerProspectStageBehavior.OPEN,
        sortOrder: 0,
      },
    });
    const sourceProspect = await client.speakerProspect.create({
      data: {
        eventId: sharedEvent.id,
        personId: sourceContact.personId,
        stageId: stage.id,
        sourceLabel: "Manual",
      },
    });
    const primaryProspect = await client.speakerProspect.create({
      data: {
        eventId: sharedEvent.id,
        personId: primaryContact.personId,
        stageId: stage.id,
        sourceLabel: "Manual",
      },
    });
    await client.speakerProspectActivity.create({
      data: {
        eventId: sharedEvent.id,
        prospectId: sourceProspect.id,
        kind: SpeakerProspectActivityKind.NOTE_ADDED,
        actor: SpeakerProspectActivityActor.USER,
        actorLabel: "Jordan Organizer",
        note: "Met at DevFlow 2026 - shortlist for keynote.",
      },
    });

    const duplicates = await listDirectoryDuplicateMatches(client, sourceEvent.id);
    assert.deepEqual(
      duplicates.map(({ people, reasons }) => ({
        emails: people.map(({ email }) => email),
        reasons,
      })),
      [
        {
          emails: ["priya.alt@example.test", "priya@example.test"],
          reasons: ["name"],
        },
      ],
    );

    await mergeDirectoryPeople(client, sourceEvent.id, primaryContact.personId, sourceContact.personId);

    assert.equal(await client.person.findUnique({ where: { id: sourceContact.personId } }), null);
    assert.deepEqual(
      (await getDirectoryPersonProfile(client, primaryContact.personId))?.events.map(({ event }) => event.slug),
      [sourceEvent.slug, primaryEvent.slug, sharedEvent.slug],
    );
    assert.equal(await client.contact.count({ where: { eventId: sharedEvent.id, archivedAt: null } }), 1);
    const archivedSourceContact = await client.contact.findUniqueOrThrow({ where: { id: sourceSharedContact.id } });
    assert.ok(archivedSourceContact.archivedAt instanceof Date);
    assert.equal(archivedSourceContact.personId, null);
    assert.equal(await client.speakerProspect.findUnique({ where: { id: sourceProspect.id } }), null);
    assert.deepEqual(
      await client.speakerProspectActivity.findMany({
        where: { prospectId: primaryProspect.id },
        select: { note: true },
      }),
      [{ note: "Met at DevFlow 2026 - shortlist for keynote." }],
    );
  });

  test("attaches a matching legacy event contact without overwriting its fields", async () => {
    const event = await createEvent("legacy-directory", "2027-05-01T16:00:00.000Z");
    const person = await client.person.create({
      data: { email: "legacy@example.test", givenName: "Directory", familyName: "Name", organization: "Directory Org" },
    });
    const legacy = await client.contact.create({
      data: {
        eventId: event.id,
        email: person.email,
        givenName: "Event",
        familyName: "Override",
        organization: "Event Org",
      },
    });

    const linked = await linkDirectoryPersonToEvent(client, event.id, person.id);
    assert.equal(linked.id, legacy.id);
    assert.equal(linked.personId, person.id);
    assert.equal(linked.givenName, "Event");
    assert.equal(linked.organization, "Event Org");
  });

  test("scopes the person directory to the organization that owns the event", async () => {
    const otherOrganization = await client.organization.upsert({
      where: { slug: "other-directory-org" },
      create: { name: "Other Directory Org", slug: "other-directory-org" },
      update: {},
    });
    const homeEvent = await createEvent("directory-home", "2027-09-01T17:00:00.000Z");
    const foreignEvent = await events.create({
      orgId: otherOrganization.id,
      name: "directory-foreign",
      slug: "directory-foreign",
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-10-01T17:00:00.000Z"),
      endsAt: new Date("2027-10-02T17:00:00.000Z"),
    });

    await createContact(client, {
      eventId: homeEvent.id,
      email: "shared@example.test",
      givenName: "Home",
      familyName: "Person",
      organization: "Shared Robotics",
    });
    await createContact(client, {
      eventId: foreignEvent.id,
      email: "shared@example.test",
      givenName: "Foreign",
      familyName: "Person",
      organization: "Shared Robotics",
    });

    assert.deepEqual(
      (await searchDirectoryPeople(client, homeEvent.id, "Shared Robotics")).map(({ givenName }) => givenName),
      ["Home"],
    );
    assert.deepEqual(
      (await searchDirectoryPeople(client, foreignEvent.id, "")).map(({ givenName }) => givenName),
      ["Foreign"],
    );

    await client.event.deleteMany({ where: { orgId: otherOrganization.id } });
    await client.person.deleteMany({ where: { orgId: otherOrganization.id } });
    await client.organization.delete({ where: { id: otherOrganization.id } });
  });

  test("combines directory criteria and re-resolves saved segment membership", async () => {
    const aiEvent = await createEvent("directory-ai", "2027-11-01T17:00:00.000Z");
    const designEvent = await createEvent("directory-design", "2027-12-01T17:00:00.000Z");
    await createContact(client, {
      eventId: aiEvent.id,
      email: "researcher@example.test",
      givenName: "Rhea",
      familyName: "Search",
      organization: "AI Labs",
      jobTitle: "Researcher",
    });
    await createContact(client, {
      eventId: designEvent.id,
      email: "designer@example.test",
      givenName: "Des",
      familyName: "Ign",
      organization: "AI Labs",
      jobTitle: "Designer",
    });
    await createContact(client, {
      eventId: aiEvent.id,
      email: "other@example.test",
      givenName: "Otto",
      familyName: "Mation",
      organization: "Other Co",
      jobTitle: "Researcher",
    });

    const filters = { organization: "AI", jobTitle: "research", eventId: aiEvent.id };
    assert.deepEqual(
      (await searchDirectoryPeople(client, aiEvent.id, filters)).map(({ givenName }) => givenName),
      ["Rhea"],
    );
    assert.equal((await searchDirectoryPeople(client, aiEvent.id, {})).length, 3);

    const saved = await segments.createForEvent(aiEvent.id, "AI Experts", filters);
    assert.equal((await segments.listForEvent(aiEvent.id))[0]?.name, "AI Experts");

    await createContact(client, {
      eventId: aiEvent.id,
      email: "new-researcher@example.test",
      givenName: "Nia",
      familyName: "Expert",
      organization: "AI Labs",
      jobTitle: "Research engineer",
    });
    assert.deepEqual(
      (await searchDirectoryPeople(client, aiEvent.id, saved.filters)).map(({ givenName }) => givenName),
      ["Nia", "Rhea"],
    );
  });

  test("revives an archived event contact instead of stranding the person as already linked", async () => {
    const event = await createEvent("directory-archived", "2027-07-01T16:00:00.000Z");
    const contact = await createContact(client, {
      eventId: event.id,
      email: "archived@example.test",
      givenName: "Archie",
      familyName: "Ved",
      organization: "Archive Co",
    });
    assert.ok(contact.personId);
    await archiveContact(client, event.id, contact.id);

    const [summary] = await searchDirectoryPeople(client, event.id, "Archive Co");
    assert.deepEqual(summary?.linkedEventIds, []);
    assert.deepEqual(await listContacts(client, event.id), []);

    const revived = await linkDirectoryPersonToEvent(client, event.id, contact.personId);
    assert.equal(revived.id, contact.id);
    assert.equal(revived.archivedAt, null);
    assert.deepEqual(
      (await listContacts(client, event.id)).map(({ id }) => id),
      [contact.id],
    );
  });

  test("lists a contact's program session participation through its person identity", async () => {
    const event = await createEvent("contact-participation", "2027-08-01T16:00:00.000Z");
    const otherEvent = await createEvent("contact-participation-other", "2027-09-01T16:00:00.000Z");
    const contact = await createContact(client, {
      eventId: event.id,
      email: "speaker@example.test",
      givenName: "Session",
      familyName: "Speaker",
    });
    assert.ok(contact.personId);
    const otherContact = await linkDirectoryPersonToEvent(client, otherEvent.id, contact.personId);
    const speaker = await speakers.create({
      eventId: event.id,
      email: contact.email,
      givenName: contact.givenName,
      familyName: contact.familyName,
    });
    const storedSpeaker = await client.speaker.findUniqueOrThrow({ where: { id: speaker.id } });
    assert.equal(storedSpeaker.personId, contact.personId);

    const session = await sessions.createManual({
      eventId: event.id,
      title: "Identity joins",
      durationMinutes: 45,
      participants: [{ speakerId: speaker.id, role: ProgramSessionParticipantRole.SPEAKER }],
    });

    const participations = await listContactProgramSessionParticipations(client, event.id, contact.id);
    assert.deepEqual(
      participations.map(({ sessionVersion, role }) => ({ sessionId: sessionVersion.sessionId, role })),
      [{ sessionId: session.id, role: ProgramSessionParticipantRole.SPEAKER }],
    );
    assert.deepEqual(await listContactProgramSessionParticipations(client, otherEvent.id, otherContact.id), []);
  });

  test("reports only the current version of an edited session's participation", async () => {
    const event = await createEvent("contact-participation-versions", "2027-08-15T16:00:00.000Z");
    const contact = await createContact(client, {
      eventId: event.id,
      email: "edited@example.test",
      givenName: "Edited",
      familyName: "Speaker",
    });
    const other = await createContact(client, {
      eventId: event.id,
      email: "retained@example.test",
      givenName: "Retained",
      familyName: "Speaker",
    });
    const speaker = await speakers.create({
      eventId: event.id,
      email: contact.email,
      givenName: contact.givenName,
      familyName: contact.familyName,
    });
    const replacement = await speakers.create({
      eventId: event.id,
      email: other.email,
      givenName: other.givenName,
      familyName: other.familyName,
    });
    const session = await sessions.createManual({
      eventId: event.id,
      title: "Edited twice",
      durationMinutes: 30,
      participants: [{ speakerId: speaker.id, role: ProgramSessionParticipantRole.SPEAKER }],
    });

    await sessions.update(event.id, session.id, { title: "Edited twice, renamed" });
    assert.deepEqual(
      (await listContactProgramSessionParticipations(client, event.id, contact.id)).map(
        ({ sessionVersion }) => sessionVersion.sessionId,
      ),
      [session.id],
    );

    await sessions.update(event.id, session.id, {
      participants: [{ speakerId: replacement.id, role: ProgramSessionParticipantRole.SPEAKER }],
    });
    assert.deepEqual(await listContactProgramSessionParticipations(client, event.id, contact.id), []);
    assert.deepEqual(
      (await listContactProgramSessionParticipations(client, event.id, other.id)).map(
        ({ sessionVersion }) => sessionVersion.sessionId,
      ),
      [session.id],
    );
  });

  test("reassigns session participation while collapsing target and order collisions", async () => {
    const event = await createEvent("reassign-participation", "2027-10-01T16:00:00.000Z");
    const sourceContact = await createContact(client, {
      eventId: event.id,
      email: "duplicate@example.test",
      givenName: "Duplicate",
      familyName: "Speaker",
    });
    const targetContact = await createContact(client, {
      eventId: event.id,
      email: "survivor@example.test",
      givenName: "Surviving",
      familyName: "Speaker",
    });
    const sourceSpeaker = await speakers.create({
      eventId: event.id,
      email: sourceContact.email,
      givenName: sourceContact.givenName,
      familyName: sourceContact.familyName,
    });
    const targetSpeaker = await speakers.create({
      eventId: event.id,
      email: targetContact.email,
      givenName: targetContact.givenName,
      familyName: targetContact.familyName,
    });
    const sharedSession = await sessions.createManual({
      eventId: event.id,
      title: "Duplicate participants",
      durationMinutes: 30,
      participants: [
        { speakerId: sourceSpeaker.id, role: ProgramSessionParticipantRole.MODERATOR },
        { speakerId: targetSpeaker.id, role: ProgramSessionParticipantRole.SPEAKER },
      ],
    });
    const sourceOnlySession = await sessions.createManual({
      eventId: event.id,
      title: "Source only",
      durationMinutes: 30,
      participants: [{ speakerId: sourceSpeaker.id, role: ProgramSessionParticipantRole.CHAIRPERSON }],
    });

    assert.equal(
      await reassignContactProgramSessionParticipations(client, event.id, sourceContact.id, targetContact.id),
      2,
    );
    assert.deepEqual(await listContactProgramSessionParticipations(client, event.id, sourceContact.id), []);
    const targetParticipations = await listContactProgramSessionParticipations(client, event.id, targetContact.id);
    assert.deepEqual(
      targetParticipations.map(({ sessionVersion, speakerId, sortOrder }) => ({
        sessionId: sessionVersion.sessionId,
        speakerId,
        sortOrder,
      })),
      [
        { sessionId: sharedSession.id, speakerId: targetSpeaker.id, sortOrder: 1 },
        { sessionId: sourceOnlySession.id, speakerId: targetSpeaker.id, sortOrder: 0 },
      ],
    );
  });
});
