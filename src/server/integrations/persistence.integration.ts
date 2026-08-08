import { PrismaPg } from "@prisma/adapter-pg";

import {
  EventType,
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration persistence tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: slug,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
    },
  });
}

async function createIntegration(slug: string) {
  const event = await createEvent(slug);
  const configuration = await client.integrationConfiguration.create({
    data: { eventId: event.id, provider: IntegrationProvider.ACCELEVENTS },
  });
  const configurationVersion = await client.integrationConfigurationVersion.create({
    data: {
      eventId: event.id,
      configurationId: configuration.id,
      versionNumber: 1,
      remoteEventId: `remote-${slug}`,
      credentialReference: `secret://events/${event.id}/accelevents`,
      settings: { apiBaseUrl: "https://api.example.test" },
    },
  });
  const mapping = await client.integrationFieldMapping.create({
    data: {
      eventId: event.id,
      configurationId: configuration.id,
      resourceType: "speaker",
      key: "public-profile",
    },
  });
  const mappingVersion = await client.integrationFieldMappingVersion.create({
    data: {
      eventId: event.id,
      configurationId: configuration.id,
      mappingId: mapping.id,
      versionNumber: 1,
      definition: { email: "profile.email", firstName: "profile.givenName", lastName: "profile.familyName" },
    },
  });

  return { event, configuration, configurationVersion, mapping, mappingVersion };
}

