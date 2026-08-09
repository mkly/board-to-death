import { PrismaPg } from "@prisma/adapter-pg";
import ExcelJS from "exceljs";

import { EventType, PrismaClient, ProgramSessionKind, ReportBaseType } from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { createReportCsv, createReportXlsx, ReportRepository, reportTemplates, runReport } from "./index.ts";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for report integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const repository = new ReportRepository(client);

async function createEvent(slug: string) {
  return events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
  });
}

async function createSession(eventId: string, title: string, durationMinutes: number) {
  return client.programSession.create({
    data: {
      eventId,
      kind: ProgramSessionKind.MANUAL,
      versions: { create: { versionNumber: 1, title, durationMinutes } },
    },
  });
}

describe("saved reports", () => {
  before(async () => client.$connect());
  beforeEach(async () => client.event.deleteMany());
  after(async () => client.$disconnect());

  test("creates, edits, filters, duplicates, exports, and deletes reports from one shared result set", async () => {
    const event = await createEvent("reports-lifecycle");
    await Promise.all([createSession(event.id, "Opening keynote", 45), createSession(event.id, "Design lab", 90)]);
    const report = await repository.create(event.id, "Long sessions", {
      baseType: ReportBaseType.SESSION,
      columns: ["title", "durationMinutes"],
      filters: [{ column: "durationMinutes", operator: "greaterThan", value: "60" }],
    });

    const result = await runReport(client, event.id, report);
    assert.deepEqual(
      result.rows.map(({ values }) => values.title),
      ["Design lab"],
    );
    const csv = new TextDecoder().decode(createReportCsv(result));
    assert.match(csv, /"Session title","Duration \(minutes\)"/);
    assert.match(csv, /"Design lab","90"/);
    const workbook = new ExcelJS.Workbook();
    const xlsx = Buffer.from(await createReportXlsx(result));
    await workbook.xlsx.load(xlsx as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    assert.equal(workbook.getWorksheet("Report")?.getRow(2).getCell(1).value, "Design lab");

    const updated = await repository.update(event.id, report.id, "Keynotes", {
      baseType: ReportBaseType.SESSION,
      columns: ["title"],
      filters: [{ column: "title", operator: "contains", value: "keynote" }],
    });
    assert.deepEqual(
      (await runReport(client, event.id, updated)).rows.map(({ values }) => values.title),
      ["Opening keynote"],
    );
    const duplicate = await repository.duplicate(event.id, report.id);
    assert.equal(duplicate.name, "Keynotes copy");
    await repository.delete(event.id, duplicate.id);
    assert.deepEqual(
      (await repository.list(event.id)).map(({ name }) => name),
      ["Keynotes"],
    );
  });

  test("creates both prebuilt templates and rejects cross-event reads and mutations", async () => {
    const event = await createEvent("report-event-a");
    const otherEvent = await createEvent("report-event-b");
    for (const template of reportTemplates) await repository.createFromTemplate(event.id, template.id);
    assert.deepEqual(
      (await repository.list(event.id)).map(({ name }) => name).sort(),
      reportTemplates.map(({ name }) => name).sort(),
    );
    const firstReportId = (await repository.list(event.id))[0]?.id ?? "";
    assert.equal(await repository.get(otherEvent.id, firstReportId), null);
    await assert.rejects(
      () => repository.delete(otherEvent.id, firstReportId),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
    assert.deepEqual(await repository.list(otherEvent.id), []);
  });
});
