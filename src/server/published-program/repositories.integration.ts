import { PrismaPg } from "@prisma/adapter-pg";

import {
  EventType,
  PrismaClient,
  ProgramSessionContentApprovalStatus,
  PublishedProgramState,
} from "../../generated/prisma/client.ts";
import { AgendaPlacementRepository } from "../agenda/placements.ts";
import { type AuthenticatedPrincipal, AuthorizationError } from "../authorization/policy.ts";
import { EventRepository, RepositoryError, RoomRepository, TrackRepository } from "../events/repositories.ts";
import { ProgramSessionRepository } from "../sessions/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { PublishedProgramOperations } from "./operations.ts";
import { PublishedProgramRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for published-program integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const rooms = new RoomRepository(client);
const tracks = new TrackRepository(client);
const speakers = new SpeakerRepository(client);
const sessions = new ProgramSessionRepository(client);
const placements = new AgendaPlacementRepository(client);
const publications = new PublishedProgramRepository(client);

const ADMIN_ID = "admin-principal";

async function createEvent(slug: string) {
  return events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    websiteUrl: `https://example.test/${slug}`,
    location: "Oakland, CA",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-03-13T17:00:00.000Z"),
    endsAt: new Date("2027-03-15T00:00:00.000Z"),
    theme: "Conference theme",
  });
}

function principal(eventId: string, role: "organizer-admin" | "reviewer" = "organizer-admin"): AuthenticatedPrincipal {
  return { id: ADMIN_ID, memberships: [{ eventId, roles: [role] }] };
}

async function createProgramFixture() {
  const event = await createEvent("published-program");
  const room = await rooms.create({ eventId: event.id, name: "Main Hall" });
  await rooms.create({ eventId: event.id, name: "Draft room" });
  const track = await tracks.create({ eventId: event.id, name: "Strategy", color: "blue" });
  await tracks.create({ eventId: event.id, name: "Draft track", color: "gray" });
  const publicSpeaker = await speakers.create({
    eventId: event.id,
    email: "public@example.test",
    givenName: "Public",
    familyName: "Speaker",
    phone: "+1 555 0100",
  });
  await speakers.updateProfile(event.id, publicSpeaker.id, {
    biography: "Public biography",
    organization: "Tabletop Guild",
    consentToPublishProfile: true,
    consentedAt: new Date("2027-01-01T12:00:00.000Z"),
  });
  const privateSpeaker = await speakers.create({
    eventId: event.id,
    email: "private@example.test",
    givenName: "Private",
    familyName: "Speaker",
    phone: "+1 555 0199",
  });
  const session = await sessions.createManual({
    eventId: event.id,
    contentApprovalStatus: ProgramSessionContentApprovalStatus.APPROVED,
    title: "Published session",
    description: "The public description",
    durationMinutes: 45,
    trackId: track.id,
    speakerIds: [publicSpeaker.id, privateSpeaker.id],
  });
  const placement = await placements.place({
    eventId: event.id,
    sessionId: session.id,
    roomId: room.id,
    startsAt: new Date("2027-03-13T18:00:00.000Z"),
    durationMinutes: 45,
    trackIds: [track.id],
    speakerIds: [publicSpeaker.id, privateSpeaker.id],
  });
  const scheduledDraft = await sessions.createManual({
    eventId: event.id,
    title: "Scheduled draft",
    durationMinutes: 30,
    trackId: track.id,
    speakerIds: [publicSpeaker.id],
  });
  await placements.place({
    eventId: event.id,
    sessionId: scheduledDraft.id,
    roomId: room.id,
    startsAt: new Date("2027-03-13T19:00:00.000Z"),
    durationMinutes: 30,
    trackIds: [track.id],
    speakerIds: [publicSpeaker.id],
  });
  await sessions.createManual({
    eventId: event.id,
    title: "Unscheduled draft",
    durationMinutes: 30,
    speakerIds: [publicSpeaker.id],
  });
  const outsider = await createEvent("outsider-program");
  const outsiderRoom = await rooms.create({ eventId: outsider.id, name: "Outside room" });
  const outsiderSession = await sessions.createManual({
    eventId: outsider.id,
    title: "Outside session",
    durationMinutes: 30,
  });
  await placements.place({
    eventId: outsider.id,
    sessionId: outsiderSession.id,
    roomId: outsiderRoom.id,
    startsAt: new Date("2027-03-13T19:00:00.000Z"),
    durationMinutes: 30,
  });
  return { event, room, track, publicSpeaker, privateSpeaker, session, placement, outsider };
}

async function expectRepositoryConflict(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === "conflict");
}

