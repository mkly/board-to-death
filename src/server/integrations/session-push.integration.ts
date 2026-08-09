import { PrismaPg } from "@prisma/adapter-pg";

import {
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  type Prisma,
  PrismaClient,
  PublishedProgramState,
} from "../../generated/prisma/client.ts";
import type { PublishedProgramSnapshot } from "../published-program/repositories.ts";
import { DeterministicAcceleventsAdapter } from "./accelevents.ts";
import { AcceleventsSessionPushService } from "./session-push.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for session push integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const connection = { remoteEventId: "remote-session-push", apiKey: "runtime-key" };

async function createFixture() {
  const event = await client.event.create({
    data: {
      name: "Session push test",
      slug: "session-push-test",
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-04-10T16:00:00.000Z"),
      endsAt: new Date("2027-04-11T00:00:00.000Z"),
    },
  });
  const configuration = await client.integrationConfiguration.create({
    data: {
      eventId: event.id,
      provider: IntegrationProvider.ACCELEVENTS,
      versions: {
        create: {
          versionNumber: 1,
          remoteEventId: connection.remoteEventId,
          credentialReference: "local://session-push-test",
          settings: {},
        },
      },
      fieldMappings: {
        create: {
          resourceType: "session",
          key: "outbound-session",
          versions: {
            create: {
              versionNumber: 1,
              definition: {
                title: "session.title",
                description: "session.description",
                speakers: "linked-speakers",
              },
            },
          },
        },
      },
    },
    include: { fieldMappings: { include: { versions: true } } },
  });
  const speakerId = "speaker-linked";
  const missingSpeakerId = "speaker-missing";
  const updateId = "session-update";
  const missingId = "session-missing-speaker";
  const createId = "session-create";
  const roomId = "room-main";
  const snapshot: PublishedProgramSnapshot = {
    schemaVersion: 1,
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      websiteUrl: null,
      location: null,
      timezone: event.timezone,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      theme: null,
    },
    rooms: [{ id: roomId, name: "Main", sortOrder: 0 }],
    tracks: [],
    speakers: [],
    sessions: [
      {
        id: updateId,
        title: "Updated session",
        description: "Changed",
        durationMinutes: 30,
        trackId: null,
        speakerIds: [speakerId],
      },
      {
        id: missingId,
        title: "Missing speaker",
        description: null,
        durationMinutes: 30,
        trackId: null,
        speakerIds: [missingSpeakerId],
      },
      {
        id: createId,
        title: "Created session",
        description: null,
        durationMinutes: 30,
        trackId: null,
        speakerIds: [],
      },
    ],
    placements: [updateId, missingId, createId].map((sessionId, index) => ({
      id: `placement-${index}`,
      sessionId,
      roomId,
      startsAt: new Date(Date.UTC(2027, 3, 10, 16, index * 30)).toISOString(),
      endsAt: new Date(Date.UTC(2027, 3, 10, 16, index * 30 + 30)).toISOString(),
      trackIds: [],
      speakerIds: [],
    })),
  };
  await client.publishedProgram.create({
    data: {
      eventId: event.id,
      versions: {
        create: {
          versionNumber: 1,
          state: PublishedProgramState.PUBLISHED,
          actorPrincipalId: "session-push-test",
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      },
    },
  });
  const mappingVersionId = configuration.fieldMappings[0]?.versions[0]?.id;
  if (!mappingVersionId) throw new Error("Missing session mapping version.");
  await client.integrationRemoteRecord.createMany({
    data: [
      {
        eventId: event.id,
        configurationId: configuration.id,
        resourceType: "speaker",
        localId: speakerId,
        remoteId: "remote-speaker",
      },
      {
        eventId: event.id,
        configurationId: configuration.id,
        mappingVersionId,
        resourceType: "session",
        localId: updateId,
        remoteId: "remote-update",
        comparisonHash: "old-hash",
      },
    ],
  });
  return { event, configuration, updateId, missingId, createId };
}

function byLocalId(result: Awaited<ReturnType<AcceleventsSessionPushService["push"]>>) {
  return new Map(result.records.map((record) => [record.localId, record]));
}

async function deleteFixtures(): Promise<void> {
  const events = await client.event.findMany({
    where: { slug: "session-push-test" },
    select: { id: true },
  });
  const eventIds = events.map(({ id }) => id);
  if (eventIds.length === 0) return;
  await client.integrationSyncRecord.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
}

