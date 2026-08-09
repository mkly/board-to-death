import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpAdminRole,
  CfpDraftPolicy,
  CfpPolicyStatus,
  EventType,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { CfpAdministratorRepository, type CfpPolicyDefinition, CfpPolicyRepository } from "./policies.ts";
import { CfpCategoryRepository } from "./submissions.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for CFP policy integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const categories = new CfpCategoryRepository(client);
const administrators = new CfpAdministratorRepository(client);
const policies = new CfpPolicyRepository(client);

const eventInput = {
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  type: EventType.CONFERENCE,
  timezone: "America/Los_Angeles",
  startsAt: new Date("2027-03-13T17:00:00.000Z"),
  endsAt: new Date("2027-03-15T00:00:00.000Z"),
} as const;

function definition(categoryId: string, ownerId: string, editorId: string): CfpPolicyDefinition {
  return {
    submissionOpensAt: new Date("2026-09-01T16:00:00.000Z"),
    submissionClosesAt: new Date("2026-11-01T07:00:00.000Z"),
    confirmationClosesAt: new Date("2027-01-15T08:00:00.000Z"),
    draftPolicy: CfpDraftPolicy.ALLOWED,
    submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 },
    messages: {
      introduction: "Bring us your most memorable tabletop design lessons.",
      submissionConfirmation: "Your proposal is safely on the table.",
      closed: "The call for proposals is closed.",
      thankYou: "Thank you for sharing your proposal.",
      reminder: { enabled: true, daysBeforeClose: 3, sendAtMinute: 570 },
    },
    conditionalVisibility: [
      {
        target: "questions.prototype-link",
        condition: { questionId: "has-prototype", operator: "equals", value: true },
      },
    ],
    categoryRouting: [
      {
        categoryId,
        condition: { questionId: "topic", operator: "includes", value: "game-design" },
      },
    ],
    adminAssignments: [
      {
        administratorId: ownerId,
        role: CfpAdminRole.OWNER,
        notifyOnNewSubmission: true,
        notifyOnSubmissionUpdate: false,
      },
      {
        administratorId: editorId,
        role: CfpAdminRole.EDITOR,
        notifyOnNewSubmission: false,
        notifyOnSubmissionUpdate: true,
      },
    ],
  };
}

async function expectInvalid(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === "invalid-input");
}

async function fixtures() {
  const event = await events.create(eventInput);
  const category = await categories.create({ eventId: event.id, key: "game-design", label: "Game design" });
  const owner = await administrators.create({
    eventId: event.id,
    externalId: "owner@example.com",
    displayName: "Owner",
  });
  const editor = await administrators.create({
    eventId: event.id,
    externalId: "editor@example.com",
    displayName: "Editor",
  });
  return { event, category, owner, editor };
}

