import { PrismaPg } from "@prisma/adapter-pg";
import ExcelJS from "exceljs";

import {
  CustomFieldEntityType,
  CustomFieldType,
  EventType,
  PrismaClient,
  SpreadsheetImportEntityType,
} from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { commitSpreadsheetImport, parseSpreadsheet, previewSpreadsheetImport } from "./spreadsheets.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for spreadsheet import integration tests.");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const eventSlugs = ["contact-import", "other-contact-import", "session-import"];

async function createEvent(slug: string): Promise<string> {
  return (
    await events.create({
      name: slug,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-04-02T16:00:00.000Z"),
      endsAt: new Date("2027-04-04T01:00:00.000Z"),
    })
  ).id;
}

function csv(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("spreadsheet imports", () => {
  before(async () => client.$connect());
  beforeEach(async () => client.event.deleteMany({ where: { slug: { in: eventSlugs } } }));
  after(async () => client.$disconnect());

  test("maps contact columns and custom fields while updating only the selected event", async () => {
    const eventId = await createEvent("contact-import");
    const otherEventId = await createEvent("other-contact-import");
    const existing = await client.contact.create({
      data: { eventId, email: "ada@example.test", givenName: "Ada", familyName: "Lovelace" },
    });
    await client.contact.create({
      data: { eventId: otherEventId, email: "ada@example.test", givenName: "Other", familyName: "Person" },
    });
    const field = await client.customFieldDefinition.create({
      data: {
        eventId,
        entityType: CustomFieldEntityType.CONTACT,
        key: "meal",
        label: "Meal",
        type: CustomFieldType.SINGLE_SELECT,
        options: ["Vegan", "Standard"],
        position: 0,
      },
    });
    const spreadsheet = await parseSpreadsheet(
      "contacts.csv",
      csv("Email,First,Last,Meal\r\nada@example.test,Ada,Byron,Vegan\r\ngrace@example.test,Grace,Hopper,Standard\r\n"),
    );
    const mapping = {
      Email: "email",
      First: "givenName",
      Last: "familyName",
      Meal: `custom:${field.id}`,
    };
    const preview = await previewSpreadsheetImport(
      client,
      eventId,
      SpreadsheetImportEntityType.CONTACT,
      mapping,
      spreadsheet,
    );
    assert.deepEqual(
      { created: preview.created, updated: preview.updated, rejected: preview.rejected },
      { created: 1, updated: 1, rejected: 0 },
    );

    const committed = await commitSpreadsheetImport(client, {
      eventId,
      actorId: "admin@example.test",
      entityType: SpreadsheetImportEntityType.CONTACT,
      fileName: "contacts.csv",
      mapping,
      spreadsheet,
    });
    assert.equal((await client.contact.findUniqueOrThrow({ where: { id: existing.id } })).familyName, "Byron");
    assert.equal(await client.contact.count({ where: { eventId } }), 2);
    assert.equal(
      (await client.contact.findFirstOrThrow({ where: { eventId: otherEventId, email: "ada@example.test" } }))
        .givenName,
      "Other",
    );
    assert.equal(await client.customFieldValue.count({ where: { eventId, definitionId: field.id } }), 2);
    assert.equal(await client.spreadsheetImportChange.count({ where: { importId: committed.importId } }), 2);
  });

  test("reads XLSX sessions and leaves no partial writes when any row is invalid or duplicated", async () => {
    const eventId = await createEvent("session-import");
    const track = await client.track.create({ data: { eventId, name: "Main stage", color: "blue", sortOrder: 0 } });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sessions");
    sheet.addRows([
      ["Title", "Minutes", "Track"],
      ["Opening keynote", 30, track.name],
      ["Opening keynote", "not-a-number", track.name],
    ]);
    const bytes = await workbook.xlsx.writeBuffer();
    const spreadsheet = await parseSpreadsheet("sessions.xlsx", new Uint8Array(bytes));
    const mapping = { Title: "title", Minutes: "durationMinutes", Track: "track" };
    const preview = await previewSpreadsheetImport(
      client,
      eventId,
      SpreadsheetImportEntityType.PROGRAM_SESSION,
      mapping,
      spreadsheet,
    );
    assert.equal(preview.rejected, 1);
    await assert.rejects(
      commitSpreadsheetImport(client, {
        eventId,
        actorId: "admin@example.test",
        entityType: SpreadsheetImportEntityType.PROGRAM_SESSION,
        fileName: "sessions.xlsx",
        mapping,
        spreadsheet,
      }),
      (error: unknown) => error instanceof RepositoryError && error.code === "invalid-input",
    );
    assert.equal(await client.programSession.count({ where: { eventId } }), 0);
    assert.equal(await client.spreadsheetImport.count({ where: { eventId } }), 0);
  });
});