describe("Accelevents session push", () => {
  before(async () => client.$connect());
  beforeEach(deleteFixtures);
  after(async () => {
    await deleteFixtures();
    await client.$disconnect();
  });

  test("orders linked sessions after speakers and remains duplicate-safe across mixed outcomes and retries", async () => {
    const fixture = await createFixture();
    const adapter = new DeterministicAcceleventsAdapter({
      ...connection,
      speakers: [
        { remoteId: "remote-speaker", email: "linked@example.test", firstName: "Linked", lastName: "Speaker" },
      ],
      sessions: [{ remoteId: "remote-update", title: "Old", description: "", speakerRemoteIds: ["remote-speaker"] }],
    });
    adapter.failNext("create-session", "unavailable");
    const service = new AcceleventsSessionPushService(client, () => new Date("2027-02-01T17:00:00.000Z"));
    const input = {
      eventId: fixture.event.id,
      idempotencyKey: "published-program:1:sessions",
      confirmed: true,
      adapter,
      connection,
    } as const;
    const first = await service.push(input);
    assert.equal(first.status, IntegrationSyncRunStatus.PARTIALLY_FAILED);
    assert.equal(byLocalId(first).get(fixture.updateId)?.status, IntegrationSyncRecordStatus.SUCCEEDED);
    assert.equal(byLocalId(first).get(fixture.missingId)?.status, IntegrationSyncRecordStatus.VALIDATION_FAILED);
    assert.equal(byLocalId(first).get(fixture.createId)?.status, IntegrationSyncRecordStatus.RETRIABLE_FAILED);
    assert.deepEqual(
      adapter.requests.map(({ operation }) => operation),
      ["update-session", "create-session"],
    );

    const replay = await service.push(input);
    assert.equal(replay.runId, first.runId);
    assert.equal(replay.replayed, true);
    assert.equal(adapter.requests.length, 2);

    const retry = await service.push({ ...input, idempotencyKey: "manual-retry:1:sessions" });
    assert.equal(byLocalId(retry).get(fixture.updateId)?.status, IntegrationSyncRecordStatus.SKIPPED);
    assert.equal(byLocalId(retry).get(fixture.createId)?.status, IntegrationSyncRecordStatus.SUCCEEDED);
    assert.equal(adapter.requests.length, 3);
    assert.equal(adapter.requests.at(-1)?.operation, "create-session");

    const unchanged = await service.push({ ...input, idempotencyKey: "manual-retry:2:sessions" });
    assert.equal(byLocalId(unchanged).get(fixture.updateId)?.status, IntegrationSyncRecordStatus.SKIPPED);
    assert.equal(byLocalId(unchanged).get(fixture.createId)?.status, IntegrationSyncRecordStatus.SKIPPED);
    assert.equal(adapter.requests.length, 3);
    const persisted = await client.integrationSyncRecord.findFirst({
      where: { runId: retry.runId, localId: fixture.createId },
    });
    assert.ok(persisted?.remoteRecordId);
    assert.equal(persisted.status, IntegrationSyncRecordStatus.SUCCEEDED);
    assert.equal(
      await client.integrationRemoteRecord.count({
        where: { configurationId: fixture.configuration.id, resourceType: "session" },
      }),
      2,
    );
  });

  test("preserves a stale remote identifier when the remote update fails", async () => {
    const fixture = await createFixture();
    await client.integrationRemoteRecord.update({
      where: {
        configurationId_resourceType_localId: {
          configurationId: fixture.configuration.id,
          resourceType: "session",
          localId: fixture.updateId,
        },
      },
      data: { remoteId: "stale-session", status: IntegrationRemoteRecordStatus.ACTIVE },
    });
    const result = await new AcceleventsSessionPushService(client).push({
      eventId: fixture.event.id,
      idempotencyKey: "stale-session-push",
      confirmed: true,
      adapter: new DeterministicAcceleventsAdapter({
        ...connection,
        speakers: [
          { remoteId: "remote-speaker", email: "linked@example.test", firstName: "Linked", lastName: "Speaker" },
        ],
      }),
      connection,
    });
    assert.equal(byLocalId(result).get(fixture.updateId)?.status, IntegrationSyncRecordStatus.TERMINAL_FAILED);
    const preserved = await client.integrationRemoteRecord.findUnique({
      where: {
        configurationId_resourceType_localId: {
          configurationId: fixture.configuration.id,
          resourceType: "session",
          localId: fixture.updateId,
        },
      },
    });
    assert.equal(preserved?.remoteId, "stale-session");
    assert.equal(preserved?.comparisonHash, "old-hash");
  });
});
