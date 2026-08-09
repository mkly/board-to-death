import { PrismaPg } from "@prisma/adapter-pg";

import {
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { DeterministicAcceleventsAdapter } from "./accelevents.ts";
import { AcceleventsSpeakerPushService } from "./speaker-push.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for speaker push integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const connection = { remoteEventId: "remote-speaker-push", apiKey: "runtime-key" };

async function createFixture(slug: string) {
  const event = await client.event.create({
    data: {
      name: slug,
      slug,
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
          credentialReference: "local://speaker-push-test",
          settings: { adapter: "deterministic" },
        },
      },
      fieldMappings: {
        create: {
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
      },
    },
    include: { fieldMappings: { include: { versions: true } } },
  });
  const speakerRepository = new SpeakerRepository(client);
  const profiles = [
    { key: "update", email: "update@example.test", firstName: "Updated", publish: true },
    { key: "create-fails", email: "create-fails@example.test", firstName: "Retry", publish: true },
    { key: "create-succeeds", email: "create-succeeds@example.test", firstName: "Create", publish: true },
    { key: "private", email: "private@example.test", firstName: "Private", publish: false },
    { key: "invalid", email: "invalid@example.test", firstName: "Invalid", publish: true },
  ] as const;
  const speakers = new Map<string, Awaited<ReturnType<SpeakerRepository["create"]>>>();
  for (const profile of profiles) {
    const speaker = await speakerRepository.create({
      eventId: event.id,
      email: profile.email,
      givenName: profile.firstName,
      familyName: "Speaker",
      consentToPublishProfile: profile.publish,
      consentedAt: profile.publish ? new Date("2027-01-10T18:00:00.000Z") : null,
    });
    speakers.set(profile.key, speaker);
  }
  const invalid = speakers.get("invalid");
  const update = speakers.get("update");
  const mappingVersionId = configuration.fieldMappings[0]?.versions[0]?.id;
  if (!invalid || !update || !mappingVersionId) throw new Error("Speaker push fixture creation failed.");
  await client.speakerProfileVersion.update({ where: { id: invalid.profile.id }, data: { email: "not-an-email" } });
  await client.integrationRemoteRecord.create({
    data: {
      eventId: event.id,
      configurationId: configuration.id,
      mappingVersionId,
      resourceType: "speaker",
      localId: update.id,
      remoteId: "remote-update",
      comparisonHash: "old-profile-hash",
    },
  });
  return { event, configuration, speakers };
}

function byLocalId(result: Awaited<ReturnType<AcceleventsSpeakerPushService["push"]>>) {
  return new Map(result.records.map((record) => [record.localId, record]));
}

async function deleteFixtures(): Promise<void> {
  const events = await client.event.findMany({
    where: { slug: { startsWith: "speaker-push-test-" } },
    select: { id: true },
  });
  const eventIds = events.map(({ id }) => id);
  if (eventIds.length === 0) return;
  await client.integrationSyncRecord.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
}

