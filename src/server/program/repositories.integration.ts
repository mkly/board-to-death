import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { SpeakerResourceRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for program persistence integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const resources = new SpeakerResourceRepository(client);

async function createEvent(slug: string): Promise<string> {
  const event = await events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-03-13T17:00:00.000Z"),
    endsAt: new Date("2027-03-15T00:00:00.000Z"),
  });
  return event.id;
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

function versionId(page: { readonly versions: readonly { readonly id: string }[] }, index = 0): string {
  const version = page.versions[index];
  assert.ok(version);
  return version.id;
}

describe("speaker resource persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("publishes only explicit immutable resource versions in configured order", async () => {
    const eventId = await createEvent("resource-publication");
    const first = await resources.create({
      eventId,
      key: "arrival",
      slug: "arrival",
      title: "Arrival guide",
      bodyMarkdown: "Draft directions",
    });
    const second = await resources.create({
      eventId,
      key: "slides",
      slug: "slides",
      title: "Slide requirements",
      bodyMarkdown: "Draft slide guidance",
    });

    assert.deepEqual(await resources.listPublished(eventId), []);
    await resources.publish(eventId, first.id, versionId(first), new Date("2027-01-01T10:00:00.000Z"));
    await resources.publish(eventId, second.id, versionId(second), new Date("2027-01-01T10:01:00.000Z"));
    assert.deepEqual(
      (await resources.listPublished(eventId)).map(({ key, version }) => [key, version.bodyMarkdown]),
      [
        ["arrival", "Draft directions"],
        ["slides", "Draft slide guidance"],
      ],
    );

    const revised = await resources.revise(eventId, first.id, {
      bodyMarkdown: "Published directions",
      sortOrder: 2,
    });
    assert.equal((await resources.listPublished(eventId))[0]?.version.bodyMarkdown, "Draft directions");
    await resources.publish(eventId, first.id, versionId(revised, 1), new Date("2027-01-01T10:02:00.000Z"));
    assert.deepEqual(
      (await resources.listPublished(eventId)).map(({ key, version }) => [key, version.versionNumber]),
      [
        ["slides", 1],
        ["arrival", 2],
      ],
    );
    assert.deepEqual(
      revised.versions.map(({ versionNumber, bodyMarkdown }) => [versionNumber, bodyMarkdown]),
      [
        [1, "Draft directions"],
        [2, "Published directions"],
      ],
    );

    const backdated = await resources.revise(eventId, first.id, { bodyMarkdown: "Backdated directions" });
    await expectRepositoryError(
      resources.publish(eventId, first.id, versionId(backdated, 2), new Date("2027-01-01T09:00:00.000Z")),
      "invalid-input",
    );
    assert.equal((await resources.listPublished(eventId))[1]?.version.versionNumber, 2);
  });

  test("unpublishes and archives resources without exposing drafts or other events", async () => {
    const eventId = await createEvent("resource-lifecycle");
    const otherEventId = await createEvent("other-resources");
    const page = await resources.create({
      eventId,
      key: "travel",
      slug: "travel",
      title: "Travel",
      bodyMarkdown: "Private draft",
    });
    await expectRepositoryError(resources.publish(otherEventId, page.id, versionId(page)), "not-found");
    await resources.publish(eventId, page.id, versionId(page), new Date("2027-01-02T10:00:00.000Z"));
    await resources.unpublish(eventId, page.id, new Date("2027-01-02T11:00:00.000Z"));
    assert.deepEqual(await resources.listPublished(eventId), []);

    const revised = await resources.revise(eventId, page.id, { bodyMarkdown: "Replacement draft" });
    await resources.publish(eventId, page.id, versionId(revised, 1), new Date("2027-01-02T12:00:00.000Z"));
    const archived = await resources.archive(eventId, page.id, new Date("2027-01-02T13:00:00.000Z"));
    assert.deepEqual(archived.archivedAt, new Date("2027-01-02T13:00:00.000Z"));
    assert.deepEqual(await resources.listPublished(eventId), []);
    await expectRepositoryError(resources.revise(eventId, page.id, { title: "Resurrected" }), "invalid-input");
  });
});
