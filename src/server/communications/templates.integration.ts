import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { EventType, PrismaClient } from "../../generated/prisma/client.ts";
import type { RepositoryError } from "../events/repositories.ts";
import { EmailTemplateRepository } from "./templates.ts";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://invalid:invalid@localhost:5432/invalid";
const describeWithDatabase = databaseUrl.includes("_test") ? describe : describe.skip;

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const templates = new EmailTemplateRepository(client);

async function createEvent(slug: string) {
  return client.event.create({
    data: {
      name: slug,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-01-10T17:00:00.000Z"),
      endsAt: new Date("2027-01-12T01:00:00.000Z"),
    },
  });
}

const definition = {
  key: "speaker-welcome",
  name: "Speaker welcome",
  subjectTemplate: "Welcome to {{event.name}}",
  bodyTemplate: "Hello {{speaker.name}}, your session is **{{session.title}}**.",
  textTemplate: "Hello {{speaker.name}}.",
};

describeWithDatabase("EmailTemplateRepository", () => {
  beforeAll(async () => {
    if (!databaseUrl.includes("_test")) {
      throw new Error("Email template integration tests require a guarded *_test DATABASE_URL");
    }

    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany({ where: { slug: { startsWith: "template-test-" } } });
  });

  afterAll(async () => {
    await client.event.deleteMany({ where: { slug: { startsWith: "template-test-" } } });
    await client.$disconnect();
  });

  test("creates event-scoped templates and keeps edits as immutable versions", async () => {
    const event = await createEvent("template-test-versioning");
    const created = await templates.create({ eventId: event.id, ...definition });
    const updated = await templates.createVersion(event.id, created.id, {
      ...definition,
      name: "Updated speaker welcome",
      subjectTemplate: "Your {{event.name}} session",
    });

    expect(created.version).toBe(1);
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("Updated speaker welcome");
    expect(updated.subjectTemplate).toBe("Your {{event.name}} session");
    expect(
      await client.communicationTemplateVersion.findMany({
        where: { templateId: created.id },
        orderBy: { version: "asc" },
        select: { version: true, subjectTemplate: true },
      }),
    ).toEqual([
      { version: 1, subjectTemplate: definition.subjectTemplate },
      { version: 2, subjectTemplate: "Your {{event.name}} session" },
    ]);
  });

  test("isolates reads and edits by event", async () => {
    const first = await createEvent("template-test-first");
    const second = await createEvent("template-test-second");
    const created = await templates.create({ eventId: first.id, ...definition });

    expect(await templates.get(second.id, created.id)).toBeNull();
    expect(await templates.list(second.id)).toEqual([]);
    await expect(templates.createVersion(second.id, created.id, definition)).rejects.toMatchObject({
      code: "not-found",
    } satisfies Partial<RepositoryError>);
  });

  test("rejects duplicate event keys while allowing the same key in another event", async () => {
    const first = await createEvent("template-test-key-first");
    const second = await createEvent("template-test-key-second");
    await templates.create({ eventId: first.id, ...definition });

    await expect(templates.create({ eventId: first.id, ...definition })).rejects.toMatchObject({
      code: "conflict",
    } satisfies Partial<RepositoryError>);
    const other = await templates.create({ eventId: second.id, ...definition });
    expect(other.key).toBe(definition.key);
  });
});
