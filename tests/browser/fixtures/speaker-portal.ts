import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";
import {
  createRepresentativeFixtures,
  representativeFixture,
} from "../../../src/server/database/representative-fixtures.ts";
import { SpeakerAuthService } from "../../../src/server/speaker-auth/speaker-auth.ts";
import { createHash, randomBytes } from "node:crypto";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("The speaker portal fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
await database.integrationSyncRecord.deleteMany();
await database.event.deleteMany();
const fixture = await createRepresentativeFixtures(database);

const emptySpeaker = await database.speaker.create({
  data: {
    eventId: fixture.eventId,
    normalizedEmail: "empty-speaker@example.test",
    profileVersions: {
      create: {
        versionNumber: 1,
        email: "empty-speaker@example.test",
        givenName: "Empty",
        familyName: "Speaker",
      },
    },
  },
});
const outsiderSpeaker = await database.speaker.create({
  data: {
    eventId: fixture.eventId,
    normalizedEmail: "outsider@example.test",
    profileVersions: {
      create: {
        versionNumber: 1,
        email: "outsider@example.test",
        givenName: "Outside",
        familyName: "Speaker",
      },
    },
  },
});
const outsiderSubmission = await database.cfpSubmission.create({
  data: {
    eventId: fixture.eventId,
    formVersionId: representativeFixture.formVersionId,
    kind: "ABSTRACT",
    status: "SUBMITTED",
    submittedAt: new Date("2027-01-21T18:00:00.000Z"),
    participants: { create: { speakerId: outsiderSpeaker.id, sortOrder: 0 } },
  },
});

const textDefinition = await database.speakerTaskDefinition.create({
  data: {
    eventId: fixture.eventId,
    key: "travel-details",
    versions: {
      create: {
        versionNumber: 1,
        sortOrder: 1,
        title: "Share your arrival details",
        description: "Tell the event team when you expect to arrive.",
        applicability: {},
        responseRequired: true,
        responseSchema: { type: "string", minLength: 5, maxLength: 500 },
      },
    },
  },
  include: { versions: true },
});
const fileDefinition = await database.speakerTaskDefinition.create({
  data: {
    eventId: fixture.eventId,
    key: "slides",
    versions: {
      create: {
        versionNumber: 1,
        sortOrder: 2,
        title: "Upload your slides",
        description: "Upload the current slide deck for review.",
        applicability: {},
        responseRequired: true,
        responseSchema: { type: "object", required: ["objectKey"] },
      },
    },
  },
  include: { versions: true },
});
const textVersion = textDefinition.versions[0];
const fileVersion = fileDefinition.versions[0];
if (!textVersion || !fileVersion) throw new Error("Expected speaker task definition versions.");
const textTask = await database.speakerTaskAssignment.create({
  data: {
    eventId: fixture.eventId,
    definitionId: textDefinition.id,
    definitionVersionId: textVersion.id,
    speakerId: fixture.speakerId,
    assignedAt: new Date("2020-01-01T18:00:00.000Z"),
    dueAt: new Date("2020-01-10T18:00:00.000Z"),
    transitions: { create: { toStatus: "PENDING", occurredAt: new Date("2020-01-01T18:00:00.000Z") } },
  },
});
const fileTask = await database.speakerTaskAssignment.create({
  data: {
    eventId: fixture.eventId,
    definitionId: fileDefinition.id,
    definitionVersionId: fileVersion.id,
    speakerId: fixture.speakerId,
    assignedAt: new Date("2027-02-21T18:00:00.000Z"),
    dueAt: new Date("2027-03-10T18:00:00.000Z"),
    transitions: { create: { toStatus: "PENDING", occurredAt: new Date("2027-02-21T18:00:00.000Z") } },
  },
});
const outsiderTask = await database.speakerTaskAssignment.create({
  data: {
    eventId: fixture.eventId,
    definitionId: textDefinition.id,
    definitionVersionId: textVersion.id,
    speakerId: outsiderSpeaker.id,
    assignedAt: new Date("2027-02-21T18:00:00.000Z"),
    transitions: { create: { toStatus: "PENDING", occurredAt: new Date("2027-02-21T18:00:00.000Z") } },
  },
});
await database.speakerResourcePage.create({
  data: {
    eventId: fixture.eventId,
    key: "arrival-guide",
    versions: {
      create: {
        versionNumber: 1,
        slug: "arrival-guide",
        title: "Speaker arrival guide",
        summary: "Where to check in and when to arrive.",
        bodyMarkdown: "# Arrival guide",
        sortOrder: 0,
        publishedAt: new Date("2027-02-25T18:00:00.000Z"),
      },
    },
  },
});

const auth = new SpeakerAuthService({ database });
async function authHref(speakerId: string): Promise<string> {
  const link = await auth.issueMagicLink({ eventId: fixture.eventId, speakerId });
  const url = new URL(`/portal/${fixture.eventSlug}/auth`, baseURL);
  url.searchParams.set("speakerId", speakerId);
  url.searchParams.set("token", link.token);
  return url.toString();
}

const expiredSessionToken = randomBytes(32).toString("base64url");
await database.speakerSession.create({
  data: {
    eventId: fixture.eventId,
    speakerId: fixture.speakerId,
    tokenHash: createHash("sha256").update(expiredSessionToken, "utf8").digest("hex"),
    expiresAt: new Date("2020-01-01T00:00:00.000Z"),
  },
});

let deliveredAdminLink = "";
const adminAuth = createAuth({
  baseURL,
  database,
  isAllowedEmail: (email) => email === "admin@example.test",
  secret: "quality-gate-better-auth-secret-at-least-32-characters",
  sendMagicLink: async ({ url }) => {
    deliveredAdminLink = url;
  },
});
await adminAuth.handler(
  new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ email: "admin@example.test", callbackURL: "/dashboard" }),
  }),
);
if (deliveredAdminLink === "") throw new Error("Expected the browser fixture to receive an admin magic link.");
const verifiedAdmin = await adminAuth.handler(new Request(deliveredAdminLink, { redirect: "manual" }));
const adminSessionCookie = verifiedAdmin.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!adminSessionCookie) throw new Error("Expected Better Auth to issue an admin session cookie.");

process.stdout.write(
  JSON.stringify({
    eventSlug: fixture.eventSlug,
    populatedAuthHref: await authHref(fixture.speakerId),
    emptyAuthHref: await authHref(emptySpeaker.id),
    expiredSessionToken,
    ownSubmissionId: fixture.submissionId,
    outsiderSubmissionId: outsiderSubmission.id,
    textTaskId: textTask.id,
    fileTaskId: fileTask.id,
    outsiderTaskId: outsiderTask.id,
    adminSessionCookie,
  }),
);
await database.$disconnect();
