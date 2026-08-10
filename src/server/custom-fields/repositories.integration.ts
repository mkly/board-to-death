import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CustomFieldEntityType,
  CustomFieldType,
  EventType,
  PrismaClient,
  ProgramSessionKind,
} from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { CustomFieldRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for custom field repository integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const fields = new CustomFieldRepository(client);

async function createEvent(slug: string): Promise<string> {
  return (
    await events.create({
      name: slug,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
    })
  ).id;
}

async function createTargets(eventId: string) {
  const contact = await client.contact.create({
    data: { eventId, email: `${eventId}@example.test`, givenName: "Ada", familyName: "Lovelace" },
  });
  const group = await client.contactGroup.create({
    data: { eventId, kind: "SPONSOR", name: "Gold", slug: "gold" },
  });
  const session = await client.programSession.create({ data: { eventId, kind: ProgramSessionKind.MANUAL } });
  const form = await client.cfpForm.create({ data: { eventId, key: "main" } });
  const formVersion = await client.cfpFormVersion.create({
    data: { formId: form.id, versionNumber: 1, schemaVersion: 1, title: "CFP", customTypes: [] },
  });
  const submission = await client.cfpSubmission.create({
    data: { eventId, formVersionId: formVersion.id, kind: CfpSubmissionKind.ABSTRACT },
  });
  return { contact, group, session, submission };
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

describe("event custom fields", () => {
  before(async () => client.$connect());
  beforeEach(async () => client.event.deleteMany());
  after(async () => client.$disconnect());

  test("creates every supported type and maintains an explicit order", async () => {
    const eventId = await createEvent("all-custom-field-types");
    const types = Object.values(CustomFieldType);
    const created = [];
    for (const [index, type] of types.entries()) {
      created.push(
        await fields.createDefinition(eventId, {
          entityType: CustomFieldEntityType.CONTACT,
          key: `field-${index}`,
          label: `Field ${index}`,
          type,
          options:
            type === CustomFieldType.SINGLE_SELECT || type === CustomFieldType.MULTI_SELECT ? ["One", "Two"] : null,
          characterLimit:
            type === CustomFieldType.SINGLE_LINE_TEXT ||
            type === CustomFieldType.LONG_TEXT ||
            type === CustomFieldType.URL
              ? 200
              : null,
        }),
      );
    }
    assert.deepEqual(
      created.map(({ position }) => position),
      types.map((_, index) => index),
    );
    const reversed = created.map(({ id }) => id).reverse();
    await fields.reorderDefinitions(eventId, CustomFieldEntityType.CONTACT, reversed);
    assert.deepEqual(
      (await fields.listDefinitions(eventId, CustomFieldEntityType.CONTACT)).map(({ id }) => id),
      reversed,
    );
  });

  test("captures values for every supported record target and exposes searchable matches", async () => {
    const eventId = await createEvent("custom-field-values");
    const targets = await createTargets(eventId);
    const contactField = await fields.createDefinition(eventId, {
      entityType: CustomFieldEntityType.CONTACT,
      key: "dietary-notes",
      label: "Dietary notes",
      type: CustomFieldType.SINGLE_LINE_TEXT,
      characterLimit: 40,
    });
    const sessionField = await fields.createDefinition(eventId, {
      entityType: CustomFieldEntityType.PROGRAM_SESSION,
      key: "expected-attendance",
      label: "Expected attendance",
      type: CustomFieldType.NUMBER,
    });
    const groupField = await fields.createDefinition(eventId, {
      entityType: CustomFieldEntityType.CONTACT_GROUP,
      key: "benefits",
      label: "Benefits",
      type: CustomFieldType.MULTI_SELECT,
      options: ["Booth", "Logo"],
    });
    const submissionField = await fields.createDefinition(eventId, {
      entityType: CustomFieldEntityType.CFP_SUBMISSION,
      key: "recording-consent",
      label: "Recording consent",
      type: CustomFieldType.CHECKBOX,
      required: true,
    });
    await fields.setValue(eventId, contactField.id, { entityType: "CONTACT", contactId: targets.contact.id }, "Vegan");
    await fields.setValue(
      eventId,
      sessionField.id,
      { entityType: "PROGRAM_SESSION", sessionId: targets.session.id },
      120,
    );
    await fields.setValue(eventId, groupField.id, { entityType: "CONTACT_GROUP", groupId: targets.group.id }, [
      "Booth",
      "Logo",
    ]);
    await fields.setValue(
      eventId,
      submissionField.id,
      { entityType: "CFP_SUBMISSION", submissionId: targets.submission.id },
      true,
    );
    assert.deepEqual(await fields.matchingTargetIds(eventId, { definitionId: contactField.id, query: "veg" }), [
      targets.contact.id,
    ]);
    assert.equal(await client.customFieldValue.count({ where: { eventId } }), 4);
    await expectRepositoryError(fields.deleteDefinition(eventId, contactField.id), "conflict");
    await expectRepositoryError(
      fields.setValue(
        eventId,
        contactField.id,
        { entityType: "CONTACT", contactId: targets.contact.id },
        "x".repeat(41),
      ),
      "invalid-input",
    );
    await expectRepositoryError(
      fields.setValue(
        eventId,
        submissionField.id,
        { entityType: "CFP_SUBMISSION", submissionId: targets.submission.id },
        false,
      ),
      "invalid-input",
    );
  });

  test("rejects cross-event targets", async () => {
    const firstEventId = await createEvent("first-custom-fields-event");
    const secondEventId = await createEvent("second-custom-fields-event");
    const firstTargets = await createTargets(firstEventId);
    const secondTargets = await createTargets(secondEventId);
    const definition = await fields.createDefinition(firstEventId, {
      entityType: CustomFieldEntityType.CONTACT,
      key: "private-note",
      label: "Private note",
      type: CustomFieldType.LONG_TEXT,
    });
    const secondDefinition = await fields.createDefinition(secondEventId, {
      entityType: CustomFieldEntityType.CONTACT,
      key: "private-note",
      label: "Private note",
      type: CustomFieldType.LONG_TEXT,
    });
    await fields.setValue(
      firstEventId,
      definition.id,
      { entityType: "CONTACT", contactId: firstTargets.contact.id },
      "Shared search phrase",
    );
    await fields.setValue(
      secondEventId,
      secondDefinition.id,
      { entityType: "CONTACT", contactId: secondTargets.contact.id },
      "Shared search phrase",
    );
    assert.deepEqual(
      await fields.matchingTargetIds(firstEventId, { definitionId: definition.id, query: "search phrase" }),
      [firstTargets.contact.id],
    );
    await expectRepositoryError(
      fields.matchingTargetIds(firstEventId, { definitionId: secondDefinition.id, query: "search phrase" }),
      "not-found",
    );
    await expectRepositoryError(
      fields.setValue(
        firstEventId,
        definition.id,
        { entityType: "CONTACT", contactId: secondTargets.contact.id },
        "Must not cross events",
      ),
      "not-found",
    );
  });

  test("validates a submission custom-field batch atomically", async () => {
    const eventId = await createEvent("atomic-submission-custom-fields");
    const { submission } = await createTargets(eventId);
    const notes = await fields.createDefinition(eventId, {
      entityType: CustomFieldEntityType.CFP_SUBMISSION,
      key: "room-notes",
      label: "Room notes",
      type: CustomFieldType.LONG_TEXT,
    });
    const consent = await fields.createDefinition(eventId, {
      entityType: CustomFieldEntityType.CFP_SUBMISSION,
      key: "recording-consent",
      label: "Recording consent",
      type: CustomFieldType.CHECKBOX,
      required: true,
    });

    await expectRepositoryError(
      fields.setValues(eventId, { entityType: "CFP_SUBMISSION", submissionId: submission.id }, [
        { definitionId: notes.id, value: "Persist only if the full batch is valid" },
        { definitionId: consent.id, value: false },
      ]),
      "invalid-input",
    );
    assert.equal(await client.customFieldValue.count({ where: { submissionId: submission.id } }), 0);

    await fields.setValues(eventId, { entityType: "CFP_SUBMISSION", submissionId: submission.id }, [
      { definitionId: notes.id, value: "Eight tables" },
      { definitionId: consent.id, value: true },
    ]);
    assert.deepEqual(
      (await fields.listValues(eventId, { entityType: "CFP_SUBMISSION", submissionId: submission.id })).map(
        ({ definitionId, value }) => ({ definitionId, value }),
      ),
      [
        { definitionId: notes.id, value: "Eight tables" },
        { definitionId: consent.id, value: true },
      ],
    );
  });
});
