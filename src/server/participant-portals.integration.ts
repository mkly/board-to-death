import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.ts";
import { createRepresentativeFixtures } from "./database/representative-fixtures.ts";
import { listParticipantPortals, resolveParticipantPortal } from "./participant-portals.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for participant portal integration tests.");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const sectionTitles = {
  submissions: "Proposals",
  profile: "Details",
  tasks: "To do",
  sessions: "Program",
  resources: "Guides",
};
const contentVisibility = {
  submissions: true,
  profile: true,
  tasks: true,
  sessions: true,
  resources: true,
  files: true,
  forms: true,
};
const profileFieldVisibility = {
  phone: "editable",
  pronouns: "editable",
  organization: "view",
  jobTitle: "editable",
  biography: "editable",
  websiteUrl: "editable",
  accessibilityNeeds: "hidden",
};

async function createPortal(
  eventId: string,
  input: {
    readonly name: string;
    readonly slug: string;
    readonly sortOrder: number;
    readonly isDefault?: boolean;
    readonly audienceRules?: object;
  },
) {
  return client.participantPortal.create({
    data: {
      eventId,
      name: input.name,
      slug: input.slug,
      sortOrder: input.sortOrder,
      isDefault: input.isDefault ?? false,
      accentColor: "indigo",
      sectionTitles,
      contentVisibility,
      profileFieldVisibility,
      audienceRules: input.audienceRules ?? { roles: [], submissionStatuses: [], groupKinds: [] },
    },
  });
}

describe("participant portals", () => {
  before(async () => client.$connect());
  beforeEach(async () => {
    await client.integrationSyncRecord.deleteMany();
    await client.event.deleteMany();
  });
  after(async () => client.$disconnect());

  test("uses ordered audience precedence and an event-scoped default", async () => {
    const fixture = await createRepresentativeFixtures(client);
    await createPortal(fixture.eventId, {
      name: "Accepted",
      slug: "accepted",
      sortOrder: 0,
      audienceRules: { roles: [], submissionStatuses: ["ACCEPTED"], groupKinds: [] },
    });
    await createPortal(fixture.eventId, {
      name: "Program",
      slug: "program",
      sortOrder: 1,
      audienceRules: { roles: ["SPEAKER"], submissionStatuses: [], groupKinds: [] },
    });
    await createPortal(fixture.eventId, { name: "Everyone else", slug: "default", sortOrder: 2, isDefault: true });
    await client.cfpSubmission.update({
      where: { id: fixture.submissionId },
      data: { status: "SUBMITTED", reviewStartedAt: null, decidedAt: null, confirmedAt: null },
    });

    assert.equal(
      (await resolveParticipantPortal(client, { eventId: fixture.eventId, speakerId: fixture.speakerId })).slug,
      "program",
    );
    await client.cfpSubmission.update({
      where: { id: fixture.submissionId },
      data: {
        status: "ACCEPTED",
        reviewStartedAt: new Date("2027-01-31T18:00:00.000Z"),
        decidedAt: new Date("2027-02-01T18:00:00.000Z"),
      },
    });
    assert.equal(
      (await resolveParticipantPortal(client, { eventId: fixture.eventId, speakerId: fixture.speakerId })).slug,
      "accepted",
    );

    const unassigned = await client.speaker.create({
      data: {
        eventId: fixture.eventId,
        normalizedEmail: "unassigned@example.test",
        profileVersions: {
          create: { versionNumber: 1, email: "unassigned@example.test", givenName: "Una", familyName: "Signed" },
        },
      },
    });
    assert.equal(
      (await resolveParticipantPortal(client, { eventId: fixture.eventId, speakerId: unassigned.id })).slug,
      "default",
    );
  });

  test("matches event-scoped contact groups and parses field visibility", async () => {
    const fixture = await createRepresentativeFixtures(client);
    await createPortal(fixture.eventId, {
      name: "Sponsors",
      slug: "sponsors",
      sortOrder: 0,
      audienceRules: { roles: [], submissionStatuses: [], groupKinds: ["SPONSOR"] },
    });
    await createPortal(fixture.eventId, { name: "Default", slug: "default", sortOrder: 1, isDefault: true });
    const profile = await client.speakerProfileVersion.findFirstOrThrow({
      where: { speakerId: fixture.speakerId },
      orderBy: { versionNumber: "desc" },
    });
    const contact = await client.contact.create({
      data: {
        eventId: fixture.eventId,
        email: profile.email,
        givenName: profile.givenName,
        familyName: profile.familyName,
      },
    });
    await client.contactGroup.create({
      data: {
        eventId: fixture.eventId,
        kind: "SPONSOR",
        name: "Gold sponsors",
        slug: "gold-sponsors",
        members: { create: { contactId: contact.id } },
      },
    });

    const resolved = await resolveParticipantPortal(client, { eventId: fixture.eventId, speakerId: fixture.speakerId });
    assert.equal(resolved.slug, "sponsors");
    assert.equal(resolved.sectionTitles.tasks, "To do");
    assert.equal(resolved.profileFieldVisibility.organization, "view");
    assert.equal(resolved.profileFieldVisibility.accessibilityNeeds, "hidden");
    assert.deepEqual(
      (await listParticipantPortals(client, fixture.eventId)).map(({ slug }) => slug),
      ["sponsors", "default"],
    );
  });
});
