import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.ts";
import { createAuth } from "../../../src/server/auth/auth-factory.ts";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("_test")) throw new Error("The event overview fixture requires a guarded *_test database.");

const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const adminEmail = "admin@example.test";
const day = 24 * 60 * 60 * 1000;

await database.event.deleteMany();
await database.verification.deleteMany();
await database.account.deleteMany();
await database.session.deleteMany();
await database.user.deleteMany();

const event = await database.event.create({
  data: {
    name: "Overview Summit",
    slug: "overview-summit",
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
  },
});
const otherEvent = await database.event.create({
  data: {
    name: "Other Overview Event",
    slug: "other-overview-event",
    timezone: "America/New_York",
    startsAt: new Date("2027-06-10T16:00:00.000Z"),
    endsAt: new Date("2027-06-12T00:00:00.000Z"),
  },
});
const emptyEvent = await database.event.create({
  data: {
    name: "Empty Overview Event",
    slug: "empty-overview-event",
    timezone: "America/Chicago",
    startsAt: new Date("2027-07-10T16:00:00.000Z"),
    endsAt: new Date("2027-07-12T00:00:00.000Z"),
  },
});

async function createFormVersion(eventId: string, key: string, title: string) {
  const form = await database.cfpForm.create({
    data: {
      eventId,
      key,
      versions: { create: { versionNumber: 1, schemaVersion: 1, title, customTypes: {} } },
    },
    include: { versions: true },
  });
  const version = form.versions[0];
  if (!version) throw new Error(`Expected a CFP form version for ${key}.`);
  return version;
}

async function createSpeaker(email: string, givenName: string, familyName: string, complete: boolean) {
  return database.speaker.create({
    data: {
      eventId: event.id,
      normalizedEmail: email,
      profileVersions: {
        create: {
          versionNumber: 1,
          email,
          givenName,
          familyName,
          biography: complete ? "Designs cooperative board games." : null,
          photoObjectKey: complete ? "headshots/ada.jpg" : null,
        },
      },
    },
  });
}

const keynoteForm = await createFormVersion(event.id, "keynote", "Keynote CFP");
const workshopForm = await createFormVersion(event.id, "workshop", "Workshop CFP");
const otherForm = await createFormVersion(otherEvent.id, "other", "Other event CFP");

const ada = await createSpeaker("ada@example.test", "Ada", "Lovelace", true);
const grace = await createSpeaker("grace@example.test", "Grace", "Hopper", false);
await database.track.create({
  data: { eventId: event.id, name: "Game Design", color: "neutral", sortOrder: 0 },
});

// 2026-01-05T02:30:00Z is 2026-01-04 18:30 in America/Los_Angeles, so the rendered timestamp proves
// the dashboard formats submission times in the event's own time zone rather than the server's.
const accepted = await database.cfpSubmission.create({
  data: {
    eventId: event.id,
    formVersionId: keynoteForm.id,
    kind: "ABSTRACT",
    status: "ACCEPTED",
    submittedAt: new Date("2026-01-05T02:30:00.000Z"),
    reviewStartedAt: new Date("2026-01-10T18:00:00.000Z"),
    decidedAt: new Date("2026-01-20T18:00:00.000Z"),
    participants: {
      create: [
        { speakerId: ada.id, sortOrder: 0 },
        { speakerId: grace.id, sortOrder: 1 },
      ],
    },
  },
});
const recent = await database.cfpSubmission.create({
  data: {
    eventId: event.id,
    formVersionId: workshopForm.id,
    kind: "ABSTRACT",
    status: "SUBMITTED",
    submittedAt: new Date(Date.now() - 2 * day),
    participants: { create: { speakerId: ada.id, sortOrder: 0 } },
  },
});
const rejected = await database.cfpSubmission.create({
  data: {
    eventId: event.id,
    formVersionId: keynoteForm.id,
    kind: "ABSTRACT",
    status: "REJECTED",
    submittedAt: new Date("2025-11-01T18:00:00.000Z"),
    reviewStartedAt: new Date("2025-11-05T18:00:00.000Z"),
    decidedAt: new Date("2025-11-10T18:00:00.000Z"),
  },
});
await database.cfpSubmission.create({
  data: { eventId: event.id, formVersionId: keynoteForm.id, kind: "ABSTRACT", status: "DRAFT", submittedAt: null },
});
await database.cfpSubmission.create({
  data: {
    eventId: otherEvent.id,
    formVersionId: otherForm.id,
    kind: "ABSTRACT",
    status: "SUBMITTED",
    submittedAt: new Date("2026-02-01T18:00:00.000Z"),
  },
});

