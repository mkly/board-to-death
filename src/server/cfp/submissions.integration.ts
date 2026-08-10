import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpAdminRole,
  CfpDraftPolicy,
  CfpPolicyStatus,
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  CfpSubmissionTransitionActor,
  EventType,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../lib/cfp/index.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { SpeakerRepository } from "../speakers/repositories.ts";
import { CfpAdministratorRepository, type CfpPolicyDefinition, CfpPolicyRepository } from "./policies.ts";
import { CfpFormRepository } from "./repositories.ts";
import { CfpCategoryRepository, type CfpSubmissionParticipantInput, CfpSubmissionRepository } from "./submissions.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for CFP submission integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const forms = new CfpFormRepository(client);
const categories = new CfpCategoryRepository(client);
const administrators = new CfpAdministratorRepository(client);
const policies = new CfpPolicyRepository(client);
const submissions = new CfpSubmissionRepository(client);
const speakers = new SpeakerRepository(client);

const eventInput = {
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  type: EventType.CONFERENCE,
  timezone: "America/Los_Angeles",
  startsAt: new Date("2027-03-13T17:00:00.000Z"),
  endsAt: new Date("2027-03-15T00:00:00.000Z"),
} as const;

function definition(title = "Board Game Design CFP", acceptsSpeakers = false): CfpFormDefinition {
  return {
    version: 1,
    title,
    categories: [
      { id: "design", label: "Game design" },
      { id: "strategy", label: "Strategy" },
    ],
    ...(acceptsSpeakers ? { minimumSpeakerCount: 1, maximumSpeakerCount: 4, requiredSpeakerFields: [] } : {}),
    sections: [
      {
        id: "proposal",
        kind: "questions",
        title: "Proposal",
        questions: [
          { id: "abstract", type: "long_text", label: "Abstract", required: true },
          { id: "duration", type: "number", label: "Duration", required: true },
        ],
      },
    ],
  };
}

