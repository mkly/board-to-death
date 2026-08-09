import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { EventRepository } from "../events/repositories.ts";
import { ProgramSessionRepository } from "../sessions/repositories.ts";
import { BulkEditOperationRepository } from "./operations.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for bulk edit integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const sessions = new ProgramSessionRepository(client);
const operations = new BulkEditOperationRepository(client);

async function createEvent(slug: string): Promise<string> {
  const event = await events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-04-10T16:00:00.000Z"),
    endsAt: new Date("2027-04-12T00:00:00.000Z"),
  });
  return event.id;
}

describe("bulk edit operations", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("applies one value to selected contacts, groups, and sessions and records each operation", async () => {
    const eventId = await createEvent("bulk-edit-record-types");
    const contacts = await Promise.all(
      ["ada", "grace"].map((name) =>
        client.contact.create({
          data: { eventId, email: `${name}@example.test`, givenName: name, familyName: "Speaker" },
        }),
      ),
    );
    const groups = await Promise.all(
      ["Gold", "Silver"].map((name, index) =>
        client.contactGroup.create({
          data: { eventId, kind: "SPONSOR", name, slug: `tier-${index}` },
        }),
      ),
    );
    const programSessions = await Promise.all(
      ["Opening", "Closing"].map((title) => sessions.createManual({ eventId, title, durationMinutes: 30 })),
    );

    await operations.apply({
      eventId,
      entityType: "CONTACT",
      recordIds: contacts.map(({ id }) => id),
      field: "organization",
      value: "Board Guild",
      performedBy: "admin@example.test",
    });
    await operations.apply({
      eventId,
      entityType: "GROUP",
      recordIds: groups.map(({ id }) => id),
      field: "name",
      value: "Partner",
      performedBy: "admin@example.test",
    });
    await operations.apply({
      eventId,
      entityType: "SESSION",
      recordIds: programSessions.map(({ id }) => id),
      field: "durationMinutes",
      value: "60",
      performedBy: "admin@example.test",
    });

    assert.deepEqual(
      (await client.contact.findMany({ where: { eventId }, orderBy: { email: "asc" } })).map(
        ({ organization }) => organization,
      ),
      ["Board Guild", "Board Guild"],
    );
    assert.deepEqual(
      (await client.contactGroup.findMany({ where: { eventId }, orderBy: { slug: "asc" } })).map(({ name }) => name),
      ["Partner", "Partner"],
    );
    assert.deepEqual(
      (await sessions.list(eventId)).map(({ version }) => version.durationMinutes),
      [60, 60],
    );
    const audit = await client.bulkEditOperation.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(
      audit.map(({ entityType, requestedCount, succeededCount, performedBy }) => ({
        entityType,
        requestedCount,
        succeededCount,
        performedBy,
      })),
      [
        { entityType: "CONTACT", requestedCount: 2, succeededCount: 2, performedBy: "admin@example.test" },
        { entityType: "GROUP", requestedCount: 2, succeededCount: 2, performedBy: "admin@example.test" },
        { entityType: "SESSION", requestedCount: 2, succeededCount: 2, performedBy: "admin@example.test" },
      ],
    );
  });

  test("reports missing and cross-event records without changing them and keeps the failure audit event-scoped", async () => {
    const eventId = await createEvent("bulk-edit-isolation");
    const otherEventId = await createEvent("bulk-edit-other-event");
    const local = await client.contact.create({
      data: { eventId, email: "local@example.test", givenName: "Local", familyName: "Contact" },
    });
    const outsider = await client.contact.create({
      data: { eventId: otherEventId, email: "outside@example.test", givenName: "Other", familyName: "Contact" },
    });

    const result = await operations.apply({
      eventId,
      entityType: "CONTACT",
      recordIds: [local.id, outsider.id],
      field: "jobTitle",
      value: "Director",
      performedBy: "admin@example.test",
    });

    assert.equal(result.succeededCount, 1);
    assert.deepEqual(result.failures, [{ recordId: outsider.id, message: "The event-owned contact was not found." }]);
    assert.equal((await client.contact.findUniqueOrThrow({ where: { id: local.id } })).jobTitle, "Director");
    assert.equal((await client.contact.findUniqueOrThrow({ where: { id: outsider.id } })).jobTitle, null);
    const audit = await client.bulkEditOperation.findUniqueOrThrow({ where: { id: result.operationId } });
    assert.equal(audit.eventId, eventId);
    assert.equal(audit.requestedCount, 2);
    assert.equal(audit.succeededCount, 1);
    assert.deepEqual(audit.failureDetails, result.failures);
    assert.equal(await client.bulkEditOperation.count({ where: { eventId: otherEventId } }), 0);
  });
});
