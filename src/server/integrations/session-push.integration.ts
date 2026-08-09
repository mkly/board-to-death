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
import { RepositoryError } from "../events/repositories.ts";
import type { PublishedProgramSnapshot } from "../published-program/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { type AcceleventsAdapter, DeterministicAcceleventsAdapter } from "./accelevents.ts";
import { AcceleventsProgramPushService, AcceleventsSessionPushService } from "./session-push.ts";
import { AcceleventsSyncRunService } from "./sync-run-control.ts";
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

async function createProgramFixture() {
  const event = await client.event.create({
    data: {
      name: "Session push test",
      slug: "session-push-test",
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-04-10T16:00:00.000Z"),
      endsAt: new Date("2027-04-11T00:00:00.000Z"),
    },
  });
  await client.integrationConfiguration.create({
    data: {
      eventId: event.id,
      provider: IntegrationProvider.ACCELEVENTS,
      versions: {
        create: {
          versionNumber: 1,
          remoteEventId: connection.remoteEventId,
          credentialReference: "local://program-push-test",
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
                definition: {
                  email: "profile.email",
                  firstName: "profile.givenName",
                  lastName: "profile.familyName",
                },
              },
            },
          },
          {
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
        ],
      },
    },
  });
  const speaker = await new SpeakerRepository(client).create({
    eventId: event.id,
    email: "program@example.test",
    givenName: "Program",
    familyName: "Speaker",
    consentToPublishProfile: true,
    consentedAt: new Date("2027-01-10T18:00:00.000Z"),
  });
  const sessionId = "session-program";
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
        id: sessionId,
        title: "Program session",
        description: null,
        durationMinutes: 30,
        trackId: null,
        speakerIds: [speaker.id],
      },
    ],
    placements: [
      {
        id: "placement-0",
        sessionId,
        roomId,
        startsAt: new Date(Date.UTC(2027, 3, 10, 16, 0)).toISOString(),
        endsAt: new Date(Date.UTC(2027, 3, 10, 16, 30)).toISOString(),
        trackIds: [],
        speakerIds: [],
      },
    ],
  };
  await client.publishedProgram.create({
    data: {
      eventId: event.id,
      versions: {
        create: {
          versionNumber: 1,
          state: PublishedProgramState.PUBLISHED,
          actorPrincipalId: "program-push-test",
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      },
    },
  });
  return { event, speaker, sessionId };
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
    adapter.failNext("create-session", "rate-limited", 300_000);
    let now = new Date("2027-02-01T17:00:00.000Z");
    const service = new AcceleventsSessionPushService(client, () => now);
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
      ["check-credentials", "update-session", "create-session"],
    );

    const replay = await service.push(input);
    assert.equal(replay.runId, first.runId);
    assert.equal(replay.replayed, true);
    assert.equal(adapter.requests.length, 3);

    await assert.rejects(
      service.push({
        ...input,
        idempotencyKey: "manual-retry:early:sessions",
        retryOfRunId: first.runId,
      }),
      (error: unknown) => error instanceof RepositoryError && error.code === "invalid-input",
    );
    now = new Date("2027-02-01T17:05:01.000Z");
    const retry = await service.push({
      ...input,
      idempotencyKey: "manual-retry:1:sessions",
      retryOfRunId: first.runId,
    });
    assert.equal(retry.records.length, 1);
    assert.equal(byLocalId(retry).get(fixture.createId)?.status, IntegrationSyncRecordStatus.SUCCEEDED);
    assert.equal(adapter.requests.length, 5);
    assert.equal(adapter.requests.at(-1)?.operation, "create-session");
    const retryRecord = await client.integrationSyncRecord.findFirstOrThrow({ where: { runId: retry.runId } });
    assert.equal(retryRecord.attemptNumber, 2);
    assert.ok(retryRecord.retryOfRecordId);

    const unchanged = await service.push({ ...input, idempotencyKey: "manual-retry:2:sessions" });
    assert.equal(byLocalId(unchanged).get(fixture.updateId)?.status, IntegrationSyncRecordStatus.SKIPPED);
    assert.equal(byLocalId(unchanged).get(fixture.createId)?.status, IntegrationSyncRecordStatus.SKIPPED);
    assert.equal(adapter.requests.length, 6);
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
    assert.equal(await client.integrationSyncRun.count({ where: { eventId: fixture.event.id } }), 3);
  });

  test("records credential failure without exposing credentials", async () => {
    const fixture = await createFixture();
    const adapter = new DeterministicAcceleventsAdapter({ ...connection });
    adapter.failNext("check-credentials", "unauthorized");

    const result = await new AcceleventsSessionPushService(client).push({
      eventId: fixture.event.id,
      idempotencyKey: "invalid-credentials",
      confirmed: true,
      adapter,
      connection,
    });

    assert.equal(result.status, IntegrationSyncRunStatus.FAILED);
    assert.equal(
      result.records.every(({ status }) => status !== IntegrationSyncRecordStatus.PENDING),
      true,
    );
    assert.equal(
      result.records
        .filter(({ status }) => status === IntegrationSyncRecordStatus.TERMINAL_FAILED)
        .every(({ errorCode }) => errorCode === "unauthorized"),
      true,
    );
    const persisted = await client.integrationSyncRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { records: true },
    });
    assert.equal(JSON.stringify(persisted).includes(connection.apiKey), false);
    assert.deepEqual(
      adapter.requests.map(({ operation }) => operation),
      ["check-credentials"],
    );
  });

  test("prevents concurrent event runs and stops at a requested cancellation boundary", async () => {
    const fixture = await createFixture();
    const baseAdapter = new DeterministicAcceleventsAdapter({ ...connection });
    let releaseCredentialCheck!: () => void;
    const credentialGate = new Promise<void>((resolve) => {
      releaseCredentialCheck = resolve;
    });
    let signalCredentialCheck!: () => void;
    const credentialStarted = new Promise<void>((resolve) => {
      signalCredentialCheck = resolve;
    });
    const adapter = new Proxy(baseAdapter, {
      get(target, property, receiver) {
        if (property === "checkCredentials") {
          return async (...args: Parameters<AcceleventsAdapter["checkCredentials"]>) => {
            signalCredentialCheck();
            await credentialGate;
            return target.checkCredentials(...args);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as AcceleventsAdapter;
    const pushService = new AcceleventsSessionPushService(client);
    const controlService = new AcceleventsSyncRunService(client);
    const firstPush = pushService.push({
      eventId: fixture.event.id,
      idempotencyKey: "cancelled-run",
      confirmed: true,
      adapter,
      connection,
    });
    await credentialStarted;

    await assert.rejects(
      pushService.push({
        eventId: fixture.event.id,
        idempotencyKey: "concurrent-run",
        confirmed: true,
        adapter: baseAdapter,
        connection,
      }),
      (error: unknown) => error instanceof Error && error.message.includes("already active"),
    );
    const running = await client.integrationSyncRun.findFirstOrThrow({
      where: { eventId: fixture.event.id, status: IntegrationSyncRunStatus.RUNNING },
    });
    assert.equal(await controlService.requestCancellation(fixture.event.id, running.id), true);
    assert.equal(await controlService.requestCancellation("00000000-0000-0000-0000-000000000000", running.id), false);
    releaseCredentialCheck();
    const cancelled = await firstPush;

    assert.equal(cancelled.status, IntegrationSyncRunStatus.CANCELLED);
    assert.equal(
      cancelled.records.every(({ status }) => status !== IntegrationSyncRecordStatus.SUCCEEDED),
      true,
    );
    assert.deepEqual(
      baseAdapter.requests.map(({ operation }) => operation),
      ["check-credentials"],
    );
    await assert.rejects(controlService.get("00000000-0000-0000-0000-000000000000", running.id));
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

  test("pushes speakers before the sessions that link them", async () => {
    const fixture = await createProgramFixture();
    const adapter = new DeterministicAcceleventsAdapter({ ...connection });
    const result = await new AcceleventsProgramPushService(client).push({
      eventId: fixture.event.id,
      idempotencyKey: "published-program:1",
      confirmed: true,
      adapter,
      connection,
    });

    assert.equal(result.speakers.status, IntegrationSyncRunStatus.SUCCEEDED);
    assert.equal(result.sessions.status, IntegrationSyncRunStatus.SUCCEEDED);
    assert.deepEqual(
      adapter.requests.map(({ operation }) => operation),
      ["check-credentials", "create-speaker", "check-credentials", "create-session"],
    );

    const speakerRemoteId = byLocalId(result.speakers).get(fixture.speaker.id)?.remoteId;
    const sessionRemoteId = byLocalId(result.sessions).get(fixture.sessionId)?.remoteId;
    if (!speakerRemoteId || !sessionRemoteId) throw new Error("The program push did not persist both remote ids.");
    const remote = await adapter.getSession(connection, sessionRemoteId);
    if (!remote.ok) throw new Error("The pushed session was not created remotely.");
    assert.deepEqual(remote.value.speakerRemoteIds, [speakerRemoteId]);
  });
});
