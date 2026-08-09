import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client.ts";
import { createRepresentativeFixtures, representativeFixture } from "./representative-fixtures.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for representative fixture integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

describe("representative database fixtures", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.integrationSyncRecord.deleteMany();
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("creates deterministic ordered records across the program workflow", async () => {
    const created = await createRepresentativeFixtures(client);
    const event = await client.event.findUniqueOrThrow({
      where: { id: created.eventId },
      include: {
        organization: true,
        rooms: { orderBy: { sortOrder: "asc" } },
        tracks: { orderBy: { sortOrder: "asc" } },
        cfpForms: { include: { versions: { include: { steps: { orderBy: { sortOrder: "asc" } } } } } },
        cfpSubmissions: { include: { categories: true, participants: true, revisions: true } },
        speakers: { include: { profileVersions: true, taskAssignments: true } },
        programSessions: {
          include: {
            agendaPlacement: { include: { speakers: true, tracks: true } },
            versions: { include: { participants: true } },
          },
        },
        evaluationPlans: { include: { versions: { include: { rounds: { include: { criteria: true } } } } } },
        integrationConfigurations: {
          include: {
            fieldMappings: { include: { versions: true } },
            remoteRecords: true,
            syncRuns: { include: { records: true } },
            versions: true,
          },
        },
      },
    });

    assert.equal(event.slug, representativeFixture.eventSlug);
    assert.equal(event.organization.id, representativeFixture.organizationId);
    assert.deepEqual(
      event.rooms.map(({ name, sortOrder }) => [name, sortOrder]),
      [
        ["Main Hall", 0],
        ["Design Studio", 1],
      ],
    );
    assert.deepEqual(
      event.tracks.map(({ name, sortOrder }) => [name, sortOrder]),
      [
        ["Game Design", 0],
        ["Community", 1],
      ],
    );
    assert.equal(event.cfpForms[0]?.versions[0]?.steps.length, 2);
    assert.equal(event.cfpSubmissions[0]?.revisions.length, 1);
    assert.equal(event.cfpSubmissions[0]?.participants[0]?.speakerId, representativeFixture.speakerId);
    assert.equal(event.speakers[0]?.profileVersions[0]?.preferredName, "Ada");
    assert.equal(event.speakers[0]?.taskAssignments.length, 1);
    assert.equal(event.programSessions[0]?.versions[0]?.participants[0]?.speakerId, representativeFixture.speakerId);
    assert.equal(event.programSessions[0]?.agendaPlacement?.roomId, representativeFixture.roomId);
    assert.deepEqual(
      event.programSessions[0]?.agendaPlacement?.tracks.map(({ trackId }) => trackId),
      [representativeFixture.trackId],
    );
    assert.equal(event.evaluationPlans[0]?.versions[0]?.rounds[0]?.criteria[0]?.key, "clarity");
    assert.equal(
      event.integrationConfigurations[0]?.versions[0]?.credentialReference,
      "local://adapters/accelevents/board-to-death-demo",
    );
    assert.equal(event.integrationConfigurations[0]?.fieldMappings[0]?.versions[0]?.versionNumber, 1);
    assert.equal(event.integrationConfigurations[0]?.remoteRecords[0]?.localId, representativeFixture.speakerId);
    assert.equal(event.integrationConfigurations[0]?.syncRuns[0]?.records[0]?.status, "SUCCEEDED");
    assert.deepEqual(event.integrationConfigurations[0]?.syncRuns[0]?.records[0]?.redactedRequestContext, {
      fields: ["email", "firstName", "lastName"],
      credential: "[REDACTED]",
    });
  });

  test("replaces only the named fixture and returns the same stable identifiers", async () => {
    const unrelated = await client.event.create({
      data: {
        name: "Unrelated Event",
        slug: "unrelated-event",
        timezone: "UTC",
        startsAt: new Date("2027-01-01T00:00:00.000Z"),
        endsAt: new Date("2027-01-02T00:00:00.000Z"),
      },
    });

    const first = await createRepresentativeFixtures(client);
    const second = await createRepresentativeFixtures(client);

    assert.deepEqual(second, first);
    assert.equal(await client.event.count({ where: { slug: representativeFixture.eventSlug } }), 1);
    assert.equal((await client.event.findUnique({ where: { id: unrelated.id } }))?.slug, "unrelated-event");
  });

  test("cascades the complete representative aggregate when its event is deleted", async () => {
    await createRepresentativeFixtures(client);
    await client.integrationSyncRecord.deleteMany({ where: { eventId: representativeFixture.eventId } });
    await client.event.delete({ where: { id: representativeFixture.eventId } });

    assert.equal(await client.cfpSubmission.count({ where: { id: representativeFixture.submissionId } }), 0);
    assert.equal(await client.speaker.count({ where: { id: representativeFixture.speakerId } }), 0);
    assert.equal(await client.programSession.count({ where: { id: representativeFixture.sessionId } }), 0);
    assert.equal(await client.evaluationPlan.count({ where: { id: representativeFixture.evaluationPlanId } }), 0);
    assert.equal(await client.agendaPlacement.count({ where: { id: representativeFixture.agendaPlacementId } }), 0);
    assert.equal(
      await client.integrationConfiguration.count({ where: { id: representativeFixture.integrationConfigurationId } }),
      0,
    );
    assert.equal(
      await client.speakerTaskDefinition.count({ where: { id: representativeFixture.taskDefinitionId } }),
      0,
    );
    assert.equal(await client.organization.count({ where: { id: representativeFixture.organizationId } }), 1);
  });
});
