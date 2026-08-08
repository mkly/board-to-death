import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError, RoomRepository, TrackRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for repository integration tests.");
}

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const rooms = new RoomRepository(client);
const tracks = new TrackRepository(client);

const baseEvent = {
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  type: EventType.CONFERENCE,
  websiteUrl: "https://example.test/events/2027",
  location: "Oakland, CA",
  timezone: "America/Los_Angeles",
  startsAt: new Date("2027-03-13T17:00:00.000Z"),
  endsAt: new Date("2027-03-15T00:00:00.000Z"),
  theme: "Gather around the table",
  exhibitorsEnabled: true,
  sponsorsEnabled: true,
  logoObjectKey: "events/2027/logo.svg",
  backgroundObjectKey: "events/2027/background.webp",
} as const;

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

describe("event persistence repositories", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("creates, reads, updates, and deletes complete event settings", async () => {
    const created = await events.create(baseEvent);

    assert.equal(created.slug, "board-to-death-2027");
    assert.equal(created.type, EventType.CONFERENCE);
    assert.equal(created.timezone, "America/Los_Angeles");
    assert.equal(created.websiteUrl, "https://example.test/events/2027");
    assert.equal(created.logoObjectKey, "events/2027/logo.svg");
    assert.equal(created.backgroundObjectKey, "events/2027/background.webp");

    const updated = await events.update(created.id, {
      name: "Board to Death Conference 2027",
      type: EventType.WORKSHOP,
      sponsorsEnabled: false,
    });
    assert.equal(updated.name, "Board to Death Conference 2027");
    assert.equal(updated.type, EventType.WORKSHOP);
    assert.equal(updated.sponsorsEnabled, false);
    assert.equal((await events.get(created.id))?.location, "Oakland, CA");

    await events.delete(created.id);
    assert.equal(await events.get(created.id), null);
  });

  test("rejects invalid date bounds, time zones, and duplicate stable slugs", async () => {
    await expectRepositoryError(
      events.create({ ...baseEvent, slug: "invalid-bounds", endsAt: baseEvent.startsAt }),
      "invalid-input",
    );
    await expectRepositoryError(
      events.create({ ...baseEvent, slug: "invalid-timezone", timezone: "local-server-time" }),
      "invalid-input",
    );

    await events.create(baseEvent);
    await expectRepositoryError(events.create({ ...baseEvent, name: "A duplicate" }), "conflict");
  });

  test("keeps room CRUD, names, and ordering isolated to the owning event", async () => {
    const firstEvent = await events.create(baseEvent);
    const secondEvent = await events.create({ ...baseEvent, slug: "another-event", name: "Another Event" });
    const hall = await rooms.create({ eventId: firstEvent.id, name: "Main Hall" });
    const studio = await rooms.create({ eventId: firstEvent.id, name: "Studio" });

    await expectRepositoryError(rooms.create({ eventId: firstEvent.id, name: "main hall" }), "conflict");
    assert.equal(await rooms.get(secondEvent.id, hall.id), null);
    await expectRepositoryError(rooms.update(secondEvent.id, hall.id, "Stolen"), "not-found");

    const renamed = await rooms.update(firstEvent.id, hall.id, "Grand Hall");
    assert.equal(renamed.name, "Grand Hall");
    assert.deepEqual(
      (await rooms.reorder(firstEvent.id, [studio.id, hall.id])).map(({ name, sortOrder }) => [name, sortOrder]),
      [
        ["Studio", 0],
        ["Grand Hall", 1],
      ],
    );

    await rooms.delete(firstEvent.id, hall.id);
    assert.equal(await rooms.get(firstEvent.id, hall.id), null);
  });

  test("keeps color-coded track CRUD, names, and ordering isolated to the owning event", async () => {
    const firstEvent = await events.create(baseEvent);
    const secondEvent = await events.create({ ...baseEvent, slug: "another-event", name: "Another Event" });
    const strategy = await tracks.create({ eventId: firstEvent.id, name: "Strategy", color: "blue" });
    const design = await tracks.create({ eventId: firstEvent.id, name: "Design", color: "violet" });

    await expectRepositoryError(
      tracks.create({ eventId: firstEvent.id, name: "STRATEGY", color: "amber" }),
      "conflict",
    );
    assert.equal(await tracks.get(secondEvent.id, strategy.id), null);
    await expectRepositoryError(tracks.update(secondEvent.id, strategy.id, { color: "red" }), "not-found");

    const updated = await tracks.update(firstEvent.id, strategy.id, { name: "Game Strategy", color: "emerald" });
    assert.equal(updated.color, "emerald");
    assert.deepEqual(
      (await tracks.reorder(firstEvent.id, [design.id, strategy.id])).map(({ name, color, sortOrder }) => [
        name,
        color,
        sortOrder,
      ]),
      [
        ["Design", "violet", 0],
        ["Game Strategy", "emerald", 1],
      ],
    );

    await tracks.delete(firstEvent.id, strategy.id);
    assert.equal(await tracks.get(firstEvent.id, strategy.id), null);
  });

  test("cascades rooms and tracks when their event is deleted", async () => {
    const event = await events.create(baseEvent);
    await rooms.create({ eventId: event.id, name: "Main Hall" });
    await tracks.create({ eventId: event.id, name: "Strategy", color: "blue" });

    await events.delete(event.id);

    assert.equal(await client.room.count({ where: { eventId: event.id } }), 0);
    assert.equal(await client.track.count({ where: { eventId: event.id } }), 0);
  });
});