describe("CFP policy persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("preserves versioned visibility, routing, deadlines, draft policy, limits, messages, and assignments", async () => {
    const { event, category, owner, editor } = await fixtures();
    const firstDefinition = definition(category.id, owner.id, editor.id);
    const created = await policies.create({ eventId: event.id, key: "main-cfp", definition: firstDefinition });
    const secondDefinition = {
      ...firstDefinition,
      submissionLimits: { ...firstDefinition.submissionLimits, maxSubmissionsPerSpeaker: 5 },
      messages: { ...firstDefinition.messages, introduction: "Updated introduction." },
    };
    const second = await policies.createVersion(event.id, created.id, secondDefinition);

    assert.equal(created.versionNumber, 1);
    assert.equal(second.versionNumber, 2);
    assert.match(created.publicId, /^[0-9a-f-]{36}$/);
    assert.deepEqual((await policies.get(event.id, created.id, 1))?.definition, firstDefinition);
    assert.deepEqual((await policies.get(event.id, created.id))?.definition, secondDefinition);
    assert.deepEqual((await policies.getByKey(event.id, "main-cfp"))?.definition, secondDefinition);
  });

  test("reuses an event administrator identity while refreshing its display name", async () => {
    const event = await events.create(eventInput);
    const first = await administrators.ensure({
      eventId: event.id,
      externalId: "OWNER@EXAMPLE.COM",
      displayName: "Original owner",
    });
    const second = await administrators.ensure({
      eventId: event.id,
      externalId: "owner@example.com",
      displayName: "Current owner",
    });

    assert.equal(second.id, first.id);
    assert.equal(second.externalId, "owner@example.com");
    assert.equal(second.displayName, "Current owner");
  });

  test("allows close, reopen, and archive only through the explicit publication lifecycle", async () => {
    const { event, category, owner, editor } = await fixtures();
    const created = await policies.create({
      eventId: event.id,
      key: "main-cfp",
      definition: definition(category.id, owner.id, editor.id),
    });

    await expectInvalid(policies.transition(event.id, created.id, CfpPolicyStatus.CLOSED, owner.id));
    assert.equal(
      (await policies.transition(event.id, created.id, CfpPolicyStatus.PUBLISHED, owner.id)).status,
      "PUBLISHED",
    );
    await expectInvalid(policies.createVersion(event.id, created.id, definition(category.id, owner.id, editor.id)));
    await expectInvalid(policies.transition(event.id, created.id, CfpPolicyStatus.ARCHIVED, owner.id));
    assert.equal((await policies.transition(event.id, created.id, CfpPolicyStatus.CLOSED, editor.id)).status, "CLOSED");
    assert.equal(
      (await policies.transition(event.id, created.id, CfpPolicyStatus.PUBLISHED, owner.id)).status,
      "PUBLISHED",
    );
    assert.equal((await policies.transition(event.id, created.id, CfpPolicyStatus.CLOSED, editor.id)).status, "CLOSED");
    assert.equal(
      (await policies.transition(event.id, created.id, CfpPolicyStatus.ARCHIVED, owner.id)).status,
      "ARCHIVED",
    );

    const transitions = await client.cfpPolicyTransition.findMany({
      where: { policyId: created.id },
      orderBy: { occurredAt: "asc" },
    });
    assert.deepEqual(
      transitions.map(({ fromStatus, toStatus }) => [fromStatus, toStatus]),
      [
        [null, "DRAFT"],
        ["DRAFT", "PUBLISHED"],
        ["PUBLISHED", "CLOSED"],
        ["CLOSED", "PUBLISHED"],
        ["PUBLISHED", "CLOSED"],
        ["CLOSED", "ARCHIVED"],
      ],
    );
    await assert.rejects(
      client.cfpPolicy.update({ where: { id: created.id }, data: { publicId: crypto.randomUUID() } }),
    );
    assert.equal((await client.cfpPolicy.findUniqueOrThrow({ where: { id: created.id } })).publicId, created.publicId);
  });

  test("rejects category and administrator references owned by another event", async () => {
    const { event, category, owner, editor } = await fixtures();
    const otherEvent = await events.create({ ...eventInput, name: "Other event", slug: "other-event" });
    const otherCategory = await categories.create({
      eventId: otherEvent.id,
      key: "other-category",
      label: "Other category",
    });
    const otherAdmin = await administrators.create({
      eventId: otherEvent.id,
      externalId: "other@example.com",
      displayName: "Other admin",
    });

    await expectInvalid(
      policies.create({
        eventId: event.id,
        key: "foreign-category",
        definition: definition(otherCategory.id, owner.id, editor.id),
      }),
    );
    await expectInvalid(
      policies.create({
        eventId: event.id,
        key: "foreign-admin",
        definition: definition(category.id, owner.id, otherAdmin.id),
      }),
    );
    assert.equal(await client.cfpPolicy.count(), 0);
  });

  test("restricts administrator changes to owners and preserves alert preferences", async () => {
    const { event, category, owner, editor } = await fixtures();
    const policy = await policies.create({
      eventId: event.id,
      key: "main-cfp",
      definition: definition(category.id, owner.id, editor.id),
    });

    await assert.rejects(
      policies.updateAdministratorAssignments(
        event.id,
        policy.id,
        editor.externalId,
        policy.definition.adminAssignments,
      ),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
    await expectInvalid(policies.updateAdministratorAssignments(event.id, policy.id, owner.externalId, []));
    await expectInvalid(
      policies.updateAdministratorAssignments(event.id, policy.id, owner.externalId, [
        {
          administratorId: editor.id,
          role: CfpAdminRole.EDITOR,
          notifyOnNewSubmission: true,
          notifyOnSubmissionUpdate: false,
        },
      ]),
    );

    const updated = await policies.updateAdministratorAssignments(event.id, policy.id, owner.externalId.toUpperCase(), [
      {
        administratorId: owner.id,
        role: CfpAdminRole.OWNER,
        notifyOnNewSubmission: false,
        notifyOnSubmissionUpdate: true,
      },
    ]);
    assert.equal(updated.versionNumber, 2);
    assert.deepEqual(updated.definition.adminAssignments, [
      {
        administratorId: owner.id,
        role: CfpAdminRole.OWNER,
        notifyOnNewSubmission: false,
        notifyOnSubmissionUpdate: true,
      },
    ]);
    assert.equal(updated.definition.messages.submissionConfirmation, "Your proposal is safely on the table.");
  });
});
