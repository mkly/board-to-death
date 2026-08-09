import { PrismaPg } from "@prisma/adapter-pg";

import { EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { parseSubmissionView } from "../../lib/cfp/submission-table.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for submission view integration tests.");

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

async function createUser(id: string) {
  return client.user.create({
    data: {
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });
}

describe("CFP submission view persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
    await client.user.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("keeps saved views isolated per event and per administrator through updates and reset", async () => {
    const [firstEvent, secondEvent, firstAdmin, secondAdmin] = await Promise.all([
      createEvent("saved-view-first-event"),
      createEvent("saved-view-second-event"),
      createUser("saved-view-first-admin"),
      createUser("saved-view-second-admin"),
    ]);
    const firstView = {
      columns: ["formTitle", "answer:audience"],
      filters: { status: "ACCEPTED", search: "strategy" },
      sorting: { id: "formTitle", direction: "asc" },
    } as const;
    const secondEventView = {
      columns: ["applicant", "status"],
      filters: { status: "SUBMITTED" },
      sorting: { id: "submittedAt", direction: "desc" },
    } as const;
    const secondAdminView = {
      columns: ["email", "categories"],
      filters: { search: "speaker" },
      sorting: { id: "updatedAt", direction: "desc" },
    } as const;

    await Promise.all([
      client.cfpSubmissionView.create({
        data: { eventId: firstEvent.id, userId: firstAdmin.id, ...firstView },
      }),
      client.cfpSubmissionView.create({
        data: { eventId: secondEvent.id, userId: firstAdmin.id, ...secondEventView },
      }),
      client.cfpSubmissionView.create({
        data: { eventId: firstEvent.id, userId: secondAdmin.id, ...secondAdminView },
      }),
    ]);

    await client.cfpSubmissionView.update({
      where: { eventId_userId: { eventId: firstEvent.id, userId: firstAdmin.id } },
      data: { filters: { status: "REJECTED" } },
    });

    const [updated, otherEvent, otherAdmin] = await Promise.all([
      client.cfpSubmissionView.findUniqueOrThrow({
        where: { eventId_userId: { eventId: firstEvent.id, userId: firstAdmin.id } },
      }),
      client.cfpSubmissionView.findUniqueOrThrow({
        where: { eventId_userId: { eventId: secondEvent.id, userId: firstAdmin.id } },
      }),
      client.cfpSubmissionView.findUniqueOrThrow({
        where: { eventId_userId: { eventId: firstEvent.id, userId: secondAdmin.id } },
      }),
    ]);

    assert.deepEqual(updated.filters, { status: "REJECTED" });
    assert.deepEqual(otherEvent.filters, secondEventView.filters);
    assert.deepEqual(otherEvent.columns, secondEventView.columns);
    assert.deepEqual(otherAdmin.filters, secondAdminView.filters);
    assert.deepEqual(otherAdmin.columns, secondAdminView.columns);

    // The submissions page and export route both resolve a stored row through
    // parseSubmissionView, so assert the view each admin actually renders.
    assert.deepEqual(parseSubmissionView(updated), {
      columns: firstView.columns,
      filters: { status: "REJECTED" },
      sorting: firstView.sorting,
    });
    assert.deepEqual(parseSubmissionView(otherEvent), secondEventView);
    assert.deepEqual(parseSubmissionView(otherAdmin), secondAdminView);

    await client.cfpSubmissionView.delete({
      where: { eventId_userId: { eventId: firstEvent.id, userId: firstAdmin.id } },
    });

    const afterReset = await client.cfpSubmissionView.findUnique({
      where: { eventId_userId: { eventId: firstEvent.id, userId: firstAdmin.id } },
    });
    assert.equal(afterReset, null);
    assert.equal(await client.cfpSubmissionView.count(), 2);

    // Resetting one admin's view leaves the other event and the other admin untouched.
    assert.deepEqual(
      parseSubmissionView(
        await client.cfpSubmissionView.findUniqueOrThrow({
          where: { eventId_userId: { eventId: secondEvent.id, userId: firstAdmin.id } },
        }),
      ),
      secondEventView,
    );
    assert.deepEqual(
      parseSubmissionView(
        await client.cfpSubmissionView.findUniqueOrThrow({
          where: { eventId_userId: { eventId: firstEvent.id, userId: secondAdmin.id } },
        }),
      ),
      secondAdminView,
    );
  });
});