describe("published-program lifecycle", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("publishes one event-consistent public snapshot without draft, private, or cross-event data", async () => {
    const fixture = await createProgramFixture();
    const operations = new PublishedProgramOperations(publications, async () => principal(fixture.event.id));

    const published = await operations.publish(fixture.event.id);

    assert.equal(published.versionNumber, 1);
    assert.equal(published.state, PublishedProgramState.PUBLISHED);
    assert.equal(published.actorPrincipalId, ADMIN_ID);
    assert.ok(published.snapshot);
    assert.deepEqual(
      published.snapshot.rooms.map(({ id }) => id),
      [fixture.room.id],
    );
    assert.deepEqual(
      published.snapshot.tracks.map(({ id }) => id),
      [fixture.track.id],
    );
    assert.deepEqual(
      published.snapshot.sessions.map(({ id }) => id),
      [fixture.session.id],
    );
    assert.deepEqual(
      published.snapshot.placements.map(({ id }) => id),
      [fixture.placement.id],
    );
    assert.deepEqual(
      published.snapshot.speakers.map(({ id }) => id),
      [fixture.publicSpeaker.id],
    );
    assert.deepEqual(published.snapshot.sessions[0]?.speakerIds, [fixture.publicSpeaker.id]);
    assert.deepEqual(published.snapshot.placements[0]?.speakerIds, [fixture.publicSpeaker.id]);
    const serialized = JSON.stringify(published.snapshot);
    assert.doesNotMatch(serialized, /public@example\.test|private@example\.test|555 01/);
    assert.doesNotMatch(serialized, new RegExp(fixture.privateSpeaker.id));
    assert.doesNotMatch(serialized, new RegExp(fixture.outsider.id));
    assert.doesNotMatch(serialized, /Scheduled draft|Unscheduled draft|Outside session|Draft room|Draft track/);
  });

  test("keeps immutable publish, republish, unpublish, and restore history", async () => {
    const fixture = await createProgramFixture();
    const queuedPushes: { eventId: string; publishedVersion: number; idempotencyKey: string }[] = [];
    const operations = new PublishedProgramOperations(
      publications,
      async () => principal(fixture.event.id),
      async (request) => {
        queuedPushes.push(request);
      },
    );
    const first = await operations.publish(fixture.event.id);

    await sessions.update(fixture.event.id, fixture.session.id, { title: "Revised session" });
    const second = await operations.republish(fixture.event.id, first.versionNumber);
    const third = await operations.unpublish(fixture.event.id, second.versionNumber);
    const fourth = await operations.republish(fixture.event.id, third.versionNumber);

    assert.equal(first.snapshot?.sessions[0]?.title, "Published session");
    assert.equal(second.snapshot?.sessions[0]?.title, "Revised session");
    assert.equal(third.state, PublishedProgramState.UNPUBLISHED);
    assert.equal(third.snapshot, null);
    assert.equal(fourth.state, PublishedProgramState.PUBLISHED);
    assert.deepEqual(
      queuedPushes.map(({ eventId, publishedVersion, idempotencyKey }) => [eventId, publishedVersion, idempotencyKey]),
      [
        [fixture.event.id, 1, "published-program:1"],
        [fixture.event.id, 2, "published-program:2"],
        [fixture.event.id, 4, "published-program:4"],
      ],
    );
    assert.deepEqual(
      (await publications.listVersions(fixture.event.id)).map(({ versionNumber, state }) => [versionNumber, state]),
      [
        [1, PublishedProgramState.PUBLISHED],
        [2, PublishedProgramState.PUBLISHED],
        [3, PublishedProgramState.UNPUBLISHED],
        [4, PublishedProgramState.PUBLISHED],
      ],
    );
    assert.equal((await publications.latest(fixture.event.id))?.versionNumber, 4);
  });

  test("rejects stale and concurrent lifecycle changes", async () => {
    const fixture = await createProgramFixture();
    const first = await publications.publish({
      eventId: fixture.event.id,
      actorPrincipalId: ADMIN_ID,
      expectedVersion: 0,
    });

    const attempts = await Promise.allSettled([
      publications.republish({ eventId: fixture.event.id, actorPrincipalId: "admin-a", expectedVersion: 1 }),
      publications.republish({ eventId: fixture.event.id, actorPrincipalId: "admin-b", expectedVersion: 1 }),
    ]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
    await expectRepositoryConflict(
      publications.unpublish({
        eventId: fixture.event.id,
        actorPrincipalId: ADMIN_ID,
        expectedVersion: first.versionNumber,
      }),
    );
  });

  test("requires organizer authorization and hides other event publication state", async () => {
    const fixture = await createProgramFixture();
    const reviewerOperations = new PublishedProgramOperations(publications, async () =>
      principal(fixture.event.id, "reviewer"),
    );
    const otherEventOperations = new PublishedProgramOperations(publications, async () =>
      principal(fixture.outsider.id),
    );

    await assert.rejects(
      reviewerOperations.publish(fixture.event.id),
      (error: unknown) => error instanceof AuthorizationError && error.code === "not-found",
    );
    await assert.rejects(
      otherEventOperations.publish(fixture.event.id),
      (error: unknown) => error instanceof AuthorizationError && error.code === "not-found",
    );
    assert.equal(await publications.latest(fixture.event.id), null);
  });

  test("resolves only the current public snapshot by event id or slug and reports publication state", async () => {
    const fixture = await createProgramFixture();
    const operations = new PublishedProgramOperations(publications, async () => principal(fixture.event.id));

    assert.deepEqual(await publications.findPublic("unknown-event"), { status: "event-not-found" });
    assert.deepEqual(await publications.findPublic(fixture.event.slug), {
      status: "not-published",
      eventId: fixture.event.id,
    });

    const first = await operations.publish(fixture.event.id);
    const byId = await publications.findPublic(fixture.event.id);
    assert.equal(byId.status, "published");
    if (byId.status !== "published") return;
    assert.equal(byId.version.versionNumber, first.versionNumber);
    assert.deepEqual(
      byId.version.snapshot.sessions.map(({ id }) => id),
      [fixture.session.id],
    );
    assert.doesNotMatch(JSON.stringify(byId.version.snapshot), /private@example\.test|Outside session/);

    await operations.unpublish(fixture.event.id, first.versionNumber);
    assert.deepEqual(await publications.findPublic(fixture.event.slug), {
      status: "unpublished",
      eventId: fixture.event.id,
      versionNumber: 2,
    });
  });
});