async function createEventAndForm(
  slug: string = eventInput.slug,
  acceptsSpeakers = false,
): Promise<{ eventId: string; formId: string; formVersionId: string }> {
  const event = await events.create({ ...eventInput, slug, name: slug });
  const form = await forms.create({
    eventId: event.id,
    key: "main-cfp",
    definition: definition(undefined, acceptsSpeakers),
  });
  const version = await client.cfpFormVersion.findUniqueOrThrow({
    where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
  });
  return { eventId: event.id, formId: form.formId, formVersionId: version.id };
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

function policyDefinition(ownerId: string, maxSubmissionsPerSpeaker: number): CfpPolicyDefinition {
  return {
    submissionOpensAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    submissionClosesAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    draftPolicy: CfpDraftPolicy.ALLOWED,
    submissionLimits: { maxSubmissionsPerSpeaker, maxParticipantsPerSubmission: 4 },
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

describe("CFP submission persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("versions an abstract draft and freezes its definition and ordered answers at finalization", async () => {
    const { eventId, formVersionId } = await createEventAndForm();
    const design = await categories.create({ eventId, key: "design", label: "Game design" });
    const strategy = await categories.create({ eventId, key: "strategy", label: "Strategy" });
    const draft = await submissions.createDraft({
      eventId,
      formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      categoryIds: [design.id],
      answers: [
        { questionId: "abstract", value: "An early abstract" },
        { questionId: "duration", value: 45 },
      ],
    });

    const edited = await submissions.saveDraft(eventId, draft.id, {
      categoryIds: [strategy.id, design.id],
      answers: [
        { questionId: "duration", value: 60 },
        { questionId: "abstract", value: "The final abstract" },
      ],
    });
    await forms.createVersion(
      eventId,
      (await client.cfpFormVersion.findUniqueOrThrow({ where: { id: formVersionId } })).formId,
      definition("A later form definition"),
    );
    const finalized = await submissions.finalize(eventId, draft.id);

    assert.equal(edited.revisions.length, 2);
    assert.deepEqual(finalized.categoryIds, [strategy.id, design.id]);
    assert.equal(finalized.status, CfpSubmissionStatus.SUBMITTED);
    assert.ok(finalized.submittedAt);
    assert.deepEqual(
      finalized.revisions.map(({ versionNumber, kind }) => [versionNumber, kind]),
      [
        [1, CfpSubmissionRevisionKind.DRAFT],
        [2, CfpSubmissionRevisionKind.DRAFT],
        [3, CfpSubmissionRevisionKind.FINAL],
      ],
    );
    const finalRevision = finalized.revisions[2];
    assert.equal(finalRevision?.definition.title, "Board Game Design CFP");
    assert.deepEqual(finalRevision?.answers, [
      { questionId: "duration", value: 60 },
      { questionId: "abstract", value: "The final abstract" },
    ]);
  });

  test("finalizes a guaranteed session exactly once", async () => {
    const { eventId, formVersionId } = await createEventAndForm();
    const guaranteed = await submissions.createDraft({
      eventId,
      formVersionId,
      kind: CfpSubmissionKind.GUARANTEED_SESSION,
      answers: [
        { questionId: "abstract", value: "Invited keynote" },
        { questionId: "duration", value: 60 },
      ],
    });

    const finalized = await submissions.finalize(eventId, guaranteed.id);

    assert.equal(finalized.kind, CfpSubmissionKind.GUARANTEED_SESSION);
    assert.equal(finalized.revisions.filter(({ kind }) => kind === CfpSubmissionRevisionKind.FINAL).length, 1);
    await expectRepositoryError(submissions.finalize(eventId, guaranteed.id), "invalid-input");
    assert.equal(
      await client.cfpSubmissionRevision.count({
        where: { submissionId: guaranteed.id, kind: CfpSubmissionRevisionKind.FINAL },
      }),
      1,
    );
  });

  test("creates one finalized public submission when the same request is retried concurrently", async () => {
    const { eventId, formVersionId } = await createEventAndForm();
    const category = await categories.create({ eventId, key: "design", label: "Game design" });
    const idempotencyKey = randomUUID();
    const input = {
      eventId,
      formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      idempotencyKey,
      categoryIds: [category.id],
      answers: [
        { questionId: "abstract", value: "An idempotent public proposal" },
        { questionId: "duration", value: 45 },
      ],
    } as const;

    const [created, replayed] = await Promise.all([
      submissions.createFinalized(input),
      submissions.createFinalized(input),
    ]);

    assert.equal(created.id, idempotencyKey);
    assert.equal(replayed.id, idempotencyKey);
    assert.equal(created.status, CfpSubmissionStatus.SUBMITTED);
    assert.ok(created.submittedAt);
    assert.deepEqual(created.categoryIds, [category.id]);
    assert.deepEqual(
      created.revisions.map(({ versionNumber, kind }) => [versionNumber, kind]),
      [[1, CfpSubmissionRevisionKind.FINAL]],
    );
    assert.equal(await client.cfpSubmission.count({ where: { eventId } }), 1);
    assert.equal(
      await client.cfpSubmissionRevision.count({
        where: { submissionId: idempotencyKey, kind: CfpSubmissionRevisionKind.FINAL },
      }),
      1,
    );
  });

  test("lets a participant update a submitted proposal while its CFP is open and exposes the latest revision", async () => {
    const { eventId, formId, formVersionId } = await createEventAndForm("applicant-editing", true);
    const owner = await administrators.create({
      eventId,
      externalId: "applicant-editing-owner@example.test",
      displayName: "Applicant Editing Owner",
    });
    await policies.create({
      eventId,
      key: "main-cfp",
      definition: policyDefinition(owner.id, 3),
    });
    const policy = await policies.publishByForm(eventId, formId, 1, owner.externalId);
    const submission = await submissions.createFinalized({
      eventId,
      formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      idempotencyKey: randomUUID(),
      answers: [
        { questionId: "abstract", value: "Original abstract" },
        { questionId: "duration", value: 30 },
      ],
      participants: [{ email: "applicant@example.test", givenName: "Ada", familyName: "Applicant" }],
    });
    const participant = await client.cfpSubmissionParticipant.findFirstOrThrow({
      where: { eventId, submissionId: submission.id },
      select: { speakerId: true },
    });

    const updated = await submissions.updateByApplicant(eventId, submission.id, {
      speakerId: participant.speakerId,
      answers: [
        { questionId: "abstract", value: "Updated abstract" },
        { questionId: "duration", value: 45 },
      ],
    });

    assert.deepEqual(
      updated.revisions.map(({ kind, versionNumber }) => [versionNumber, kind]),
      [
        [1, CfpSubmissionRevisionKind.FINAL],
        [2, CfpSubmissionRevisionKind.FINAL],
      ],
    );
    assert.deepEqual(updated.revisions[1]?.answers, [
      { questionId: "abstract", value: "Updated abstract" },
      { questionId: "duration", value: 45 },
    ]);
    assert.deepEqual((await submissions.getDetailByEventSlug("applicant-editing", submission.id))?.revision?.answers, [
      { questionId: "abstract", value: "Updated abstract" },
      { questionId: "duration", value: 45 },
    ]);

    await policies.transition(eventId, policy.id, CfpPolicyStatus.CLOSED, owner.id);
    await expectRepositoryError(
      submissions.updateByApplicant(eventId, submission.id, {
        speakerId: participant.speakerId,
        answers: [
          { questionId: "abstract", value: "Too late" },
          { questionId: "duration", value: 60 },
        ],
      }),
      "invalid-input",
    );
  });

  test("does not let a different speaker edit an applicant submission", async () => {
    const { eventId, formId, formVersionId } = await createEventAndForm("applicant-editing-ownership", true);
    const owner = await administrators.create({
      eventId,
      externalId: "applicant-editing-ownership-owner@example.test",
      displayName: "Applicant Editing Owner",
    });
    await policies.create({
      eventId,
      key: "main-cfp",
      definition: policyDefinition(owner.id, 3),
    });
    await policies.publishByForm(eventId, formId, 1, owner.externalId);
    const submission = await submissions.createFinalized({
      eventId,
      formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      idempotencyKey: randomUUID(),
      answers: [
        { questionId: "abstract", value: "Private proposal" },
        { questionId: "duration", value: 30 },
      ],
      participants: [{ email: "owner@example.test", givenName: "Proposal", familyName: "Owner" }],
    });

    await expectRepositoryError(
      submissions.updateByApplicant(eventId, submission.id, {
        speakerId: randomUUID(),
        answers: [
          { questionId: "abstract", value: "Unauthorized edit" },
          { questionId: "duration", value: 45 },
        ],
      }),
      "not-found",
    );
  });

  test("enforces the per-speaker submission limit atomically under concurrent finalization", async () => {
    const event = await events.create({ ...eventInput, slug: "concurrent-limit" });
    const form = await forms.create({
      eventId: event.id,
      key: "speaker-cfp",
      definition: { ...definition(), minimumSpeakerCount: 1, maximumSpeakerCount: 1, requiredSpeakerFields: [] },
    });
    const version = await client.cfpFormVersion.findUniqueOrThrow({
      where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
    });
    const owner = await administrators.create({
      eventId: event.id,
      externalId: "owner@example.com",
      displayName: "Owner",
    });
    await policies.create({
      eventId: event.id,
      key: "speaker-cfp",
      definition: policyDefinition(owner.id, 2),
    });
    const participant = { email: "concurrent@example.test", givenName: "Con", familyName: "Current" } as const;
    const buildInput = (label: string) =>
      ({
        eventId: event.id,
        formVersionId: version.id,
        kind: CfpSubmissionKind.ABSTRACT,
        idempotencyKey: randomUUID(),
        answers: [
          { questionId: "abstract", value: label },
          { questionId: "duration", value: 30 },
        ],
        participants: [participant],
      }) as const;

    // Seed the speaker's first submission sequentially so the racing pair both
    // resolve an existing speaker row. Without it the two transactions collide
    // on the speaker's unique event-scoped email and the loser fails with the
    // same "conflict" code the limit check raises, which would let this test
    // pass with the limit enforcement removed entirely.
    await submissions.createFinalized(buildInput("Seed"));

    const results = await Promise.allSettled([
      submissions.createFinalized(buildInput("First")),
      submissions.createFinalized(buildInput("Second")),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const reason: unknown = rejected[0]?.reason;
    assert.ok(reason instanceof RepositoryError);
    assert.equal(reason.code, "conflict");
    assert.match(reason.message, /already reached the limit of 2 submissions/);
    assert.equal(await client.cfpSubmission.count({ where: { eventId: event.id, submittedAt: { not: null } } }), 2);
  });

  test("rolls back public submission participants when finalization rejects a forged answer", async () => {
    const event = await events.create({ ...eventInput, slug: "atomic-public-finalization" });
    const form = await forms.create({
      eventId: event.id,
      key: "speaker-cfp",
      definition: {
        ...definition(),
        minimumSpeakerCount: 1,
        maximumSpeakerCount: 1,
        requiredSpeakerFields: [],
      },
    });
    const version = await client.cfpFormVersion.findUniqueOrThrow({
      where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
    });

    await expectRepositoryError(
      submissions.createFinalized({
        eventId: event.id,
        formVersionId: version.id,
        kind: CfpSubmissionKind.GUARANTEED_SESSION,
        idempotencyKey: randomUUID(),
        answers: [{ questionId: "forged-question", value: "Not in the published definition" }],
        participants: [
          {
            email: "rollback@example.test",
            givenName: "Roll",
            familyName: "Back",
          },
        ],
      }),
      "invalid-input",
    );

    assert.equal(await client.cfpSubmission.count({ where: { eventId: event.id } }), 0);
    assert.equal(await client.speaker.count({ where: { eventId: event.id } }), 0);
  });

  test("creates ordered speaker profiles atomically within the published speaker contract", async () => {
    const event = await events.create({ ...eventInput, slug: "public-speaker-contract" });
    const form = await forms.create({
      eventId: event.id,
      key: "speaker-cfp",
      definition: {
        ...definition(),
        minimumSpeakerCount: 1,
        maximumSpeakerCount: 2,
        requiredSpeakerFields: ["biography", "contact", "consent"],
      },
    });
    const version = await client.cfpFormVersion.findUniqueOrThrow({
      where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
    });
    const participant = {
      email: "alex@example.test",
      givenName: "Alex",
      familyName: "Rivera",
      phone: "+1 555 0100",
      biography: "Designs cooperative games.",
      consent: true,
    } as const;

    const draft = await submissions.createDraft({
      eventId: event.id,
      formVersionId: version.id,
      kind: CfpSubmissionKind.ABSTRACT,
      answers: [],
      participants: [participant, { ...participant, email: "sam@example.test", givenName: "Sam" }],
    });
    const persisted = await speakers.listSubmissionParticipants(event.id, draft.id);

    assert.deepEqual(
      persisted.map(({ sortOrder, speaker }) => [sortOrder, speaker.profile.email, speaker.profile.givenName]),
      [
        [0, "alex@example.test", "Alex"],
        [1, "sam@example.test", "Sam"],
      ],
    );
    assert.equal(persisted[0]?.speaker.profile.biography, "Designs cooperative games.");
    assert.equal(persisted[0]?.speaker.profile.consentToPublishProfile, true);
    assert.ok(persisted[0]?.speaker.profile.consentedAt);

    await expectRepositoryError(
      submissions.createDraft({
        eventId: event.id,
        formVersionId: version.id,
        kind: CfpSubmissionKind.ABSTRACT,
        answers: [],
        participants: [],
      }),
      "invalid-input",
    );
    await expectRepositoryError(
      submissions.createDraft({
        eventId: event.id,
        formVersionId: version.id,
        kind: CfpSubmissionKind.ABSTRACT,
        answers: [],
        participants: [participant, { ...participant, email: " ALEX@EXAMPLE.TEST " }],
      }),
      "invalid-input",
    );
    await expectRepositoryError(
      submissions.createDraft({
        eventId: event.id,
        formVersionId: version.id,
        kind: CfpSubmissionKind.ABSTRACT,
        answers: [],
        participants: [
          { ...participant, websiteUrl: "https://example.test" } as unknown as CfpSubmissionParticipantInput,
        ],
      }),
      "invalid-input",
    );
    assert.equal(await client.cfpSubmission.count({ where: { eventId: event.id } }), 1);
    assert.equal(await client.speaker.count({ where: { eventId: event.id } }), 2);
  });

  test("audits the allowed review outcomes and reserves confirmation for the speaker path", async () => {
    const { eventId, formVersionId } = await createEventAndForm();
    const draft = await submissions.createDraft({
      eventId,
      formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      answers: [{ questionId: "abstract", value: "A cooperative design talk" }],
    });
    await submissions.finalize(eventId, draft.id);

    await expectRepositoryError(
      submissions.transition(eventId, draft.id, CfpSubmissionStatus.ACCEPTED, { actorId: "admin-1" }),
      "invalid-input",
    );
    await submissions.transition(eventId, draft.id, CfpSubmissionStatus.UNDER_REVIEW, { actorId: "admin-1" });
    await submissions.transition(eventId, draft.id, CfpSubmissionStatus.WAITLISTED, { actorId: "admin-2" });
    const accepted = await submissions.transition(eventId, draft.id, CfpSubmissionStatus.ACCEPTED, {
      actorId: "admin-2",
      note: "A slot opened",
    });

    assert.ok(accepted.reviewStartedAt);
    assert.ok(accepted.decidedAt);
    await expectRepositoryError(
      submissions.transition(eventId, draft.id, CfpSubmissionStatus.CONFIRMED, { actorId: "admin-2" }),
      "invalid-input",
    );
    const confirmed = await submissions.confirm(eventId, draft.id, "speaker-1");
    assert.equal(confirmed.status, CfpSubmissionStatus.CONFIRMED);
    assert.ok(confirmed.confirmedAt);
    assert.deepEqual(
      confirmed.transitions.map(({ fromStatus, toStatus, actor }) => [fromStatus, toStatus, actor]),
      [
        [null, CfpSubmissionStatus.DRAFT, CfpSubmissionTransitionActor.SYSTEM],
        [CfpSubmissionStatus.DRAFT, CfpSubmissionStatus.SUBMITTED, CfpSubmissionTransitionActor.SYSTEM],
        [CfpSubmissionStatus.SUBMITTED, CfpSubmissionStatus.UNDER_REVIEW, CfpSubmissionTransitionActor.ADMIN],
        [CfpSubmissionStatus.UNDER_REVIEW, CfpSubmissionStatus.WAITLISTED, CfpSubmissionTransitionActor.ADMIN],
        [CfpSubmissionStatus.WAITLISTED, CfpSubmissionStatus.ACCEPTED, CfpSubmissionTransitionActor.ADMIN],
        [
          CfpSubmissionStatus.ACCEPTED,
          CfpSubmissionStatus.CONFIRMED,
          CfpSubmissionTransitionActor.SPEAKER_CONFIRMATION,
        ],
      ],
    );
  });

  test("rejects cross-event form and category references and scopes reads by event", async () => {
    const first = await createEventAndForm("first-event");
    const second = await createEventAndForm("second-event");
    const secondCategory = await categories.create({ eventId: second.eventId, key: "other", label: "Other" });

    await expectRepositoryError(
      submissions.createDraft({
        eventId: first.eventId,
        formVersionId: second.formVersionId,
        kind: CfpSubmissionKind.ABSTRACT,
        answers: [],
      }),
      "not-found",
    );
    await expectRepositoryError(
      submissions.createDraft({
        eventId: first.eventId,
        formVersionId: first.formVersionId,
        kind: CfpSubmissionKind.ABSTRACT,
        categoryIds: [secondCategory.id],
        answers: [],
      }),
      "not-found",
    );
    const firstSubmission = await submissions.createDraft({
      eventId: first.eventId,
      formVersionId: first.formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      answers: [],
    });
    assert.equal(await submissions.get(second.eventId, firstSubmission.id), null);
  });

  test("loads abstract and guaranteed submission details with event-isolated speakers and answers", async () => {
    const first = await createEventAndForm("detail-event");
    const second = await createEventAndForm("other-detail-event");
    const category = await categories.create({ eventId: first.eventId, key: "design", label: "Game design" });
    const abstract = await submissions.createDraft({
      eventId: first.eventId,
      formVersionId: first.formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      categoryIds: [category.id],
      answers: [
        { questionId: "abstract", value: "How collaborative games create memorable stories." },
        { questionId: "duration", value: 45 },
      ],
    });
    await submissions.finalize(first.eventId, abstract.id);
    const primary = await speakers.create({
      eventId: first.eventId,
      email: "alex@example.test",
      givenName: "Alex",
      familyName: "Rivera",
      preferredName: "Lex",
    });
    const coSpeaker = await speakers.create({
      eventId: first.eventId,
      email: "sam@example.test",
      givenName: "Sam",
      familyName: "Lee",
    });
    await speakers.replaceSubmissionParticipants(first.eventId, abstract.id, [primary.id, coSpeaker.id]);

    const guaranteed = await submissions.createDraft({
      eventId: second.eventId,
      formVersionId: second.formVersionId,
      kind: CfpSubmissionKind.GUARANTEED_SESSION,
      answers: [{ questionId: "abstract", value: "Invited keynote" }],
    });
    await submissions.finalize(second.eventId, guaranteed.id);

    const detail = await submissions.getDetailByEventSlug("detail-event", abstract.id);
    assert.equal(detail?.event.id, first.eventId);
    assert.equal(detail?.kind, CfpSubmissionKind.ABSTRACT);
    assert.deepEqual(
      detail?.categories.map(({ label }) => label),
      ["Game design"],
    );
    assert.deepEqual(
      detail?.participants.map(({ sortOrder, speaker }) => [sortOrder, speaker.email, speaker.preferredName]),
      [
        [0, "alex@example.test", "Lex"],
        [1, "sam@example.test", null],
      ],
    );
    assert.equal(detail?.revision?.kind, CfpSubmissionRevisionKind.FINAL);
    assert.deepEqual(detail?.revision?.answers, [
      { questionId: "abstract", value: "How collaborative games create memorable stories." },
      { questionId: "duration", value: 45 },
    ]);

    const guaranteedDetail = await submissions.getDetailByEventSlug("other-detail-event", guaranteed.id);
    assert.equal(guaranteedDetail?.kind, CfpSubmissionKind.GUARANTEED_SESSION);
    assert.equal(await submissions.getDetailByEventSlug("detail-event", guaranteed.id), null);
    assert.equal(await submissions.getDetailByEventSlug("other-detail-event", abstract.id), null);
    assert.equal(await submissions.getDetailByEventSlug("detail-event", "00000000-0000-0000-0000-000000000000"), null);
  });

  test("composes event-scoped submission filters and paginates deterministic results", async () => {
    const first = await createEventAndForm("submission-list");
    const second = await createEventAndForm("other-submission-list");
    const category = await categories.create({ eventId: first.eventId, key: "strategy", label: "Strategy" });
    const target = await submissions.createDraft({
      eventId: first.eventId,
      formVersionId: first.formVersionId,
      kind: CfpSubmissionKind.ABSTRACT,
      categoryIds: [category.id],
      answers: [{ questionId: "abstract", value: "A searchable proposal" }],
    });
    await submissions.finalize(first.eventId, target.id);
    await submissions.transition(first.eventId, target.id, CfpSubmissionStatus.UNDER_REVIEW);
    const applicant = await speakers.create({
      eventId: first.eventId,
      email: "lex@example.test",
      givenName: "Alex",
      familyName: "Rivera",
      preferredName: "Lex",
    });
    await speakers.replaceSubmissionParticipants(first.eventId, target.id, [applicant.id]);

    const reviewer = await client.evaluationReviewer.create({
      data: {
        eventId: first.eventId,
        identityId: "casey-reviewer",
        email: "casey@example.test",
        displayName: "Casey Reviewer",
      },
    });
    const plan = await client.evaluationPlan.create({
      data: {
        eventId: first.eventId,
        key: "main-plan",
        versions: {
          create: {
            versionNumber: 1,
            title: "Main plan",
            rounds: { create: { key: "screening", title: "Screening", sortOrder: 0 } },
          },
        },
      },
      include: { versions: { include: { rounds: true } } },
    });
    const round = plan.versions[0]?.rounds[0];
    assert.ok(round);
    await client.evaluationAssignment.create({
      data: { roundId: round.id, submissionId: target.id, reviewerId: reviewer.id },
    });

    await client.cfpSubmission.createMany({
      data: Array.from({ length: 21 }, () => ({
        eventId: first.eventId,
        formVersionId: first.formVersionId,
        kind: CfpSubmissionKind.GUARANTEED_SESSION,
      })),
    });
    await client.cfpSubmission.create({
      data: {
        eventId: second.eventId,
        formVersionId: second.formVersionId,
        kind: CfpSubmissionKind.ABSTRACT,
      },
    });

    const combined = await submissions.listForEvent(first.eventId, {
      search: "lex",
      status: CfpSubmissionStatus.UNDER_REVIEW,
      kind: CfpSubmissionKind.ABSTRACT,
      categoryId: category.id,
      assigneeId: reviewer.id,
    });
    assert.equal(combined.total, 1);
    assert.equal(combined.items[0]?.id, target.id);
    assert.equal(combined.items[0]?.applicants[0]?.name, "Lex");
    assert.equal(combined.items[0]?.assignees[0]?.displayName, "Casey Reviewer");
    assert.equal(combined.metrics.UNDER_REVIEW, 1);
    assert.equal(
      Object.values(combined.metrics).reduce((sum, count) => sum + count, 0),
      22,
    );

    const secondPage = await submissions.listForEvent(first.eventId, { page: 2, pageSize: 20 });
    assert.equal(secondPage.total, 22);
    assert.equal(secondPage.page, 2);
    assert.equal(secondPage.pageCount, 2);
    assert.equal(secondPage.items.length, 2);

    const options = await submissions.getFilterOptions(first.eventId);
    assert.deepEqual(options.categories, [{ id: category.id, label: "Strategy" }]);
    assert.deepEqual(options.assignees, [{ id: reviewer.id, displayName: "Casey Reviewer" }]);
  });
});
