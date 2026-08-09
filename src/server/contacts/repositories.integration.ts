import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient, ProgramSessionParticipantRole } from "../../generated/prisma/client.ts";
import { EventRepository } from "../events/repositories.ts";
import { ProgramSessionRepository } from "../sessions/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import {
  archiveContact,
  createContact,
  getDirectoryPersonProfile,
  linkDirectoryPersonToEvent,
  listContactProgramSessionParticipations,
  listContacts,
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

    const [result] = await searchDirectoryPeople(client, "robotics");
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

    const [summary] = await searchDirectoryPeople(client, "Archive Co");
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
