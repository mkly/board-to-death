import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
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

process.stdout.write(
  JSON.stringify({
    eventSlug: fixture.eventSlug,
    populatedAuthHref: await authHref(fixture.speakerId),
    emptyAuthHref: await authHref(emptySpeaker.id),
    expiredSessionToken,
    ownSubmissionId: fixture.submissionId,
    outsiderSubmissionId: outsiderSubmission.id,
  }),
);
await database.$disconnect();
