import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { SpeakerSourcingRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for speaker sourcing integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const sourcing = new SpeakerSourcingRepository(client);

async function createEvent(slug: string) {
  return events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-09-01T16:00:00.000Z"),
    endsAt: new Date("2027-09-03T23:00:00.000Z"),
  });
}

describe("speaker sourcing pipeline", () => {
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

  test("keeps system behavior while stages are renamed and reordered", async () => {
    const event = await createEvent("stage-configuration");
    const original = await sourcing.listBoard(event.id);
    assert.deepEqual(
      original.map(({ behavior }) => behavior),
      ["OPEN", "NURTURE", "WON", "LOST"],
    );

    await sourcing.configureStages(
      event.id,
      [...original].reverse().map(({ id, behavior }) => ({ id, name: `${behavior} renamed` })),
    );
    const configured = await sourcing.listBoard(event.id);
    assert.deepEqual(
      configured.map(({ behavior, name }) => [behavior, name]),
      [
        ["LOST", "LOST renamed"],
        ["WON", "WON renamed"],
        ["NURTURE", "NURTURE renamed"],
        ["OPEN", "OPEN renamed"],
      ],
    );
  });

  test("creates one public-form prospect with its source and automated activity", async () => {
    const event = await createEvent("public-interest");
    const form = await sourcing.createInterestForm({
      eventId: event.id,
      title: "Share your game design story",
      description: "Tell us what you would teach.",
    });
    const submission = {
      publicId: form.publicId,
      email: "speaker@example.test",
      givenName: "Sage",
      familyName: "Meeple",
      organization: "Indie Table",
    };

    const first = await sourcing.submitInterest(submission);
    const replay = await sourcing.submitInterest(submission);
    assert.equal(replay.id, first.id);

    const board = await sourcing.listBoard(event.id);
    const prospect = board.flatMap(({ prospects }) => prospects).find(({ id }) => id === first.id);
    assert.equal(prospect?.sourceLabel, form.title);
    assert.equal(prospect?.person.email, "speaker@example.test");
    assert.deepEqual(
      prospect?.activities.map(({ kind, actor }) => [kind, actor]),
      [["CREATED", "AUTOMATION"]],
    );
  });

  test("records notes and moves an assigned prospect to won without crossing event boundaries", async () => {
    const event = await createEvent("prospect-event");
    const otherEvent = await createEvent("other-event");
    const person = await client.person.create({
      data: { email: "known@example.test", givenName: "Known", familyName: "Speaker" },
    });
    const prospect = await sourcing.enrollManual({ eventId: event.id, personId: person.id, actorLabel: "Admin User" });

    await sourcing.addNote(event.id, prospect.id, "Strong fit for the design track.", "Admin User");
    await assert.rejects(
      sourcing.assignToEvent(otherEvent.id, prospect.id, "Admin User"),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
    await sourcing.assignToEvent(event.id, prospect.id, "Admin User");

    const won = (await sourcing.listBoard(event.id)).find(({ behavior }) => behavior === "WON");
    const assigned = won?.prospects.find(({ id }) => id === prospect.id);
    assert.equal(assigned?.assignedEventId, event.id);
    assert.equal(await client.contact.count({ where: { eventId: event.id, personId: person.id } }), 1);
    assert.equal(await client.contact.count({ where: { eventId: otherEvent.id, personId: person.id } }), 0);
    assert.deepEqual(
      assigned?.activities.map(({ kind }) => kind),
      ["ASSIGNED_TO_EVENT", "NOTE_ADDED", "CREATED"],
    );
  });
});