const plan = await database.evaluationPlan.create({
  data: {
    eventId: event.id,
    key: "screening",
    versions: {
      create: { versionNumber: 1, title: "Screening plan", status: "ACTIVE", activatedAt: new Date() },
    },
  },
  include: { versions: true },
});
const planVersion = plan.versions[0];
if (!planVersion) throw new Error("Expected an evaluation plan version.");
const round = await database.evaluationRound.create({
  data: {
    planVersionId: planVersion.id,
    key: "screening",
    title: "Screening",
    sortOrder: 0,
    status: "OPEN",
    visibilitySnapshot: "BLIND",
    opensAt: new Date(),
  },
});
const reviewer = await database.evaluationReviewer.create({
  data: {
    eventId: event.id,
    identityId: "reviewer@example.test",
    email: "reviewer@example.test",
    displayName: "Reviewer One",
  },
});
await database.evaluationAssignment.createMany({
  data: [
    {
      roundId: round.id,
      submissionId: accepted.id,
      reviewerId: reviewer.id,
      status: "COMPLETED",
      completedAt: new Date(),
    },
    { roundId: round.id, submissionId: recent.id, reviewerId: reviewer.id, status: "ASSIGNED" },
  ],
});

const taskDefinition = await database.speakerTaskDefinition.create({
  data: {
    eventId: event.id,
    key: "biography",
    versions: { create: { versionNumber: 1, sortOrder: 0, title: "Review biography", applicability: {} } },
  },
  include: { versions: true },
});
const taskVersion = taskDefinition.versions[0];
if (!taskVersion) throw new Error("Expected a speaker task definition version.");
await database.speakerTaskAssignment.createMany({
  data: [
    {
      eventId: event.id,
      definitionId: taskDefinition.id,
      definitionVersionId: taskVersion.id,
      speakerId: ada.id,
      status: "PENDING",
      assignedAt: new Date(Date.now() - 30 * day),
      dueAt: new Date(Date.now() - 10 * day),
    },
    {
      eventId: event.id,
      definitionId: taskDefinition.id,
      definitionVersionId: taskVersion.id,
      speakerId: grace.id,
      status: "PENDING",
      assignedAt: new Date(Date.now() - 30 * day),
      dueAt: new Date(Date.now() + 30 * day),
    },
  ],
});

const unscheduled = await database.programSession.create({
  data: {
    eventId: event.id,
    kind: "PROMOTED",
    sourceSubmissionId: accepted.id,
    versions: { create: { versionNumber: 1, title: "Unscheduled keynote", durationMinutes: 45 } },
  },
});
// Promoted from a submission that was later rejected, so it must not be reported as awaiting a slot.
await database.programSession.create({
  data: {
    eventId: event.id,
    kind: "PROMOTED",
    sourceSubmissionId: rejected.id,
    versions: { create: { versionNumber: 1, title: "Withdrawn keynote", durationMinutes: 45 } },
  },
});
await database.programSession.create({
  data: {
    eventId: otherEvent.id,
    kind: "MANUAL",
    versions: {
      create: { versionNumber: 1, title: "Other event secret talk", durationMinutes: 30 },
    },
  },
});

let deliveredLink = "";
const browserAuth = createAuth({
  baseURL,
  database,
  isAllowedEmail: (email) => email === adminEmail,
  secret: "quality-gate-better-auth-secret-at-least-32-characters",
  sendMagicLink: async ({ url }) => {
    deliveredLink = url;
  },
});
await browserAuth.handler(
  new Request(new URL("/api/auth/sign-in/magic-link", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ email: adminEmail, callbackURL: "/dashboard" }),
  }),
);
if (deliveredLink === "") throw new Error("Expected the browser fixture to receive a magic link.");
const verified = await browserAuth.handler(new Request(deliveredLink, { redirect: "manual" }));
const sessionCookie = verified.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1];
if (!sessionCookie) throw new Error("Expected Better Auth to issue a browser session cookie.");

process.stdout.write(
  JSON.stringify({
    eventId: event.id,
    eventSlug: event.slug,
    emptyEventId: emptyEvent.id,
    emptyEventSlug: emptyEvent.slug,
    unscheduledSessionId: unscheduled.id,
    sessionCookie,
  }),
);
await database.$disconnect();
