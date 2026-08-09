import { PrismaPg } from "@prisma/adapter-pg";

import { CfpDraftPolicy, EventType, PrismaClient } from "../../generated/prisma/client.ts";
import type { CfpFormDefinition } from "../../lib/cfp/index.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { DeterministicClock, DeterministicTokenGenerator } from "../infrastructure/fakes.ts";
import { CfpDraftRepository } from "./drafts.ts";
import { CfpFormRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for CFP draft integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const forms = new CfpFormRepository(client);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

interface DraftScope {
  readonly eventId: string;
  readonly policyId: string;
  readonly formId: string;
  readonly formVersionId: string;
}

async function createScope(slug: string): Promise<DraftScope> {
  const event = await events.create({ ...eventInput, slug, name: slug });
  const form = await forms.create({ eventId: event.id, key: "main-cfp", definition: definition() });
  const version = await client.cfpFormVersion.findUniqueOrThrow({
    where: { formId_versionNumber: { formId: form.formId, versionNumber: form.versionNumber } },
  });
  const policy = await client.cfpPolicy.create({ data: { eventId: event.id, key: "main-cfp" } });
  return { eventId: event.id, policyId: policy.id, formId: form.formId, formVersionId: version.id };
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

let repo: CfpDraftRepository;
let clock: DeterministicClock;

describe("CFP submission draft persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    clock = new DeterministicClock("2027-01-01T12:00:00.000Z");
    repo = new CfpDraftRepository({
      database: client,
      clock,
      tokenGenerator: new DeterministicTokenGenerator("cfp-drafts"),
    });
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("rejects saving and resuming when drafts are disabled for the policy", async () => {
    const scope = await createScope("disabled-drafts");
    await expectRepositoryError(
      repo.save({
        eventId: scope.eventId,
        policyId: scope.policyId,
        draftPolicy: CfpDraftPolicy.DISABLED,
        formVersionId: scope.formVersionId,
        answers: { abstract: "hello" },
        participants: [],
        categoryKeys: [],
      }),
      "invalid-input",
    );
    await expectRepositoryError(
      repo.resume({
        eventId: scope.eventId,
        policyId: scope.policyId,
        draftPolicy: CfpDraftPolicy.DISABLED,
        token: "any-token",
        currentFormVersionId: scope.formVersionId,
      }),
      "invalid-input",
    );
  });

  test("saves a draft, persists only a token hash, and resumes it with the original content", async () => {
    const scope = await createScope("save-and-resume");
    const answers = { abstract: "A board game about resource management." };
    const participants = [{ email: "designer@example.test", givenName: "Ada" }];
    const categoryKeys = ["design"];

    const saved = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers,
      participants,
      categoryKeys,
    });
    assert.equal(saved.expiresAt.getTime(), clock.now().getTime() + THIRTY_DAYS_MS);

    const stored = await client.cfpSubmissionDraft.findFirstOrThrow({
      where: { eventId: scope.eventId, policyId: scope.policyId },
    });
    assert.notEqual(stored.tokenHash, saved.token);
    assert.equal(JSON.stringify(stored).includes(saved.token), false);

    const resumed = await repo.resume({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      token: saved.token,
      currentFormVersionId: scope.formVersionId,
    });
    assert.deepEqual(resumed.answers, answers);
    assert.deepEqual(resumed.participants, participants);
    assert.deepEqual(resumed.categoryKeys, categoryKeys);
    assert.equal(resumed.formVersionChanged, false);
    assert.equal(resumed.formVersionId, scope.formVersionId);
  });

  test("resuming a draft never rotates its token, so the same link stays valid across repeated opens", async () => {
    const scope = await createScope("bearer-semantics");
    const saved = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers: { abstract: "first" },
      participants: [],
      categoryKeys: [],
    });

    const resumeInput = {
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      token: saved.token,
      currentFormVersionId: scope.formVersionId,
    };
    await repo.resume(resumeInput);
    const second = await repo.resume(resumeInput);
    assert.deepEqual(second.answers, { abstract: "first" });
  });

  test("updates an existing draft in place when saving with its token, sliding the expiry forward", async () => {
    const scope = await createScope("update-in-place");
    const saved = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers: { abstract: "first draft" },
      participants: [],
      categoryKeys: [],
    });

    clock.advanceBy(60 * 60 * 1000);
    const updated = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers: { abstract: "revised draft" },
      participants: [],
      categoryKeys: [],
      token: saved.token,
    });
    assert.equal(updated.token, saved.token);
    assert.equal(updated.expiresAt.getTime(), clock.now().getTime() + THIRTY_DAYS_MS);
    assert.equal(
      await client.cfpSubmissionDraft.count({ where: { eventId: scope.eventId, policyId: scope.policyId } }),
      1,
    );

    const resumed = await repo.resume({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      token: saved.token,
      currentFormVersionId: scope.formVersionId,
    });
    assert.deepEqual(resumed.answers, { abstract: "revised draft" });
  });

  test("rejects saving with a token that does not match an existing draft", async () => {
    const scope = await createScope("save-nonexistent-token");
    await expectRepositoryError(
      repo.save({
        eventId: scope.eventId,
        policyId: scope.policyId,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        formVersionId: scope.formVersionId,
        answers: {},
        participants: [],
        categoryKeys: [],
        token: "fake-cfp-drafts-local-9999",
      }),
      "not-found",
    );
  });

  test("rejects resuming an expired draft", async () => {
    const scope = await createScope("expiry");
    const saved = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers: { abstract: "expiring" },
      participants: [],
      categoryKeys: [],
    });

    clock.advanceBy(THIRTY_DAYS_MS + 1);
    await expectRepositoryError(
      repo.resume({
        eventId: scope.eventId,
        policyId: scope.policyId,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        token: saved.token,
        currentFormVersionId: scope.formVersionId,
      }),
      "not-found",
    );
  });

  test("rejects saving with an expired token, so an expired draft cannot be revived", async () => {
    const scope = await createScope("expired-save");
    const saved = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers: { abstract: "expiring" },
      participants: [],
      categoryKeys: [],
    });

    clock.advanceBy(THIRTY_DAYS_MS + 1);
    await expectRepositoryError(
      repo.save({
        eventId: scope.eventId,
        policyId: scope.policyId,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        formVersionId: scope.formVersionId,
        answers: { abstract: "revived" },
        participants: [],
        categoryKeys: [],
        token: saved.token,
      }),
      "not-found",
    );
    await expectRepositoryError(
      repo.resume({
        eventId: scope.eventId,
        policyId: scope.policyId,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        token: saved.token,
        currentFormVersionId: scope.formVersionId,
      }),
      "not-found",
    );
  });

  test("rejects a tampered token", async () => {
    const scope = await createScope("tampering");
    const saved = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers: { abstract: "tamper me" },
      participants: [],
      categoryKeys: [],
    });

    await expectRepositoryError(
      repo.resume({
        eventId: scope.eventId,
        policyId: scope.policyId,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        token: `${saved.token}-tampered`,
        currentFormVersionId: scope.formVersionId,
      }),
      "not-found",
    );
  });

  test("isolates draft access to its own event and policy scope", async () => {
    const owner = await createScope("cross-access-owner");
    const other = await createScope("cross-access-other");
    const saved = await repo.save({
      eventId: owner.eventId,
      policyId: owner.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: owner.formVersionId,
      answers: { abstract: "owner only" },
      participants: [],
      categoryKeys: [],
    });

    await expectRepositoryError(
      repo.resume({
        eventId: other.eventId,
        policyId: other.policyId,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        token: saved.token,
        currentFormVersionId: other.formVersionId,
      }),
      "not-found",
    );
    await expectRepositoryError(
      repo.resume({
        eventId: owner.eventId,
        policyId: other.policyId,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        token: saved.token,
        currentFormVersionId: owner.formVersionId,
      }),
      "not-found",
    );

    await repo.discard({ eventId: other.eventId, policyId: other.policyId, token: saved.token });
    const stillResumable = await repo.resume({
      eventId: owner.eventId,
      policyId: owner.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      token: saved.token,
      currentFormVersionId: owner.formVersionId,
    });
    assert.deepEqual(stillResumable.answers, { abstract: "owner only" });
  });

  test("discards a draft so it can no longer be resumed", async () => {
    const scope = await createScope("discard");
    const saved = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers: { abstract: "discard me" },
      participants: [],
      categoryKeys: [],
    });

    await repo.discard({ eventId: scope.eventId, policyId: scope.policyId, token: saved.token });
    await expectRepositoryError(
      repo.resume({
        eventId: scope.eventId,
        policyId: scope.policyId,
        draftPolicy: CfpDraftPolicy.ALLOWED,
        token: saved.token,
        currentFormVersionId: scope.formVersionId,
      }),
      "not-found",
    );
  });

  test("reports a changed form definition while still returning the saved content", async () => {
    const scope = await createScope("form-version-changed");
    const saved = await repo.save({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      formVersionId: scope.formVersionId,
      answers: { abstract: "written against v1" },
      participants: [],
      categoryKeys: [],
    });

    const nextVersion = await forms.createVersion(scope.eventId, scope.formId, definition("Board Game Design CFP v2"));
    const republished = await client.cfpFormVersion.findUniqueOrThrow({
      where: { formId_versionNumber: { formId: scope.formId, versionNumber: nextVersion.versionNumber } },
    });

    const resumed = await repo.resume({
      eventId: scope.eventId,
      policyId: scope.policyId,
      draftPolicy: CfpDraftPolicy.ALLOWED,
      token: saved.token,
      currentFormVersionId: republished.id,
    });
    assert.equal(resumed.formVersionChanged, true);
    assert.equal(resumed.formVersionId, scope.formVersionId);
    assert.deepEqual(resumed.answers, { abstract: "written against v1" });
  });
});