describe("external integration persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany({ where: { slug: { startsWith: "integration-test-" } } });
  });

  after(async () => {
    await client.event.deleteMany({ where: { slug: { startsWith: "integration-test-" } } });
    await client.$disconnect();
  });

  test("keeps configuration and field mapping changes as event-scoped immutable versions", async () => {
    const { event, configuration, mapping } = await createIntegration("integration-test-versioning");

    const configurationVersion = await client.integrationConfigurationVersion.create({
      data: {
        eventId: event.id,
        configurationId: configuration.id,
        versionNumber: 2,
        remoteEventId: "remote-version-2",
        credentialReference: `secret://events/${event.id}/accelevents-v2`,
        settings: { apiBaseUrl: "https://api.example.test", timeoutSeconds: 15 },
      },
    });
    const mappingVersion = await client.integrationFieldMappingVersion.create({
      data: {
        eventId: event.id,
        configurationId: configuration.id,
        mappingId: mapping.id,
        versionNumber: 2,
        definition: { email: "profile.email", firstName: "profile.preferredName" },
      },
    });

    assert.equal(configurationVersion.versionNumber, 2);
    assert.equal(mappingVersion.versionNumber, 2);
    assert.deepEqual(
      (
        await client.integrationConfigurationVersion.findMany({
          where: { configurationId: configuration.id },
          orderBy: { versionNumber: "asc" },
        })
      ).map(({ versionNumber, remoteEventId }) => [versionNumber, remoteEventId]),
      [
        [1, "remote-integration-test-versioning"],
        [2, "remote-version-2"],
      ],
    );
    await assert.rejects(
      client.integrationConfiguration.create({
        data: { eventId: event.id, provider: IntegrationProvider.ACCELEVENTS },
      }),
    );
  });

  test("records mixed outcomes and selects only failures whose retry window is due", async () => {
    const { event, configuration, configurationVersion, mappingVersion } =
      await createIntegration("integration-test-outcomes");
    const completedAt = new Date("2027-02-01T17:00:00.000Z");
    const retryAfter = new Date("2027-02-01T17:05:00.000Z");
    const run = await client.integrationSyncRun.create({
      data: {
        eventId: event.id,
        configurationId: configuration.id,
        configurationVersionId: configurationVersion.id,
        mappingVersionId: mappingVersion.id,
        idempotencyKey: "speaker-push-1",
        status: IntegrationSyncRunStatus.PARTIALLY_FAILED,
        startedAt: new Date("2027-02-01T16:59:00.000Z"),
        completedAt,
        records: {
          create: [
            {
              resourceType: "speaker",
              localId: "speaker-created",
              remoteId: "remote-created",
              inputHash: "hash-created",
              status: IntegrationSyncRecordStatus.SUCCEEDED,
              redactedRequestContext: { fields: ["email", "firstName"], credential: "[REDACTED]" },
              completedAt,
            },
            {
              resourceType: "speaker",
              localId: "speaker-unchanged",
              remoteId: "remote-unchanged",
              inputHash: "hash-unchanged",
              status: IntegrationSyncRecordStatus.SKIPPED,
              redactedRequestContext: { reason: "unchanged" },
              completedAt,
            },
            {
              resourceType: "speaker",
              localId: "speaker-rate-limited",
              inputHash: "hash-rate-limited",
              status: IntegrationSyncRecordStatus.RETRIABLE_FAILED,
              errorCode: "rate_limited",
              redactedRequestContext: { requestId: "request-123", credential: "[REDACTED]" },
              retryAfter,
              completedAt,
            },
            {
              resourceType: "speaker",
              localId: "speaker-invalid",
              inputHash: "hash-invalid",
              status: IntegrationSyncRecordStatus.VALIDATION_FAILED,
              errorCode: "missing_last_name",
              redactedRequestContext: { invalidFields: ["lastName"] },
              completedAt,
            },
          ],
        },
      },
      include: { records: true },
    });

    assert.deepEqual(
      run.records.map(({ status }) => status).sort(),
      [
        IntegrationSyncRecordStatus.RETRIABLE_FAILED,
        IntegrationSyncRecordStatus.SKIPPED,
        IntegrationSyncRecordStatus.SUCCEEDED,
        IntegrationSyncRecordStatus.VALIDATION_FAILED,
      ].sort(),
    );
    const eligible = await client.integrationSyncRecord.findMany({
      where: {
        eventId: event.id,
        status: IntegrationSyncRecordStatus.RETRIABLE_FAILED,
        retryAfter: { lte: new Date("2027-02-01T17:05:01.000Z") },
      },
    });
    assert.deepEqual(
      eligible.map(({ localId }) => localId),
      ["speaker-rate-limited"],
    );
    assert.deepEqual(eligible[0]?.redactedRequestContext, {
      requestId: "request-123",
      credential: "[REDACTED]",
    });
  });

  test("retains unique remote identifiers and marks stale links without discarding audit state", async () => {
    const { event, configuration, mappingVersion } = await createIntegration("integration-test-stale");
    const syncedAt = new Date("2027-02-01T16:00:00.000Z");
    const remoteRecord = await client.integrationRemoteRecord.create({
      data: {
        eventId: event.id,
        configurationId: configuration.id,
        mappingVersionId: mappingVersion.id,
        resourceType: "speaker",
        localId: "speaker-1",
        remoteId: "remote-speaker-1",
        comparisonHash: "public-profile-v1",
        lastSyncedAt: syncedAt,
      },
    });
    const staleAt = new Date("2027-02-02T16:00:00.000Z");
    const staleRecord = await client.integrationRemoteRecord.update({
      where: { id: remoteRecord.id },
      data: { status: IntegrationRemoteRecordStatus.STALE, staleAt },
    });

    assert.equal(staleRecord.status, IntegrationRemoteRecordStatus.STALE);
    assert.deepEqual(staleRecord.lastSyncedAt, syncedAt);
    assert.deepEqual(staleRecord.staleAt, staleAt);
    await assert.rejects(
      client.integrationRemoteRecord.create({
        data: {
          eventId: event.id,
          configurationId: configuration.id,
          resourceType: "speaker",
          localId: "speaker-1",
          remoteId: "a-different-remote-id",
        },
      }),
    );
  });

  test("rejects configuration, mapping, run, and remote-record references from another event", async () => {
    const first = await createIntegration("integration-test-first-event");
    const second = await createIntegration("integration-test-second-event");

    await assert.rejects(
      client.integrationSyncRun.create({
        data: {
          eventId: second.event.id,
          configurationId: first.configuration.id,
          configurationVersionId: first.configurationVersion.id,
          mappingVersionId: first.mappingVersion.id,
          idempotencyKey: "cross-event-run",
        },
      }),
    );
    await assert.rejects(
      client.integrationRemoteRecord.create({
        data: {
          eventId: first.event.id,
          configurationId: first.configuration.id,
          mappingVersionId: second.mappingVersion.id,
          resourceType: "speaker",
          localId: "cross-event-speaker",
          remoteId: "cross-event-remote-speaker",
        },
      }),
    );
  });
});
