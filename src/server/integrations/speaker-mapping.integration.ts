import { PrismaPg } from "@prisma/adapter-pg";

import { IntegrationProvider, PrismaClient } from "../../generated/prisma/client.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { DeterministicAcceleventsAdapter } from "./accelevents.ts";
import { SpeakerMappingRepository } from "./speaker-mapping.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for speaker mapping integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: slug,
      slug,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-04-10T16:00:00.000Z"),
      endsAt: new Date("2027-04-11T00:00:00.000Z"),
    },
  });
}

async function createFixture() {
  const event = await createEvent("speaker-mapping-test-mixed");
  const configuration = await client.integrationConfiguration.create({
    data: {
      eventId: event.id,
      provider: IntegrationProvider.ACCELEVENTS,
      versions: {
        create: {
          versionNumber: 1,
          remoteEventId: "remote-event",
          credentialReference: "local://speaker-mapping-test",
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
  const speakers = new SpeakerRepository(client);
  const profiles = [
    { key: "create", email: "create@example.test", givenName: "Create", familyName: "Speaker", public: true },
    { key: "update", email: "update@example.test", givenName: "Updated", familyName: "Speaker", public: true },
    { key: "unchanged", email: "same@example.test", givenName: "Same", familyName: "Speaker", public: true },
    { key: "private", email: "private@example.test", givenName: "Private", familyName: "Speaker", public: false },
    { key: "invalid", email: "invalid@example.test", givenName: "Invalid", familyName: "Speaker", public: true },
    { key: "formula", email: "formula@example.test", givenName: "=2+3", familyName: "Speaker", public: true },
  ] as const;
  const created = new Map<string, Awaited<ReturnType<SpeakerRepository["create"]>>>();
  for (const profile of profiles) {
    const speaker = await speakers.create({
      eventId: event.id,
      email: profile.email,
      givenName: profile.givenName,
      familyName: profile.familyName,
      organization: profile.key === "update" ? "Mapped organization" : null,
      consentToPublishProfile: profile.public,
      consentedAt: profile.public ? new Date("2027-01-10T18:00:00.000Z") : null,
    });
    if (profile.key === "invalid") {
      await client.speakerProfileVersion.update({ where: { id: speaker.profile.id }, data: { email: "not-an-email" } });
    }
    created.set(profile.key, speaker);
  }
  const mappingVersionId = configuration.fieldMappings[0]?.versions[0]?.id;
  const update = created.get("update");
  const unchanged = created.get("unchanged");
  const privateSpeaker = created.get("private");
  if (!mappingVersionId || !update || !unchanged || !privateSpeaker) throw new Error("Fixture creation failed.");
  await client.integrationRemoteRecord.createMany({
    data: [
      {
        eventId: event.id,
        configurationId: configuration.id,
        mappingVersionId,
        resourceType: "speaker",
        localId: update.id,
        remoteId: "remote-update",
      },
      {
        eventId: event.id,
        configurationId: configuration.id,
        mappingVersionId,
        resourceType: "speaker",
        localId: unchanged.id,
        remoteId: "remote-unchanged",
      },
      {
        eventId: event.id,
        configurationId: configuration.id,
        mappingVersionId,
        resourceType: "speaker",
        localId: privateSpeaker.id,
        remoteId: "remote-private",
      },
    ],
  });
  return { event, created };
}

describe("Accelevents speaker mapping preview", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany({ where: { slug: { startsWith: "speaker-mapping-test-" } } });
  });

  after(async () => {
    await client.event.deleteMany({ where: { slug: { startsWith: "speaker-mapping-test-" } } });
    await client.$disconnect();
  });

  test("classifies mixed actions, protects private data, validates links, and paginates explanations", async () => {
    const { event, created } = await createFixture();
    const repository = new SpeakerMappingRepository(client);
    const adapter = new DeterministicAcceleventsAdapter({
      remoteEventId: "remote-event",
      apiKey: "runtime-key",
      pageSize: 1,
      speakers: [
        {
          remoteId: "remote-update",
          email: "update@example.test",
          firstName: "Old",
          lastName: "Speaker",
        },
        {
          remoteId: "remote-unchanged",
          email: "same@example.test",
          firstName: "Same",
          lastName: "Speaker",
        },
        {
          remoteId: "remote-private",
          email: "private@example.test",
          firstName: "Private",
          lastName: "Speaker",
        },
      ],
    });
    const preview = await repository.preview(
      event.id,
      adapter,
      { remoteEventId: "remote-event", apiKey: "runtime-key" },
      2,
      2,
    );

    assert.ok(preview);
    assert.equal(preview.connection, "connected");
    assert.equal(preview.page, 2);
    assert.equal(preview.pageCount, 3);
    assert.deepEqual(preview.counts, { create: 2, update: 1, unchanged: 1, skipped: 1, invalid: 1 });
    const all = await repository.preview(
      event.id,
      adapter,
      { remoteEventId: "remote-event", apiKey: "runtime-key" },
      1,
      100,
    );
    assert.ok(all);
    const byId = new Map(all.items.map((item) => [item.localId, item]));
    assert.equal(byId.get(created.get("private")?.id ?? "")?.action, "skipped");
    assert.equal(byId.get(created.get("private")?.id ?? "")?.outbound, null);
    assert.equal(byId.get(created.get("invalid")?.id ?? "")?.action, "invalid");
    assert.equal(byId.get(created.get("update")?.id ?? "")?.action, "update");
    assert.equal(byId.get(created.get("unchanged")?.id ?? "")?.action, "unchanged");
    assert.equal(byId.get(created.get("create")?.id ?? "")?.action, "create");
  });

  test("versions changed mappings and reports disconnected fake services without leaking records", async () => {
    const { event } = await createFixture();
    const repository = new SpeakerMappingRepository(client);
    const version = await repository.save(event.id, {
      email: "profile.email",
      firstName: "profile.givenName",
      lastName: "profile.organization",
    });
    assert.equal(version, 2);
    const stored = await repository.get(event.id);
    assert.deepEqual(stored, {
      versionNumber: 2,
      mapping: {
        email: "profile.email",
        firstName: "profile.givenName",
        lastName: "profile.organization",
      },
    });

    const adapter = new DeterministicAcceleventsAdapter({ remoteEventId: "remote-event", apiKey: "runtime-key" });
    const preview = await repository.preview(
      event.id,
      adapter,
      { remoteEventId: "remote-event", apiKey: "wrong-key" },
      1,
      10,
    );
    assert.ok(preview);
    assert.equal(preview.connection, "disconnected");
    assert.equal(preview.items.length, 0);
    assert.deepEqual(preview.counts, { create: 0, update: 0, unchanged: 0, skipped: 0, invalid: 0 });
  });

  test("exports only valid authorized outbound rows as formula-safe CSV without provider contact", async () => {
    const { event } = await createFixture();
    const csv = await new SpeakerMappingRepository(client).authorizedCsv(event.id);

    assert.ok(csv);
    assert.match(csv, /^"localId","email","firstName","lastName"\r\n/);
    assert.match(csv, /"'=2\+3"/);
    assert.doesNotMatch(csv, /private@example\.test/);
    assert.doesNotMatch(csv, /not-an-email/);
  });
});
