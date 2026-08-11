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

  test("lists admin resource status transitions and excludes archived and other-event pages", async () => {
    const eventId = await createEvent("resource-admin-list");
    const otherEventId = await createEvent("resource-admin-list-other");
    const draftPage = await resources.create({
      eventId,
      key: "draft-page",
      slug: "draft-page",
      title: "Draft page",
      bodyMarkdown: "Still drafting",
    });
    const publishedPage = await resources.create({
      eventId,
      key: "published-page",
      slug: "published-page",
      title: "Published page",
      bodyMarkdown: "Live content",
    });
    await resources.create({
      eventId: otherEventId,
      key: "other-event-page",
      slug: "other-event-page",
      title: "Other event page",
      bodyMarkdown: "Not visible here",
    });

    assert.deepEqual(
      (await resources.list(eventId)).map(({ key, status }) => [key, status]),
      [
        ["draft-page", "draft"],
        ["published-page", "draft"],
      ],
    );

    await resources.publish(eventId, publishedPage.id, versionId(publishedPage), new Date("2027-02-01T09:00:00.000Z"));
    assert.deepEqual(
      (await resources.list(eventId)).map(({ key, status }) => [key, status]),
      [
        ["draft-page", "draft"],
        ["published-page", "published"],
      ],
    );

    await resources.unpublish(eventId, publishedPage.id, new Date("2027-02-01T10:00:00.000Z"));
    assert.deepEqual(
      (await resources.list(eventId)).find(({ key }) => key === "published-page")?.status,
      "unpublished",
    );

    const archived = await resources.archive(eventId, draftPage.id, new Date("2027-02-01T11:00:00.000Z"));
    assert.deepEqual(archived.archivedAt, new Date("2027-02-01T11:00:00.000Z"));
    assert.deepEqual(
      (await resources.list(eventId)).map(({ key }) => key),
      ["published-page"],
    );
    assert.deepEqual(
      (await resources.list(otherEventId)).map(({ key }) => key),
      ["other-event-page"],
    );
  });

  test("reorders event-owned resources and rejects a mismatched id set", async () => {
    const eventId = await createEvent("resource-reorder");
    const otherEventId = await createEvent("resource-reorder-other");
    const first = await resources.create({
      eventId,
      key: "first",
      slug: "first",
      title: "First",
      bodyMarkdown: "First content",
    });
    const second = await resources.create({
      eventId,
      key: "second",
      slug: "second",
      title: "Second",
      bodyMarkdown: "Second content",
    });
    const third = await resources.create({
      eventId,
      key: "third",
      slug: "third",
      title: "Third",
      bodyMarkdown: "Third content",
    });
    const otherPage = await resources.create({
      eventId: otherEventId,
      key: "elsewhere",
      slug: "elsewhere",
      title: "Elsewhere",
      bodyMarkdown: "Other event content",
    });

    assert.deepEqual(
      (await resources.list(eventId)).map(({ key }) => key),
      ["first", "second", "third"],
    );

    const reordered = await resources.reorder(eventId, [third.id, first.id, second.id]);
    assert.deepEqual(
      reordered.map(({ key }) => key),
      ["third", "first", "second"],
    );
    assert.deepEqual(
      (await resources.list(eventId)).map(({ key }) => key),
      ["third", "first", "second"],
    );
    assert.deepEqual(
      (await resources.list(otherEventId)).map(({ key }) => key),
      ["elsewhere"],
    );

    await expectRepositoryError(resources.reorder(eventId, [first.id, second.id]), "invalid-input");
    await expectRepositoryError(resources.reorder(eventId, [first.id, second.id, otherPage.id]), "invalid-input");
  });

  test("surfaces a revision saved on a published page as a pending version the admin list can publish", async () => {
    const eventId = await createEvent("resource-pending-revision");
    const page = await resources.create({
      eventId,
      key: "venue-map",
      slug: "venue-map",
      title: "Venue map",
      bodyMarkdown: "Original directions",
    });
    await resources.publish(eventId, page.id, versionId(page), new Date("2027-04-01T08:00:00.000Z"));

    const [published] = await resources.list(eventId);
    assert.equal(published?.status, "published");
    assert.equal(published?.pendingVersion, null);

    const revised = await resources.revise(eventId, page.id, { title: "Venue map v2", bodyMarkdown: "New directions" });
    const [withPending] = await resources.list(eventId);
    assert.equal(withPending?.status, "published");
    assert.equal(withPending?.version.bodyMarkdown, "Original directions");
    assert.equal(withPending?.pendingVersion?.id, versionId(revised, 1));
    assert.equal(withPending?.pendingVersion?.bodyMarkdown, "New directions");
    assert.equal((await resources.findPublished(eventId, "venue-map"))?.version.bodyMarkdown, "Original directions");

    await resources.publish(eventId, page.id, versionId(revised, 1), new Date("2027-04-01T09:00:00.000Z"));
    const [republished] = await resources.list(eventId);
    assert.equal(republished?.status, "published");
    assert.equal(republished?.pendingVersion, null);
    assert.equal(republished?.version.bodyMarkdown, "New directions");
    assert.equal((await resources.findPublished(eventId, "venue-map"))?.version.bodyMarkdown, "New directions");
  });

  test("republishes an unpublished version by cloning it into a new version", async () => {
    const eventId = await createEvent("resource-republish");
    const page = await resources.create({
      eventId,
      key: "checklist",
      slug: "checklist",
      title: "Checklist",
      bodyMarkdown: "Checklist content",
    });
    await resources.publish(eventId, page.id, versionId(page), new Date("2027-05-01T08:00:00.000Z"));
    await resources.unpublish(eventId, page.id, new Date("2027-05-01T09:00:00.000Z"));

    await resources.publish(eventId, page.id, versionId(page), new Date("2027-05-01T10:00:00.000Z"));
    const [republished] = await resources.list(eventId);
    assert.equal(republished?.status, "published");
    assert.equal(republished?.version.versionNumber, 2);
    assert.equal(republished?.version.bodyMarkdown, "Checklist content");
    assert.equal(republished?.pendingVersion, null);
    assert.equal((await resources.findPublished(eventId, "checklist"))?.version.bodyMarkdown, "Checklist content");
  });

  test("rejects slug collisions across pages on create, revise, and publish", async () => {
    const eventId = await createEvent("resource-slug-conflicts");
    const first = await resources.create({
      eventId,
      key: "shared",
      slug: "shared",
      title: "Shared slug owner",
      bodyMarkdown: "Original content",
    });

    await expectRepositoryError(
      resources.create({ eventId, key: "imitator", slug: "shared", title: "Imitator", bodyMarkdown: "Copycat" }),
      "conflict",
    );

    const second = await resources.create({
      eventId,
      key: "second",
      slug: "second",
      title: "Second",
      bodyMarkdown: "Second content",
    });
    await expectRepositoryError(resources.revise(eventId, second.id, { slug: "shared" }), "conflict");

    await resources.publish(eventId, first.id, versionId(first), new Date("2027-06-01T08:00:00.000Z"));
    const moved = await resources.revise(eventId, first.id, { slug: "moved" });
    await resources.publish(eventId, first.id, versionId(moved, 1), new Date("2027-06-01T09:00:00.000Z"));

    const claimant = await resources.create({
      eventId,
      key: "claimant",
      slug: "shared",
      title: "Claimant",
      bodyMarkdown: "Now owns the slug",
    });
    await resources.publish(eventId, claimant.id, versionId(claimant), new Date("2027-06-01T10:00:00.000Z"));

    await expectRepositoryError(
      resources.publish(eventId, first.id, versionId(moved, 0), new Date("2027-06-01T11:00:00.000Z")),
      "conflict",
    );
  });

  test("finds a published resource by slug and excludes drafts, unpublished, archived, and other events", async () => {
    const eventId = await createEvent("resource-find-published");
    const otherEventId = await createEvent("resource-find-published-other");
    const page = await resources.create({
      eventId,
      key: "onsite-parking",
      slug: "onsite-parking",
      title: "Onsite parking",
      bodyMarkdown: "Draft parking notes",
    });

    assert.equal(await resources.findPublished(eventId, "onsite-parking"), null);
    assert.equal(await resources.findPublished(otherEventId, "onsite-parking"), null);

    await resources.publish(eventId, page.id, versionId(page), new Date("2027-03-01T08:00:00.000Z"));
    const found = await resources.findPublished(eventId, "onsite-parking");
    assert.equal(found?.version.bodyMarkdown, "Draft parking notes");
    assert.equal(await resources.findPublished(otherEventId, "onsite-parking"), null);

    await resources.unpublish(eventId, page.id, new Date("2027-03-01T09:00:00.000Z"));
    assert.equal(await resources.findPublished(eventId, "onsite-parking"), null);

    const revised = await resources.revise(eventId, page.id, { bodyMarkdown: "Republished notes" });
    await resources.publish(eventId, page.id, versionId(revised, 1), new Date("2027-03-01T10:00:00.000Z"));
    await resources.archive(eventId, page.id, new Date("2027-03-01T11:00:00.000Z"));
    assert.equal(await resources.findPublished(eventId, "onsite-parking"), null);
  });
});
