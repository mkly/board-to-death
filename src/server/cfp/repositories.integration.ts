import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpAdminRole,
  CfpDraftPolicy,
  CfpPolicyStatus,
  CfpSubmissionKind,
  EventType,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../lib/cfp/index.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { CfpAdministratorRepository, CfpPolicyRepository } from "./policies.ts";
import { CfpFormRepository } from "./repositories.ts";
import { CfpSubmissionRepository } from "./submissions.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for CFP repository integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const forms = new CfpFormRepository(client);
const policies = new CfpPolicyRepository(client);
const administrators = new CfpAdministratorRepository(client);
const submissions = new CfpSubmissionRepository(client);

const eventInput = {
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  type: EventType.CONFERENCE,
  timezone: "America/Los_Angeles",
  startsAt: new Date("2027-03-13T17:00:00.000Z"),
  endsAt: new Date("2027-03-15T00:00:00.000Z"),
} as const;

function definition(title = "Board Game Design CFP"): CfpFormDefinition {
  return {
    version: 1,
    title,
    description: "Share a session about designing memorable tabletop games.",
    submissionKind: "ABSTRACT",
    accessPolicy: "RESTRICTED",
    welcomeTitle: "Propose a board game design session",
    welcomeContent: "Tell the program team how your session will help tabletop creators.",
    instructions: "Include the audience level, format, and practical takeaways in your proposal.",
    termsContent: "I agree that accepted sessions may be recorded and published.",
    consentRequired: true,
    customQuestionTypes: ["game_complexity"],
    categories: [{ id: "design", label: "Game design" }],
    sections: [
      {
        id: "speaker",
        kind: "speaker",
        title: "Speaker",
        questions: [
          {
            id: "speaker-name",
            type: "short_text",
            label: "Full name",
            required: true,
            constraints: { minLength: 2, maxLength: 100 },
          },
        ],
      },
      {
        id: "proposal",
        kind: "questions",
        title: "Proposal",
        questions: [
          {
            id: "format",
            type: "select",
            label: "Format",
            required: true,
            constraints: {
              options: [
                { value: "talk", label: "Talk" },
                { value: "workshop", label: "Workshop" },
              ],
            },
          },
          {
            id: "complexity",
            type: "game_complexity",
            label: "Game complexity",
            required: false,
            visibleWhen: {
              logic: "all",
              conditions: [{ questionId: "format", operator: "equals", value: "workshop" }],
            },
          },
        ],
      },
    ],
    categoryRouting: [
      {
        id: "route-design",
        when: { logic: "all", conditions: [{ questionId: "format", operator: "equals", value: "talk" }] },
        categoryId: "design",
      },
    ],
  };
}

async function expectInvalid(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === "invalid-input");
}

describe("CFP form persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("round-trips ordered built-in and custom questions from a clean database", async () => {
    const event = await events.create(eventInput);
    const expected = definition();

    const created = await forms.create({ eventId: event.id, key: "main-cfp", definition: expected });
    const loaded = await forms.get(event.id, created.formId, 1);

    assert.equal(created.versionNumber, 1);
    assert.deepEqual(loaded?.definition, expected);
    assert.deepEqual(
      loaded?.definition.sections.map((section) => [section.id, section.questions.map((question) => question.id)]),
      [
        ["speaker", ["speaker-name"]],
        ["proposal", ["format", "complexity"]],
      ],
    );
  });

  test("keeps immutable numbered versions and returns the latest by default", async () => {
    const event = await events.create(eventInput);
    const first = await forms.create({ eventId: event.id, key: "main-cfp", definition: definition("First") });
    const second = await forms.createVersion(event.id, first.formId, definition("Second"));

    assert.equal(second.versionNumber, 2);
    assert.equal((await forms.get(event.id, first.formId))?.definition.title, "Second");
    assert.equal((await forms.get(event.id, first.formId, 1))?.definition.title, "First");
  });

  test("lists latest event-scoped form details with policy state, assignments, and responses", async () => {
    const event = await events.create(eventInput);
    const otherEvent = await events.create({ ...eventInput, name: "Other", slug: "other" });
    const administrator = await administrators.create({
      eventId: event.id,
      externalId: "admin-1",
      displayName: "Ada Lovelace",
    });
    const form = await forms.create({ eventId: event.id, key: "main-cfp", definition: definition("First title") });
    const latest = await forms.createVersion(event.id, form.formId, definition("Latest title"));
    await policies.create({
      eventId: event.id,
      key: "main-cfp",
      definition: {
        submissionOpensAt: new Date("2027-01-01T08:00:00.000Z"),
        submissionClosesAt: new Date("2027-02-01T08:00:00.000Z"),
        draftPolicy: CfpDraftPolicy.ALLOWED,
        submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 },
        messages: {
          introduction: "Welcome",
          submissionConfirmation: "Submitted",
          closed: "Closed",
        },
        conditionalVisibility: [],
        categoryRouting: [],
        adminAssignments: [{ administratorId: administrator.id, role: CfpAdminRole.OWNER }],
      },
    });
    await submissions.createDraft({
      eventId: event.id,
      formVersionId: (
        await client.cfpFormVersion.findFirstOrThrow({
          where: { formId: latest.formId, versionNumber: latest.versionNumber },
          select: { id: true },
        })
      ).id,
      kind: CfpSubmissionKind.ABSTRACT,
      answers: [],
    });

    assert.deepEqual(await forms.list(otherEvent.id), []);
    assert.deepEqual(await forms.list(event.id), [
      {
        id: form.formId,
        eventId: event.id,
        key: "main-cfp",
        title: "Latest title",
        versionNumber: 2,
        status: CfpPolicyStatus.DRAFT,
        submissionClosesAt: new Date("2027-02-01T08:00:00.000Z"),
        responseCount: 1,
        assignedAdministrators: ["Ada Lovelace"],
      },
    ]);
  });

  test("rejects malformed type-specific constraints before writing", async () => {
    const event = await events.create(eventInput);
    const invalidOptions = definition();
    invalidOptions.sections[1].questions[0].constraints = {
      options: [
        { value: "talk", label: "Talk" },
        { value: "talk", label: "Duplicate talk" },
      ],
    };
    const invalidNumber = definition();
    invalidNumber.sections[1].questions[0] = {
      id: "duration",
      type: "number",
      label: "Duration",
      required: true,
      constraints: { minLength: 2 },
    };

    await expectInvalid(forms.create({ eventId: event.id, key: "duplicate-options", definition: invalidOptions }));
    await expectInvalid(forms.create({ eventId: event.id, key: "invalid-number", definition: invalidNumber }));
    assert.equal(await client.cfpForm.count(), 0);
  });

  test("isolates forms by event and cascades their complete revision trees", async () => {
    const firstEvent = await events.create(eventInput);
    const secondEvent = await events.create({ ...eventInput, name: "Other", slug: "other" });
    const created = await forms.create({ eventId: firstEvent.id, key: "main-cfp", definition: definition() });

    assert.equal(await forms.get(secondEvent.id, created.formId), null);
    await assert.rejects(
      forms.createVersion(secondEvent.id, created.formId, definition("Stolen")),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );

    await events.delete(firstEvent.id);
    assert.equal(await client.cfpForm.count({ where: { id: created.formId } }), 0);
    assert.equal(await client.cfpFormVersion.count({ where: { formId: created.formId } }), 0);
  });
});
