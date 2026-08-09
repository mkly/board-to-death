import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError, RoomRepository, TrackRepository } from "../events/repositories.ts";
import { ProgramSessionRepository } from "../sessions/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { AgendaConflictError, AgendaPlacementRepository } from "./placements.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for agenda placement integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const rooms = new RoomRepository(client);
const tracks = new TrackRepository(client);
const speakers = new SpeakerRepository(client);
const sessions = new ProgramSessionRepository(client);
const placements = new AgendaPlacementRepository(client);

async function createFixture(slug: string) {
  const event = await events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-03-13T17:00:00.000Z"),
    endsAt: new Date("2027-03-15T00:00:00.000Z"),
  });
  const room = await rooms.create({ eventId: event.id, name: "Main Hall" });
  const secondRoom = await rooms.create({ eventId: event.id, name: "Workshop Room" });
  const track = await tracks.create({ eventId: event.id, name: "Engineering", color: "blue" });
  const secondTrack = await tracks.create({ eventId: event.id, name: "Leadership", color: "green" });
  const speaker = await speakers.create({
    eventId: event.id,
    email: `${slug}-one@example.test`,
    givenName: "One",
    familyName: "Speaker",
  });
  const secondSpeaker = await speakers.create({
    eventId: event.id,
    email: `${slug}-two@example.test`,
    givenName: "Two",
    familyName: "Speaker",
  });
  const session = await sessions.createManual({
    eventId: event.id,
    title: "Time-zone semantics",
    durationMinutes: 45,
    speakerIds: [speaker.id, secondSpeaker.id],
  });
  return { event, room, secondRoom, track, secondTrack, speaker, secondSpeaker, session };
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

