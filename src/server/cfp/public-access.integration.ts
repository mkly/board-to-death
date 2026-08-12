import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpAdminRole,
  CfpDraftPolicy,
  CfpPolicyStatus,
  EventType,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../lib/cfp/index.ts";
import { EventRepository } from "../events/repositories.ts";
import { CfpAdministratorRepository, type CfpPolicyDefinition, CfpPolicyRepository } from "./policies.ts";
import { CfpPublicAccessRepository } from "./public-access.ts";
import { CfpFormRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for CFP public access integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const forms = new CfpFormRepository(client);
const administrators = new CfpAdministratorRepository(client);
const policies = new CfpPolicyRepository(client);
const publicAccess = new CfpPublicAccessRepository(client);

const eventInput = {
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  type: EventType.CONFERENCE,
  timezone: "America/Los_Angeles",
  startsAt: new Date("2027-03-13T17:00:00.000Z"),
  endsAt: new Date("2027-03-15T00:00:00.000Z"),
} as const;

function formDefinition(): CfpFormDefinition {
  return {
    version: 1,
    title: "Board Game Design CFP",
    categories: [{ id: "design", label: "Game design" }],
    sections: [
      {
        id: "proposal",
        kind: "questions",
        title: "Proposal",
        questions: [{ id: "abstract", type: "long_text", label: "Abstract", required: true }],
      },
    ],
  };
}

function policyDefinition(
  ownerId: string,
  overrides: { readonly submissionOpensAt?: Date; readonly submissionClosesAt?: Date } = {},
): CfpPolicyDefinition {
  return {
    submissionOpensAt: overrides.submissionOpensAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000),
    submissionClosesAt: overrides.submissionClosesAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    draftPolicy: CfpDraftPolicy.ALLOWED,
    submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 4 },
    messages: { introduction: "Intro", submissionConfirmation: "Confirmed", closed: "Closed" },
    conditionalVisibility: [],
    categoryRouting: [],
    adminAssignments: [
      {
        administratorId: ownerId,
        role: CfpAdminRole.OWNER,
        notifyOnNewSubmission: true,
        notifyOnSubmissionUpdate: true,
      },
    ],
  };
}

async function setup(
  slug: string,
  overrides?: { readonly submissionOpensAt?: Date; readonly submissionClosesAt?: Date },
) {
  const event = await events.create({ ...eventInput, slug, name: slug });
  const form = await forms.create({ eventId: event.id, key: "main-cfp", definition: formDefinition() });
  const owner = await administrators.create({
    eventId: event.id,
    externalId: "owner@example.com",
    displayName: "Owner",
  });
  const created = await policies.create({
    eventId: event.id,
    key: "main-cfp",
    definition: policyDefinition(owner.id, overrides),
  });
  const published = await policies.publishByForm(event.id, form.formId, form.versionNumber, owner.externalId);
  return { event, form, owner, policy: created, published };
}

describe("CFP public access lookup", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("reports a not-yet-open policy as unavailable with its opening instant", async () => {
    const opensAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const closesAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const { published } = await setup("not-yet-open", { submissionOpensAt: opensAt, submissionClosesAt: closesAt });

    const lookup = await publicAccess.findByPublicId(published.publicId);

    assert.equal(lookup.status, "not-yet-open");
    assert.ok(lookup.status === "not-yet-open" && lookup.opensAt.getTime() === opensAt.getTime());
  });

  test("resolves an active published policy by its event slug", async () => {
    const { event, published } = await setup("public-event-slug");

    const lookup = await publicAccess.findByPublicId(event.slug);

    assert.equal(lookup.status, "open");
    assert.ok(lookup.status === "open" && lookup.publicId === published.publicId);
  });

  test("reports closed and archived policies as closed", async () => {
    const { event, published, owner } = await setup("closed-archived");

    assert.equal((await publicAccess.findByPublicId(published.publicId)).status, "open");

    await policies.transition(event.id, published.id, CfpPolicyStatus.CLOSED, owner.id);
    assert.equal((await publicAccess.findByPublicId(published.publicId)).status, "closed");

    await policies.transition(event.id, published.id, CfpPolicyStatus.ARCHIVED, owner.id);
    assert.equal((await publicAccess.findByPublicId(published.publicId)).status, "closed");
  });

  test("reflects each publication status transition on the very next lookup", async () => {
    const { event, published, owner } = await setup("changed-policy");

    assert.equal((await publicAccess.findByPublicId(published.publicId)).status, "open");

    await policies.transition(event.id, published.id, CfpPolicyStatus.CLOSED, owner.id);
    assert.equal((await publicAccess.findByPublicId(published.publicId)).status, "closed");

    await policies.transition(event.id, published.id, CfpPolicyStatus.PUBLISHED, owner.id);
    assert.equal((await publicAccess.findByPublicId(published.publicId)).status, "open");
  });

  test("expires access at the configured close instant regardless of policy status", async () => {
    const closesAt = new Date(Date.now() + 2_000);
    const { published } = await setup("boundary-time", { submissionClosesAt: closesAt });

    assert.equal((await publicAccess.findByPublicId(published.publicId)).status, "open");

    await new Promise((resolve) => setTimeout(resolve, 2_100));

    const lookup = await publicAccess.findByPublicId(published.publicId);
    assert.equal(lookup.status, "expired");
    assert.ok(lookup.status === "expired" && lookup.closedAt.getTime() === closesAt.getTime());
  });
});
