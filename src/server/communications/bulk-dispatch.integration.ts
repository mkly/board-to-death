import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

import { PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { createDeterministicInfrastructure } from "../infrastructure/index.ts";
import { BulkCommunicationRepository, BulkDeliveryDispatcher } from "./bulk-dispatch.ts";
import assert from "node:assert/strict";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for bulk dispatch integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function createFixture(slug: string, names = ["Ada Lovelace", "Grace Hopper", "Lin Speaker"]) {
  const event = await client.event.create({
    data: {
      name: `Event ${slug}`,
      slug,
      timezone: "America/Los_Angeles",
      location: "Oakland, California",
      startsAt: new Date("2027-05-10T16:00:00.000Z"),
      endsAt: new Date("2027-05-12T00:00:00.000Z"),
    },
  });
  const template = await client.communicationTemplate.create({
    data: {
      eventId: event.id,
      key: "speaker-update",
      name: "Speaker update",
      versions: {
        create: {
          version: 1,
          subjectTemplate: "Hello {{ recipient.name }} for {{ event.name }}",
          htmlTemplate: "Your update starts on {{ event.start_date }} in {{ event.location }}.",
          textTemplate: "Hello {{ recipient.name }} at {{ recipient.email }}.",
        },
      },
    },
    include: { versions: true },
  });
  const speakers = [];
  for (const [index, name] of names.entries()) {
    const [givenName = "Speaker", ...familyParts] = name.split(" ");
    const familyName = familyParts.join(" ") || "Person";
    speakers.push(
      await client.speaker.create({
        data: {
          eventId: event.id,
          normalizedEmail: `speaker-${index.toString()}@${slug}.example.test`,
          profileVersions: {
            create: {
              versionNumber: 1,
              email: `speaker-${index.toString()}@${slug}.example.test`,
              givenName,
              familyName,
              consentToReceiveEmail: true,
              consentedAt: new Date("2027-01-01T00:00:00.000Z"),
            },
          },
        },
      }),
    );
  }
  const version = template.versions[0];
  if (!version) throw new Error("Expected a communication template version.");
  return { event, template, version, speakers, audience: { speakerIds: speakers.map(({ id }) => id) } };
}

describe("bulk communication dispatch", () => {
  beforeAll(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany({ where: { slug: { startsWith: "bulk-dispatch-test-" } } });
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  test("snapshots current eligible content and returns the original delivery for duplicate confirmations", async () => {
    const fixture = await createFixture("bulk-dispatch-test-snapshot-event", ["Ada Lovelace"]);
    const repository = new BulkCommunicationRepository(client);
    const first = await repository.confirm({
      eventId: fixture.event.id,
      templateId: fixture.template.id,
      idempotencyKey: "bulk:stable-confirmation",
      audience: fixture.audience,
    });
    assert.equal(first.duplicate, false);
    assert.equal(
      first.delivery.recipients[0]?.subjectSnapshot,
      "Hello Ada Lovelace for Event bulk-dispatch-test-snapshot-event",
    );

    await client.communicationTemplateVersion.create({
      data: {
        templateId: fixture.template.id,
        eventId: fixture.event.id,
        version: 2,
        subjectTemplate: "Changed {{ recipient.name }}",
        htmlTemplate: "Changed body",
      },
    });
    await client.speakerProfileVersion.create({
      data: {
        speakerId: fixture.speakers[0]?.id ?? "",
        versionNumber: 2,
        email: "changed@example.test",
        givenName: "Changed",
        familyName: "Speaker",
        consentToReceiveEmail: false,
      },
    });

    const duplicate = await repository.confirm({
      eventId: fixture.event.id,
      templateId: fixture.template.id,
      idempotencyKey: "bulk:stable-confirmation",
      audience: fixture.audience,
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.delivery.id, first.delivery.id);
    assert.equal(duplicate.delivery.templateVersion, 1);
    assert.equal(duplicate.delivery.recipients[0]?.email, "speaker-0@bulk-dispatch-test-snapshot-event.example.test");

    const other = await createFixture("bulk-dispatch-test-other-event", ["Other Speaker"]);
    await assert.rejects(
      repository.confirm({
        eventId: other.event.id,
        templateId: fixture.template.id,
        idempotencyKey: "bulk:forged-template",
        audience: other.audience,
      }),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
    assert.equal(await repository.get(other.event.id, first.delivery.id), null);
  });

  test("records mixed outcomes and retries only the due transient failure", async () => {
    const fixture = await createFixture("bulk-dispatch-test-mixed-outcomes");
    const repository = new BulkCommunicationRepository(client);
    const confirmed = await repository.confirm({
      eventId: fixture.event.id,
      templateId: fixture.template.id,
      idempotencyKey: "bulk:mixed-outcomes",
      audience: fixture.audience,
    });
    const infrastructure = createDeterministicInfrastructure({
      repositories: {},
      now: "2027-05-01T16:00:00.000Z",
    });
    infrastructure.email.failNext("rate-limited", 2_500);
    infrastructure.email.failNext("unauthorized");
    const dispatcher = new BulkDeliveryDispatcher({
      client,
      provider: infrastructure.email,
      providerName: "integration-mail",
      clock: infrastructure.clock,
    });

    const mixed = await dispatcher.process(fixture.event.id, confirmed.delivery.id);
    assert.deepEqual(
      mixed.map(({ status }) => status),
      ["retry-scheduled", "terminal-failure", "delivered"],
    );
    infrastructure.clock.advanceBy(2_000);
    assert.deepEqual(await dispatcher.process(fixture.event.id, confirmed.delivery.id), [
      { status: "skipped", reason: "not-ready", nextAttemptAt: "2027-05-01T16:00:02.500Z" },
    ]);
    infrastructure.clock.advanceBy(500);
    assert.equal((await dispatcher.process(fixture.event.id, confirmed.delivery.id))[0]?.status, "delivered");

    const stored = await repository.get(fixture.event.id, confirmed.delivery.id);
    assert.deepEqual(
      stored?.recipients.map(({ status, attempts }) => [status, attempts.length]),
      [
        ["delivered", 2],
        ["failed", 1],
        ["delivered", 1],
      ],
    );
  });

  test("cancellation stops new claims without rewinding the provider attempt already in flight", async () => {
    const fixture = await createFixture("bulk-dispatch-test-cancel-boundary", ["Ada Lovelace", "Grace Hopper"]);
    const repository = new BulkCommunicationRepository(client);
    const confirmed = await repository.confirm({
      eventId: fixture.event.id,
      templateId: fixture.template.id,
      idempotencyKey: "bulk:cancel-boundary",
      audience: fixture.audience,
    });
    let releaseProvider: (() => void) | undefined;
    let signalProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      signalProviderStarted = resolve;
    });
    let providerCalls = 0;
    const provider = {
      send: async () => {
        providerCalls += 1;
        signalProviderStarted?.();
        await new Promise<void>((resolve) => {
          releaseProvider = resolve;
        });
        return {
          ok: true as const,
          value: { messageId: `provider-${providerCalls.toString()}`, acceptedAt: "2027-05-01T16:00:00.000Z" },
        };
      },
    };
    const infrastructure = createDeterministicInfrastructure({
      repositories: {},
      now: "2027-05-01T16:00:00.000Z",
    });
    const running = new BulkDeliveryDispatcher({
      client,
      provider,
      providerName: "blocking-mail",
      clock: infrastructure.clock,
    }).process(fixture.event.id, confirmed.delivery.id);

    await providerStarted;
    await repository.cancel(fixture.event.id, confirmed.delivery.id, infrastructure.clock.now());
    releaseProvider?.();
    const results = await running;
    assert.deepEqual(
      results.map((result) => (result.status === "skipped" ? `${result.status}:${result.reason}` : result.status)),
      ["delivered", "skipped:cancelled"],
    );
    assert.equal(providerCalls, 1);
  });
});