describe("agenda placement persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("stores UTC instants across daylight-saving changes and returns the event time zone", async () => {
    const fixture = await createFixture("spring-forward");
    const startsAt = new Date("2027-03-14T09:30:00.000Z");
    const placed = await placements.place({
      eventId: fixture.event.id,
      sessionId: fixture.session.id,
      startsAt,
      durationMinutes: 60,
      roomId: fixture.room.id,
      trackIds: [fixture.secondTrack.id, fixture.track.id],
      speakerIds: [fixture.secondSpeaker.id, fixture.speaker.id],
    });

    assert.deepEqual(placed.startsAt, startsAt);
    assert.deepEqual(placed.endsAt, new Date("2027-03-14T10:30:00.000Z"));
    assert.equal(placed.timezone, "America/Los_Angeles");
    assert.equal(
      new Intl.DateTimeFormat("en-US", {
        timeZone: placed.timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
      }).format(placed.startsAt),
      "01:30",
    );
    assert.equal(
      new Intl.DateTimeFormat("en-US", {
        timeZone: placed.timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
      }).format(placed.endsAt),
      "03:30",
    );
    assert.deepEqual(placed.trackIds, [fixture.secondTrack.id, fixture.track.id]);
    assert.deepEqual(placed.speakerIds, [fixture.secondSpeaker.id, fixture.speaker.id]);
  });

  test("accepts exact event boundaries and rejects invalid durations and overflow", async () => {
    const fixture = await createFixture("event-bounds");
    const placed = await placements.place({
      eventId: fixture.event.id,
      sessionId: fixture.session.id,
      startsAt: fixture.event.startsAt,
      durationMinutes: 1_860,
      roomId: fixture.room.id,
    });
    assert.deepEqual(placed.endsAt, fixture.event.endsAt);

    const second = await sessions.createManual({
      eventId: fixture.event.id,
      title: "Overflow",
      durationMinutes: 30,
    });
    await expectRepositoryError(
      placements.place({
        eventId: fixture.event.id,
        sessionId: second.id,
        startsAt: new Date("2027-03-14T23:45:00.000Z"),
        durationMinutes: 30,
        roomId: fixture.room.id,
      }),
      "invalid-input",
    );
    await expectRepositoryError(
      placements.update(fixture.event.id, placed.id, { expectedVersion: 1, durationMinutes: 0 }),
      "invalid-input",
    );
  });

  test("constrains subsessions to the parent placement window and permits their intentional overlap", async () => {
    const fixture = await createFixture("subsession-window");
    const parent = await placements.place({
      eventId: fixture.event.id,
      sessionId: fixture.session.id,
      startsAt: new Date("2027-03-13T18:00:00.000Z"),
      durationMinutes: 120,
      roomId: fixture.room.id,
      speakerIds: [fixture.speaker.id],
    });
    const child = await sessions.createManual({
      eventId: fixture.event.id,
      title: "Nested exercise",
      durationMinutes: 30,
      speakerIds: [fixture.speaker.id],
      parentSessionId: fixture.session.id,
    });
    const nested = await placements.place({
      eventId: fixture.event.id,
      sessionId: child.id,
      startsAt: new Date("2027-03-13T18:30:00.000Z"),
      durationMinutes: 30,
      roomId: fixture.room.id,
      speakerIds: [fixture.speaker.id],
    });
    assert.equal(nested.sessionId, child.id);

    await expectRepositoryError(
      placements.update(fixture.event.id, nested.id, {
        expectedVersion: nested.version,
        startsAt: new Date("2027-03-13T19:45:00.000Z"),
        durationMinutes: 30,
      }),
      "invalid-input",
    );
    await expectRepositoryError(
      placements.update(fixture.event.id, parent.id, {
        expectedVersion: parent.version,
        startsAt: new Date("2027-03-13T18:00:00.000Z"),
        durationMinutes: 15,
      }),
      "invalid-input",
    );
    await expectRepositoryError(placements.remove(fixture.event.id, parent.id, parent.version), "invalid-input");

    await placements.remove(fixture.event.id, nested.id, nested.version);
    await placements.remove(fixture.event.id, parent.id, parent.version);
    assert.equal(await placements.get(fixture.event.id, parent.id), null);
  });

  test("updates repeatedly, preserves omitted values, removes placements, and rejects stale writes", async () => {
    const fixture = await createFixture("placement-lifecycle");
    const placed = await placements.place({
      eventId: fixture.event.id,
      sessionId: fixture.session.id,
      startsAt: new Date("2027-03-13T18:00:00.000Z"),
      durationMinutes: 45,
      roomId: fixture.room.id,
      trackIds: [fixture.track.id],
      speakerIds: [fixture.speaker.id],
    });
    const moved = await placements.update(fixture.event.id, placed.id, {
      expectedVersion: placed.version,
      startsAt: new Date("2027-03-13T19:00:00.000Z"),
      roomId: fixture.secondRoom.id,
    });
    assert.equal(moved.version, 2);
    assert.equal(moved.durationMinutes, 45);
    assert.deepEqual(moved.trackIds, [fixture.track.id]);

    const concurrentUpdates = await Promise.allSettled([
      placements.update(fixture.event.id, placed.id, {
        expectedVersion: moved.version,
        durationMinutes: 60,
        trackIds: [fixture.secondTrack.id],
      }),
      placements.update(fixture.event.id, placed.id, {
        expectedVersion: moved.version,
        durationMinutes: 75,
      }),
    ]);
    const fulfilled = concurrentUpdates.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof placements.update>>> =>
        result.status === "fulfilled",
    );
    const rejected = concurrentUpdates.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof RepositoryError);
    assert.equal(rejected[0].reason.code, "conflict");
    const resized = fulfilled[0]?.value;
    assert.ok(resized);
    assert.equal(resized.version, 3);
    assert.ok(resized.durationMinutes === 60 || resized.durationMinutes === 75);
    await expectRepositoryError(placements.remove(fixture.event.id, placed.id, moved.version), "conflict");
    await placements.remove(fixture.event.id, placed.id, resized.version);
    assert.equal(await placements.get(fixture.event.id, placed.id), null);
  });

  test("prevents conflicts or requires explicit confirmation before persisting them", async () => {
    const fixture = await createFixture("conflict-policy");
    await placements.place({
      eventId: fixture.event.id,
      sessionId: fixture.session.id,
      startsAt: new Date("2027-03-13T18:00:00.000Z"),
      durationMinutes: 60,
      roomId: fixture.room.id,
      trackIds: [fixture.track.id],
      speakerIds: [fixture.speaker.id],
    });
    const overlappingSession = await sessions.createManual({
      eventId: fixture.event.id,
      title: "Overlapping session",
      durationMinutes: 45,
      trackId: fixture.track.id,
      speakerIds: [fixture.speaker.id],
    });
    const input = {
      eventId: fixture.event.id,
      sessionId: overlappingSession.id,
      startsAt: new Date("2027-03-13T18:30:00.000Z"),
      durationMinutes: 45,
      roomId: fixture.room.id,
      trackIds: [fixture.track.id],
      speakerIds: [fixture.speaker.id],
    };

    await assert.rejects(placements.place(input), (error: unknown) => {
      assert.ok(error instanceof AgendaConflictError);
      assert.equal(error.confirmationRequired, false);
      assert.deepEqual(
        error.conflicts.map(({ type }) => type),
        ["room", "track", "speaker"],
      );
      return true;
    });
    await assert.rejects(placements.place(input, { policy: "explicit-confirm" }), (error: unknown) => {
      assert.ok(error instanceof AgendaConflictError);
      assert.equal(error.confirmationRequired, true);
      return true;
    });

    const confirmed = await placements.place(input, {
      policy: "explicit-confirm",
      conflictsConfirmed: true,
    });
    assert.equal(confirmed.sessionId, overlappingSession.id);
  });

  test("rejects archived sessions and room, track, speaker, and placement references from another event", async () => {
    const fixture = await createFixture("isolated-agenda");
    const outsider = await createFixture("other-agenda");
    await expectRepositoryError(
      placements.place({
        eventId: fixture.event.id,
        sessionId: outsider.session.id,
        startsAt: new Date("2027-03-13T18:00:00.000Z"),
        durationMinutes: 30,
        roomId: fixture.room.id,
      }),
      "not-found",
    );
    for (const input of [
      { roomId: outsider.room.id },
      { roomId: fixture.room.id, trackIds: [outsider.track.id] },
      { roomId: fixture.room.id, speakerIds: [outsider.speaker.id] },
    ]) {
      await expectRepositoryError(
        placements.place({
          eventId: fixture.event.id,
          sessionId: fixture.session.id,
          startsAt: new Date("2027-03-13T18:00:00.000Z"),
          durationMinutes: 30,
          ...input,
        }),
        "not-found",
      );
    }
    await sessions.archive(fixture.event.id, fixture.session.id);
    await expectRepositoryError(
      placements.place({
        eventId: fixture.event.id,
        sessionId: fixture.session.id,
        startsAt: new Date("2027-03-13T18:00:00.000Z"),
        durationMinutes: 30,
        roomId: fixture.room.id,
      }),
      "not-found",
    );
    const outsiderPlacement = await placements.place({
      eventId: outsider.event.id,
      sessionId: outsider.session.id,
      startsAt: new Date("2027-03-13T18:00:00.000Z"),
      durationMinutes: 30,
      roomId: outsider.room.id,
    });
    await expectRepositoryError(placements.remove(fixture.event.id, outsiderPlacement.id, 1), "not-found");
  });
});
