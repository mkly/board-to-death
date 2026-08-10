import { PrismaPg } from "@prisma/adapter-pg";

import {
  EventType,
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  type Prisma,
  PrismaClient,
  PublishedProgramState,
} from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import type { PublishedProgramSnapshot } from "../../../src/server/published-program/repositories.ts";
import { grantSeededOrganizationAccess } from "./organization-access.ts";
import { randomUUID } from "node:crypto";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createAdministratorSession(): Promise<string> {
  const links: string[] = [];
  const browserAuth = createAuth({
    baseURL,
    database,
    isAllowedEmail: (email) => email.toLowerCase() === "admin@example.test",
    secret: "quality-gate-better-auth-secret-at-least-32-characters",
    sendMagicLink: async ({ url }) => {
      links.push(url);
    },
  });
  const signIn = await browserAuth.handler(
    new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: "admin@example.test", callbackURL: "/dashboard" }),
    }),
  );
  if (signIn.status !== 200) throw new Error(`Magic-link sign-in returned ${signIn.status}.`);
  const link = links[0];
  if (!link) throw new Error("Expected the browser administrator magic link to be delivered.");
  const verified = await browserAuth.handler(new Request(link, { redirect: "manual" }));
  const match = (verified.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=([^;]+)/);
  if (!match?.[1]) throw new Error("Expected Better Auth to create a browser session cookie.");
  await grantSeededOrganizationAccess("admin@example.test");
  return match[1];
}

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const eventId = randomUUID();
  const speakerId = randomUUID();
  const roomId = randomUUID();
  const trackId = randomUUID();
  const eventSlug = `browser-session-preview-${suffix}`;
  const sessionIds = Array.from({ length: 11 }, () => randomUUID());
  const snapshot: PublishedProgramSnapshot = {
    schemaVersion: 1,
    event: {
      id: eventId,
      name: "Browser Mapping Summit",
      slug: eventSlug,
      websiteUrl: null,
      location: "Oakland, CA",
      timezone: "America/Los_Angeles",
      startsAt: "2027-03-13T17:00:00.000Z",
      endsAt: "2027-03-14T01:00:00.000Z",
      theme: "Reliable event integrations",
    },
    rooms: [{ id: roomId, name: "Main Hall", sortOrder: 0 }],
    tracks: [{ id: trackId, name: "Operations", color: "blue", sortOrder: 0 }],
    speakers: [
      {
        id: speakerId,
        givenName: "Ada",
        familyName: "Lovelace",
        preferredName: "Ada",
        pronouns: null,
        organization: null,
        jobTitle: null,
        biography: null,
        websiteUrl: null,
        photoObjectKey: null,
      },
    ],
    sessions: sessionIds.map((id, index) => ({
      id,
      title: index === 0 ? "=Formula-safe keynote" : `Session ${index + 1}`,
      description: `Public description ${index + 1}`,
      durationMinutes: 30,
      trackId,
      speakerIds: [speakerId],
    })),
    placements: sessionIds.map((sessionId, index) => ({
      id: randomUUID(),
      sessionId,
      roomId,
      startsAt: new Date(Date.UTC(2027, 2, 13, 17, index * 30)).toISOString(),
      endsAt: new Date(Date.UTC(2027, 2, 13, 17, index * 30 + 30)).toISOString(),
      trackIds: [trackId],
      speakerIds: [speakerId],
    })),
  };

  await database.event.create({
    data: {
      id: eventId,
      name: snapshot.event.name,
      slug: eventSlug,
      type: EventType.CONFERENCE,
      timezone: snapshot.event.timezone,
      startsAt: new Date(snapshot.event.startsAt),
      endsAt: new Date(snapshot.event.endsAt),
      rooms: { create: { id: roomId, name: "Main Hall", sortOrder: 0 } },
      tracks: { create: { id: trackId, name: "Operations", color: "blue", sortOrder: 0 } },
      speakers: {
        create: {
          id: speakerId,
          normalizedEmail: "ada@example.test",
          profileVersions: {
            create: {
              versionNumber: 1,
              email: "ada@example.test",
              givenName: "Ada",
              familyName: "Lovelace",
              consentToPublishProfile: true,
              consentedAt: new Date("2027-01-10T18:00:00.000Z"),
            },
          },
        },
      },
      publishedProgram: {
        create: {
          versions: {
            create: {
              versionNumber: 1,
              state: PublishedProgramState.PUBLISHED,
              actorPrincipalId: "browser-admin",
              snapshot: snapshot as unknown as Prisma.InputJsonValue,
            },
          },
        },
      },
      integrationConfigurations: {
        create: {
          provider: IntegrationProvider.ACCELEVENTS,
          versions: {
            create: {
              versionNumber: 1,
              remoteEventId: "browser-remote-event",
              credentialReference: "env://BROWSER_ACCELEVENTS_KEY",
              settings: {},
            },
          },
          remoteRecords: {
            create: {
              resourceType: "speaker",
              localId: speakerId,
              remoteId: "remote-ada",
              status: IntegrationRemoteRecordStatus.ACTIVE,
            },
          },
        },
      },
    },
  });

  return { eventId, eventSlug, sessionToken: await createAdministratorSession() };
}

const action = process.argv[2];
try {
  await database.$connect();
  if (action === "setup") {
    process.stdout.write(JSON.stringify(await setup()));
  } else if (action === "cleanup") {
    const eventId = process.argv[3];
    if (!eventId) throw new Error("eventId is required for cleanup.");
    await database.event.deleteMany({ where: { id: eventId } });
  } else {
    throw new Error(`Unknown fixture action: ${action ?? "missing"}`);
  }
} finally {
  await database.$disconnect();
}
