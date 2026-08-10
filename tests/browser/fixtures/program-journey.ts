import { PrismaPg } from "@prisma/adapter-pg";

import {
  IntegrationProvider,
  PrismaClient,
  ProgramSessionContentApprovalStatus,
} from "../../../src/generated/prisma/client.ts";
import { AgendaPlacementRepository } from "../../../src/server/agenda/placements.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import { provisionMagicLinkUser } from "../../../src/server/auth/magic-link-user.ts";
import { EventRepository, RoomRepository, TrackRepository } from "../../../src/server/events/repositories.ts";
import { ProgramSessionRepository } from "../../../src/server/sessions/repositories.ts";
import { SpeakerRepository } from "../../../src/server/speakers/repositories.ts";
import { randomUUID } from "node:crypto";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
if (!databaseUrl.includes("_test")) {
  throw new Error("The program journey browser fixture requires a guarded *_test database.");
}

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";

async function createAdministratorSession(orgId: string): Promise<string> {
  let deliveredLink = "";
  const browserAuth = createAuth({
    baseURL,
    database,
    isAllowedEmail: (email) => email.toLowerCase() === adminEmail,
    secret: "quality-gate-better-auth-secret-at-least-32-characters",
    sendMagicLink: async ({ url }) => {
      deliveredLink = url;
    },
  });
  await provisionMagicLinkUser(database, { email: adminEmail });
  const signIn = await browserAuth.handler(
    new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: adminEmail, callbackURL: "/dashboard" }),
    }),
  );
  if (signIn.status !== 200) throw new Error(`Magic-link sign-in returned ${signIn.status}.`);
  if (!deliveredLink) throw new Error("Expected the program journey fixture to receive a magic link.");
  const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
  const sessionToken = (verified.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=([^;]+)/)?.[1];
  if (!sessionToken) throw new Error("Expected Better Auth to issue a browser session cookie.");

  const adminUser = await database.user.findFirst({ where: { email: adminEmail }, select: { id: true } });
  if (!adminUser) throw new Error("Expected the program journey fixture to create an admin user.");
  await database.organizationMember.upsert({
    where: { orgId_userId: { orgId, userId: adminUser.id } },
    update: { role: "OWNER", status: "ACTIVE", revokedAt: null },
    create: { orgId, userId: adminUser.id, role: "OWNER", status: "ACTIVE" },
  });
  return sessionToken;
}

async function setup() {
  const events = new EventRepository(database);
  const event = await events.create({
    name: "Program Journey Summit",
    slug: `program-journey-${randomUUID().slice(0, 8)}`,
    type: "CONFERENCE",
    location: "Oakland, CA",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-08T16:00:00.000Z"),
    endsAt: new Date("2027-05-09T02:00:00.000Z"),
    theme: "Shipping the schedule",
  });
  const room = await new RoomRepository(database).create({ eventId: event.id, name: "Main Hall" });
  const track = await new TrackRepository(database).create({ eventId: event.id, name: "Strategy", color: "blue" });
  const speakers = new SpeakerRepository(database);
  const [ada, grace] = await Promise.all([
    speakers.create({ eventId: event.id, email: "ada.journey@example.test", givenName: "Ada", familyName: "Lovelace" }),
    speakers.create({
      eventId: event.id,
      email: "grace.journey@example.test",
      givenName: "Grace",
      familyName: "Hopper",
    }),
  ]);
  await Promise.all([
    speakers.updateProfile(event.id, ada.id, {
      consentToPublishProfile: true,
      consentedAt: new Date("2027-01-10T18:00:00.000Z"),
    }),
    speakers.updateProfile(event.id, grace.id, {
      consentToPublishProfile: true,
      consentedAt: new Date("2027-01-10T18:00:00.000Z"),
    }),
  ]);
  const sessions = new ProgramSessionRepository(database);
  const keynote = await sessions.createManual({
    eventId: event.id,
    contentApprovalStatus: ProgramSessionContentApprovalStatus.APPROVED,
    title: "Journey keynote",
    description: "Opening the program journey.",
    durationMinutes: 45,
    trackId: track.id,
    speakerIds: [ada.id],
  });
  const roundtable = await sessions.createManual({
    eventId: event.id,
    contentApprovalStatus: ProgramSessionContentApprovalStatus.APPROVED,
    title: "Journey roundtable",
    description: "Closing discussion of the journey.",
    durationMinutes: 60,
    trackId: track.id,
    speakerIds: [grace.id],
  });
  const placements = new AgendaPlacementRepository(database);
  await placements.place({
    eventId: event.id,
    sessionId: keynote.id,
    roomId: room.id,
    startsAt: new Date("2027-05-08T17:00:00.000Z"),
    durationMinutes: 45,
    trackIds: [track.id],
    speakerIds: [ada.id],
  });
  await placements.place({
    eventId: event.id,
    sessionId: roundtable.id,
    roomId: room.id,
    startsAt: new Date("2027-05-08T19:00:00.000Z"),
    durationMinutes: 60,
    trackIds: [track.id],
    speakerIds: [grace.id],
  });
  await database.integrationConfiguration.create({
    data: {
      eventId: event.id,
      provider: IntegrationProvider.ACCELEVENTS,
      versions: {
        create: {
          versionNumber: 1,
          remoteEventId: "journey-remote-event",
          credentialReference: "env://JOURNEY_ACCELEVENTS_KEY",
          settings: {},
        },
      },
      fieldMappings: {
        create: [
          {
            resourceType: "speaker",
            key: "public-profile",
            versions: {
              create: {
                versionNumber: 1,
                definition: { email: "profile.email", firstName: "profile.givenName", lastName: "profile.familyName" },
              },
            },
          },
          {
            resourceType: "session",
            key: "outbound-session",
            versions: {
              create: {
                versionNumber: 1,
                definition: { title: "session.title", description: "session.description", speakers: "linked-speakers" },
              },
            },
          },
        ],
      },
    },
  });

  const { orgId } = await database.event.findUniqueOrThrow({ where: { id: event.id }, select: { orgId: true } });
  const sessionToken = await createAdministratorSession(orgId);
  return { eventId: event.id, eventSlug: event.slug, sessionToken };
}

const action = process.argv[2];
try {
  await database.$connect();
  if (action === "setup") {
    process.stdout.write(JSON.stringify(await setup()));
  } else if (action === "cleanup") {
    const eventId = process.argv[3];
    if (!eventId) throw new Error("eventId is required for cleanup.");
    // IntegrationSyncRecord.remoteRecord is onDelete: Restrict, so push-created sync records must be
    // cleared before the event cascade reaches remote records (same precaution as accelevents-sync-status.ts).
    await database.integrationSyncRecord.deleteMany({ where: { eventId } });
    await database.event.deleteMany({ where: { id: eventId } });
  } else {
    throw new Error(`Unknown fixture action: ${action ?? "missing"}`);
  }
} finally {
  await database.$disconnect();
}
