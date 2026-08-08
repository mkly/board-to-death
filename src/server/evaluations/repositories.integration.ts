import { PrismaPg } from "@prisma/adapter-pg";

import { EvaluationRoundStatus, PrismaClient, ReviewerVisibility } from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { EvaluationPlanRepository } from "./repositories.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for evaluation repository integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const evaluations = new EvaluationPlanRepository(client);

const baseEvent = {
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  timezone: "America/Los_Angeles",
  startsAt: new Date("2027-03-13T17:00:00.000Z"),
  endsAt: new Date("2027-03-15T00:00:00.000Z"),
} as const;

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

describe("evaluation plan lifecycle persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("creates, edits, and reorders event-scoped planned rounds on the main evaluation schema", async () => {
    const event = await events.create(baseEvent);
    const plan = await evaluations.create(event.id, {
      key: "main-review",
      title: "CFP review",
      description: "Primary review lifecycle",
    });
    const version = plan.versions[0];
    assert.ok(version);
    const screening = await evaluations.createRound({
      eventId: event.id,
      planVersionId: version.id,
      key: "screening",
      title: "Screening",
      reviewerVisibility: ReviewerVisibility.BLIND,
    });
    const committee = await evaluations.createRound({
      eventId: event.id,
      planVersionId: version.id,
      key: "committee",
      title: "Committee review",
      reviewerVisibility: ReviewerVisibility.IDENTIFIED,
    });

    const updated = await evaluations.updateRound(event.id, screening.id, {
      key: "eligibility-screening",
      title: "Eligibility screening",
      description: "Checks submission eligibility",
      reviewerVisibility: ReviewerVisibility.ANONYMIZED,
    });
    assert.equal(updated.title, "Eligibility screening");

    await evaluations.reorder(event.id, version.id, [committee.id, screening.id]);
    const persisted = await evaluations.list(event.id);
    assert.deepEqual(
      persisted[0]?.versions[0]?.rounds.map(({ id, sortOrder }) => [id, sortOrder]),
      [
        [committee.id, 0],
        [screening.id, 1],
      ],
    );
  });

  test("snapshots visibility, audits every transition, and retires fully archived history", async () => {
    const event = await events.create(baseEvent);
    const plan = await evaluations.create(event.id, { key: "editorial-review", title: "Editorial review" });
    const version = plan.versions[0];
    assert.ok(version);
    const first = await evaluations.createRound({
      eventId: event.id,
      planVersionId: version.id,
      key: "blind-review",
      title: "Blind review",
      reviewerVisibility: ReviewerVisibility.BLIND,
    });
    const final = await evaluations.createRound({
      eventId: event.id,
      planVersionId: version.id,
      key: "final-committee",
      title: "Final committee",
      reviewerVisibility: ReviewerVisibility.IDENTIFIED,
    });
    await client.evaluationCriterion.createMany({
      data: [
        { roundId: first.id, key: "fit", label: "Fit", sortOrder: 0, minimum: 1, maximum: 5 },
        { roundId: final.id, key: "impact", label: "Impact", sortOrder: 0, minimum: 1, maximum: 5 },
      ],
    });

    const opened = await evaluations.transition(event.id, first.id, EvaluationRoundStatus.OPEN);
    assert.equal(opened.visibilitySnapshot, ReviewerVisibility.BLIND);
    await expectRepositoryError(
      evaluations.updateRound(event.id, first.id, {
        key: first.key,
        title: "Rewritten history",
        reviewerVisibility: ReviewerVisibility.IDENTIFIED,
      }),
      "invalid-input",
    );
    await expectRepositoryError(
      evaluations.transition(event.id, final.id, EvaluationRoundStatus.OPEN),
      "invalid-input",
    );

    await evaluations.transition(event.id, first.id, EvaluationRoundStatus.CLOSED);
    await evaluations.transition(event.id, first.id, EvaluationRoundStatus.ARCHIVED);
    await evaluations.transition(event.id, final.id, EvaluationRoundStatus.OPEN);
    await evaluations.transition(event.id, final.id, EvaluationRoundStatus.CLOSED);
    await evaluations.transition(event.id, final.id, EvaluationRoundStatus.ARCHIVED);

    const persisted = (await evaluations.list(event.id))[0];
    assert.equal(persisted?.versions[0]?.status, "RETIRED");
    assert.deepEqual(
      persisted?.versions[0]?.rounds[0]?.transitions.map(({ fromStatus, toStatus }) => [fromStatus, toStatus]),
      [
        [null, EvaluationRoundStatus.PLANNED],
        [EvaluationRoundStatus.PLANNED, EvaluationRoundStatus.OPEN],
        [EvaluationRoundStatus.OPEN, EvaluationRoundStatus.CLOSED],
        [EvaluationRoundStatus.CLOSED, EvaluationRoundStatus.ARCHIVED],
      ],
    );
  });

  test("rejects cross-event identifiers", async () => {
    const firstEvent = await events.create(baseEvent);
    const secondEvent = await events.create({ ...baseEvent, name: "Other event", slug: "other-event" });
    const plan = await evaluations.create(firstEvent.id, { key: "review", title: "Review" });
    const version = plan.versions[0];
    assert.ok(version);
    const round = await evaluations.createRound({
      eventId: firstEvent.id,
      planVersionId: version.id,
      key: "round-one",
      title: "Round one",
      reviewerVisibility: ReviewerVisibility.BLIND,
    });

    assert.deepEqual(await evaluations.list(secondEvent.id), []);
    await expectRepositoryError(
      evaluations.updateRound(secondEvent.id, round.id, {
        key: round.key,
        title: "Cross-event edit",
        reviewerVisibility: ReviewerVisibility.IDENTIFIED,
      }),
      "not-found",
    );
  });
});
