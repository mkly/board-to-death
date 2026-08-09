import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { AgendaPlacementRepository } from "../../../src/server/agenda/placements.ts";
import { EventRepository, RoomRepository, TrackRepository } from "../../../src/server/events/repositories.ts";
import { PublishedProgramRepository } from "../../../src/server/published-program/repositories.ts";
import { ProgramSessionRepository } from "../../../src/server/sessions/repositories.ts";
import { SpeakerRepository } from "../../../src/server/speakers/repositories.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) {
  throw new Error("The published agenda browser fixture requires a guarded *_test database.");
}

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(database);
const rooms = new RoomRepository(database);
const tracks = new TrackRepository(database);
const speakers = new SpeakerRepository(database);
const sessions = new ProgramSessionRepository(database);
const placements = new AgendaPlacementRepository(database);
const publications = new PublishedProgramRepository(database);
const action = process.argv[2] ?? "setup";
const eventId = process.argv[3];
const sessionId = process.argv[4];

async function setup() {
  const slug = `published-agenda-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const event = await events.create({
    name: "Pacific Tabletop Summit",
    slug,
    type: "CONFERENCE",
    websiteUrl: "https://example.test/pacific-tabletop-summit",
    location: "Oakland, CA",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-03-13T17:00:00.000Z"),
    endsAt: new Date("2027-03-15T00:00:00.000Z"),
    theme: "Playful systems",
  });
  const mainHall = await rooms.create({ eventId: event.id, name: "Main Hall" });
  const designStudio = await rooms.create({ eventId: event.id, name: "Design Studio" });
  const strategy = await tracks.create({ eventId: event.id, name: "Strategy", color: "blue" });
  const community = await tracks.create({ eventId: event.id, name: "Community", color: "violet" });
  const [ada, grace] = await Promise.all([
    speakers.create({
      eventId: event.id,
      email: "ada.agenda@example.test",
      givenName: "Ada",
      familyName: "Lovelace",
    }),
    speakers.create({
      eventId: event.id,
      email: "grace.agenda@example.test",
      givenName: "Grace",
      familyName: "Hopper",
    }),
  ]);
  await Promise.all([
    speakers.updateProfile(event.id, ada.id, {
      preferredName: "Ada",
      organization: "Analytical Games",
      consentToPublishProfile: true,
      consentedAt: new Date("2027-01-10T18:00:00.000Z"),
    }),
    speakers.updateProfile(event.id, grace.id, {
      preferredName: "Grace",
      organization: "Compiler Cooperative",
      consentToPublishProfile: true,
      consentedAt: new Date("2027-01-10T18:00:00.000Z"),
    }),
  ]);
  const opening = await sessions.createManual({
    eventId: event.id,
    title: "Opening strategy keynote",
    description: "A practical tour of asymmetric play.",
    durationMinutes: 45,
    trackId: strategy.id,
    speakerIds: [ada.id],
  });
  const roundtable = await sessions.createManual({
    eventId: event.id,
    title: "Community roundtable",
    description: "Building welcoming tables together.",
    durationMinutes: 60,
    trackId: community.id,
    speakerIds: [grace.id],
  });
  const dstLab = await sessions.createManual({
    eventId: event.id,
    title: "Daylight saving design lab",
    description: "A second-day session across the DST boundary.",
    durationMinutes: 45,
    trackId: strategy.id,
    speakerIds: [ada.id, grace.id],
  });
  await placements.place({
    eventId: event.id,
    sessionId: opening.id,
    roomId: mainHall.id,
    startsAt: new Date("2027-03-13T18:00:00.000Z"),
    durationMinutes: 45,
    trackIds: [strategy.id],
    speakerIds: [ada.id],
  });
  await placements.place({
    eventId: event.id,
    sessionId: roundtable.id,
    roomId: designStudio.id,
    startsAt: new Date("2027-03-13T20:00:00.000Z"),
    durationMinutes: 60,
    trackIds: [community.id],
    speakerIds: [grace.id],
  });
  await placements.place({
    eventId: event.id,
    sessionId: dstLab.id,
    roomId: mainHall.id,
    startsAt: new Date("2027-03-14T17:00:00.000Z"),
    durationMinutes: 45,
    trackIds: [strategy.id],
    speakerIds: [ada.id, grace.id],
  });
  await publications.publish({ eventId: event.id, actorPrincipalId: "agenda-browser-admin", expectedVersion: 0 });
  return { eventId: event.id, eventSlug: event.slug, sessionId: opening.id };
}

async function republish(): Promise<undefined> {
  if (!eventId || !sessionId) throw new Error("republish requires event and session ids.");
  await sessions.update(eventId, sessionId, { title: "Republished strategy keynote" });
  const latest = await publications.latest(eventId);
  if (!latest) throw new Error("Expected a published program version.");
  await publications.republish({
    eventId,
    actorPrincipalId: "agenda-browser-admin",
    expectedVersion: latest.versionNumber,
  });
  return undefined;
}

async function unpublish(): Promise<undefined> {
  if (!eventId) throw new Error("unpublish requires an event id.");
  const latest = await publications.latest(eventId);
  if (!latest) throw new Error("Expected a published program version.");
  await publications.unpublish({
    eventId,
    actorPrincipalId: "agenda-browser-admin",
    expectedVersion: latest.versionNumber,
  });
  return undefined;
}

async function cleanup(): Promise<undefined> {
  if (eventId) await database.event.deleteMany({ where: { id: eventId } });
  return undefined;
}

try {
  let result: Awaited<ReturnType<typeof setup>> | undefined;
  switch (action) {
    case "setup":
      result = await setup();
      break;
    case "republish":
      result = await republish();
      break;
    case "unpublish":
      result = await unpublish();
      break;
    case "cleanup":
      result = await cleanup();
      break;
    default:
      throw new Error(`Unknown fixture action: ${action}`);
  }
  if (result) process.stdout.write(JSON.stringify(result));
} finally {
  await database.$disconnect();
}