describe("Accelevents speaker push", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await deleteFixtures();
  });

  after(async () => {
    await deleteFixtures();
    await client.$disconnect();
  });

  test("records mixed create and update outcomes and commits only successful remote mutations", async () => {
    const { event, configuration, speakers } = await createFixture("speaker-push-test-mixed");
    const adapter = new DeterministicAcceleventsAdapter({
      ...connection,
      speakers: [
        {
          remoteId: "remote-update",
          email: "update@example.test",
          firstName: "Old",
          lastName: "Speaker",
        },
      ],
    });
    adapter.failNext("create-speaker", "unavailable");
    const result = await new AcceleventsSpeakerPushService(client, () => new Date("2027-02-01T17:00:00.000Z")).push({
      eventId: event.id,
      idempotencyKey: "confirmed-mixed-push",
      confirmed: true,
      adapter,
      connection,
    });

    assert.equal(result.status, IntegrationSyncRunStatus.PARTIALLY_FAILED);
    assert.equal(result.replayed, false);
    const records = byLocalId(result);
    assert.equal(records.get(speakers.get("update")?.id ?? "")?.status, IntegrationSyncRecordStatus.SUCCEEDED);
    assert.equal(
      records.get(speakers.get("create-fails")?.id ?? "")?.status,
      IntegrationSyncRecordStatus.RETRIABLE_FAILED,
    );
    assert.equal(records.get(speakers.get("create-succeeds")?.id ?? "")?.status, IntegrationSyncRecordStatus.SUCCEEDED);
    assert.equal(records.get(speakers.get("private")?.id ?? "")?.status, IntegrationSyncRecordStatus.SKIPPED);
    assert.equal(records.get(speakers.get("invalid")?.id ?? "")?.status, IntegrationSyncRecordStatus.VALIDATION_FAILED);
    assert.deepEqual(
      adapter.requests.map(({ operation, remoteId }) => [operation, remoteId ?? null]),
      [
        ["update-speaker", "remote-update"],
        ["create-speaker", null],
        ["create-speaker", null],
      ],
    );
    const links = await client.integrationRemoteRecord.findMany({
      where: { configurationId: configuration.id, resourceType: "speaker" },
      orderBy: { localId: "asc" },
    });
    assert.equal(links.length, 2);
    assert.equal(
      links.some(({ localId }) => localId === speakers.get("create-fails")?.id),
      false,
    );
    assert.equal(
      links.every(({ comparisonHash, lastSyncedAt }) => comparisonHash !== null && lastSyncedAt !== null),
      true,
    );
  });

  test("replays a confirmation key and retries only the prior failure on a later push", async () => {
    const { event, configuration, speakers } = await createFixture("speaker-push-test-idempotency");
    const adapter = new DeterministicAcceleventsAdapter({
      ...connection,
      speakers: [
        {
          remoteId: "remote-update",
          email: "update@example.test",
          firstName: "Old",
          lastName: "Speaker",
        },
      ],
    });
    adapter.failNext("create-speaker", "timeout");
    const service = new AcceleventsSpeakerPushService(client);
    const firstInput = {
      eventId: event.id,
      idempotencyKey: "stable-confirmation",
      confirmed: true,
      adapter,
      connection,
    } as const;
    const first = await service.push(firstInput);
    const requestsAfterFirst = adapter.requests.length;
    const replay = await service.push(firstInput);

    assert.equal(replay.runId, first.runId);
    assert.equal(replay.replayed, true);
    assert.equal(adapter.requests.length, requestsAfterFirst);

    const reordered = [...speakers.values()].reverse();
    for (const [index, speaker] of reordered.entries()) {
      await client.speaker.update({
        where: { id: speaker.id },
        data: { createdAt: new Date(Date.UTC(2027, 0, 1, 0, 0, index)) },
      });
    }
    const retry = await service.push({ ...firstInput, idempotencyKey: "later-confirmed-retry" });
    assert.equal(retry.status, IntegrationSyncRunStatus.PARTIALLY_FAILED);
    assert.equal(
      byLocalId(retry).get(speakers.get("create-fails")?.id ?? "")?.status,
      IntegrationSyncRecordStatus.SUCCEEDED,
    );
    assert.equal(adapter.requests.length, requestsAfterFirst + 1);
    assert.equal(adapter.requests.at(-1)?.operation, "create-speaker");

    const final = await service.push({ ...firstInput, idempotencyKey: "all-unchanged" });
    assert.equal(final.status, IntegrationSyncRunStatus.PARTIALLY_FAILED);
    assert.equal(adapter.requests.length, requestsAfterFirst + 1);
    const createdLinks = await client.integrationRemoteRecord.count({
      where: {
        configurationId: configuration.id,
        resourceType: "speaker",
        localId: { in: [speakers.get("create-fails")?.id ?? "", speakers.get("create-succeeds")?.id ?? ""] },
      },
    });
    assert.equal(createdLinks, 2);
  });

  test("requires confirmation and preserves an existing link when its remote identifier is stale", async () => {
    const { event, configuration, speakers } = await createFixture("speaker-push-test-stale");
    const update = speakers.get("update");
    if (!update) throw new Error("Missing update speaker fixture.");
    await client.integrationRemoteRecord.update({
      where: {
        configurationId_resourceType_localId: {
          configurationId: configuration.id,
          resourceType: "speaker",
          localId: update.id,
        },
      },
      data: { remoteId: "stale-remote-id", status: IntegrationRemoteRecordStatus.ACTIVE },
    });
    const adapter = new DeterministicAcceleventsAdapter(connection);
    const service = new AcceleventsSpeakerPushService(client);

    await assert.rejects(
      service.push({
        eventId: event.id,
        idempotencyKey: "not-confirmed",
        confirmed: false,
        adapter,
        connection,
      }),
      (error: unknown) => error instanceof RepositoryError && error.code === "invalid-input",
    );
    assert.equal(await client.integrationSyncRun.count({ where: { eventId: event.id } }), 0);

    const result = await service.push({
      eventId: event.id,
      idempotencyKey: "confirmed-stale-link",
      confirmed: true,
      adapter,
      connection,
    });
    const staleResult = byLocalId(result).get(update.id);
    assert.equal(staleResult?.status, IntegrationSyncRecordStatus.TERMINAL_FAILED);
    assert.equal(staleResult?.errorCode, "not-found");
    const preserved = await client.integrationRemoteRecord.findUnique({
      where: {
        configurationId_resourceType_localId: {
          configurationId: configuration.id,
          resourceType: "speaker",
          localId: update.id,
        },
      },
    });
    assert.equal(preserved?.remoteId, "stale-remote-id");
    assert.equal(preserved?.comparisonHash, "old-profile-hash");
  });
});
