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
const formDefinition = await database.speakerTaskDefinition.create({
  data: {
    eventId: fixture.eventId,
    key: "travel-assistance",
    versions: {
      create: {
        versionNumber: 1,
        sortOrder: 3,
        title: "Request travel assistance",
        description: "Tell the event team whether you need help with travel.",
        applicability: {},
        responseRequired: true,
        responseSchema: {
          kind: "portal-form",
          sections: [
            {
              id: "travel",
              title: "Travel",
              fields: [
                { id: "needs-help", label: "I need travel help", type: "checkbox", required: false },
                {
                  id: "travel-details",
                  label: "Travel details",
                  type: "textarea",
                  required: true,
                  visibleWhen: { fieldId: "needs-help", equals: true },
                },
              ],
            },
          ],
          confirmation: { subject: "Travel response received", message: "Travel response saved.", sendEmail: false },
        },
      },
    },
  },
  include: { versions: true },
});
const textVersion = textDefinition.versions[0];
const fileVersion = fileDefinition.versions[0];
const formVersion = formDefinition.versions[0];
if (!textVersion || !fileVersion || !formVersion) throw new Error("Expected speaker task definition versions.");
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
const formTask = await database.speakerTaskAssignment.create({
  data: {
    eventId: fixture.eventId,
    definitionId: formDefinition.id,
    definitionVersionId: formVersion.id,
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
const rehearsalResource = await database.speakerResourcePage.create({
  data: {
    eventId: fixture.eventId,
    key: "technical-rehearsal",
    versions: {
      create: {
        versionNumber: 1,
        slug: "technical-rehearsal",
        title: "Technical rehearsal",
        summary: "Check your setup before the event.",
        bodyMarkdown:
          '# Before you arrive\n\nRead the [venue map](https://example.test/venue).\n\n<iframe src="https://www.youtube.com/embed/allowed-recording" title="Allowed recording"></iframe>\n\n<iframe src="https://www.youtube.com/embed/not-configured" title="Not configured"></iframe>',
        allowedEmbedUrls: ["https://www.youtube.com/embed/allowed-recording"],
        sortOrder: 0,
        publishedAt: new Date("2027-02-24T18:00:00.000Z"),
      },
    },
  },
  include: { versions: true },
});
const rehearsalVersion = rehearsalResource.versions[0];
if (!rehearsalVersion) throw new Error("Expected the technical rehearsal resource version.");
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
        bodyMarkdown:
          '# Arrival guide\n\n<iframe src="https://www.youtube.com/embed/unconfigured-allowlist" title="Unconfigured allowlist"></iframe>',
        sortOrder: 1,
        publishedAt: new Date("2027-02-25T18:00:00.000Z"),
      },
    },
  },
});
await database.speakerResourcePage.create({
  data: {
    eventId: fixture.eventId,
    key: "draft-resource",
    versions: {
      create: {
        versionNumber: 1,
        slug: "draft-resource",
        title: "Draft resource",
        bodyMarkdown: "Private draft guidance.",
        sortOrder: 2,
      },
    },
  },
});
await database.speakerResourcePage.create({
  data: {
    eventId: fixture.eventId,
    key: "unpublished-resource",
    versions: {
      create: {
        versionNumber: 1,
        slug: "unpublished-resource",
        title: "Unpublished resource",
        bodyMarkdown: "Withdrawn guidance.",
        sortOrder: 3,
        publishedAt: new Date("2027-02-20T18:00:00.000Z"),
        unpublishedAt: new Date("2027-02-21T18:00:00.000Z"),
      },
    },
  },
});
await database.speakerResourcePage.create({
  data: {
    eventId: fixture.eventId,
    key: "archived-resource",
    archivedAt: new Date("2027-02-22T18:00:00.000Z"),
    versions: {
      create: {
        versionNumber: 1,
        slug: "archived-resource",
        title: "Archived resource",
        bodyMarkdown: "Archived guidance.",
        sortOrder: 4,
        publishedAt: new Date("2027-02-20T18:00:00.000Z"),
      },
    },
  },
});

const emptyResourceEvent = await database.event.create({
  data: {
    name: "Portal Without Resources",
    slug: "portal-without-resources",
    type: "CONFERENCE",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-01T16:00:00.000Z"),
    endsAt: new Date("2027-05-03T00:00:00.000Z"),
  },
});
const emptyResourceSpeaker = await database.speaker.create({
  data: {
    eventId: emptyResourceEvent.id,
    normalizedEmail: "no-resources@example.test",
    profileVersions: {
      create: {
        versionNumber: 1,
        email: "no-resources@example.test",
        givenName: "No",
        familyName: "Resources",
      },
    },
  },
});
await database.event.create({
  data: {
    name: "Other Portal Resources",
    slug: "other-portal-resources",
    type: "CONFERENCE",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-06-01T16:00:00.000Z"),
    endsAt: new Date("2027-06-03T00:00:00.000Z"),
    speakerResourcePages: {
      create: {
        key: "other-event-only",
        versions: {
          create: {
            versionNumber: 1,
            slug: "other-event-only",
            title: "Other event only",
            bodyMarkdown: "This must stay isolated.",
            sortOrder: 0,
            publishedAt: new Date("2027-05-20T18:00:00.000Z"),
          },
        },
      },
    },
  },
});

const auth = new SpeakerAuthService({ database });
async function authHref(eventId: string, eventSlug: string, speakerId: string): Promise<string> {
  const link = await auth.issueMagicLink({ eventId, speakerId });
  const url = new URL(`/portal/${eventSlug}/auth`, baseURL);
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
    populatedAuthHref: await authHref(fixture.eventId, fixture.eventSlug, fixture.speakerId),
    emptyAuthHref: await authHref(fixture.eventId, fixture.eventSlug, emptySpeaker.id),
    emptyResourceAuthHref: await authHref(emptyResourceEvent.id, emptyResourceEvent.slug, emptyResourceSpeaker.id),
    rehearsalVersionId: rehearsalVersion.id,
    expiredSessionToken,
    ownSubmissionId: fixture.submissionId,
    outsiderSubmissionId: outsiderSubmission.id,
    textTaskId: textTask.id,
    fileTaskId: fileTask.id,
    formTaskId: formTask.id,
    outsiderTaskId: outsiderTask.id,
    adminSessionCookie,
  }),
);
await database.$disconnect();
