import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { EvaluationRoundStatus, PrismaClient, ReviewerVisibility } from "../../generated/prisma/client.ts";
import { EventRepository } from "../events/repositories.ts";
import { EvaluationPlanRepository, EvaluationRepositoryError } from "./repositories.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for evaluation repository integration tests.");
}

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

async function expectRepositoryError(
  promise: Promise<unknown>,
  code: EvaluationRepositoryError["code"],
): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof EvaluationRepositoryError && error.code === code,
  );
}

describe("evaluation plan persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("creates, edits, and reorders event-scoped draft rounds", async () => {
    const event = await events.create(baseEvent);
    const plan = await evaluations.create(event.id, "CFP review");
    const screening = await evaluations.createRound({
      eventId: event.id,
      planId: plan.id,
      name: "Screening",
      reviewerVisibility: ReviewerVisibility.BLIND,
    });
    const committee = await evaluations.createRound({
      eventId: event.id,
      planId: plan.id,
      name: "Committee review",
      reviewerVisibility: ReviewerVisibility.IDENTIFIED,
    });

    const updated = await evaluations.updateRound(event.id, screening.id, {
      name: "Eligibility screening",
      reviewerVisibility: ReviewerVisibility.ANONYMIZED,
    });
    assert.equal(updated.name, "Eligibility screening");

    const reordered = await evaluations.reorder(event.id, plan.id, [committee.id, screening.id]);
    assert.deepEqual(
      reordered.map(({ id, sortOrder }) => [id, sortOrder]),
      [
        [committee.id, 0],
        [screening.id, 1],
      ],
    );
  });

  test("snapshots visibility and retains immutable lifecycle history", async () => {
    const event = await events.create(baseEvent);
    const plan = await evaluations.create(event.id, "Editorial review");
    const first = await evaluations.createRound({
      eventId: event.id,
      planId: plan.id,
      name: "Blind review",
      reviewerVisibility: ReviewerVisibility.BLIND,
    });
    const final = await evaluations.createRound({
      eventId: event.id,
      planId: plan.id,
      name: "Final committee",
      reviewerVisibility: ReviewerVisibility.IDENTIFIED,
    });

    const active = await evaluations.transition(event.id, first.id, EvaluationRoundStatus.ACTIVE);
    assert.equal(active.visibilitySnapshot, ReviewerVisibility.BLIND);
    await expectRepositoryError(
      evaluations.updateRound(event.id, first.id, {
        name: "Rewritten history",
        reviewerVisibility: ReviewerVisibility.IDENTIFIED,
      }),
      "invalid-input",
    );
    await expectRepositoryError(evaluations.reorder(event.id, plan.id, [final.id, first.id]), "invalid-input");
    await expectRepositoryError(
      evaluations.transition(event.id, final.id, EvaluationRoundStatus.ACTIVE),
      "invalid-input",
    );

    await evaluations.transition(event.id, first.id, EvaluationRoundStatus.CLOSED);
    await evaluations.transition(event.id, first.id, EvaluationRoundStatus.ARCHIVED);
    await evaluations.transition(event.id, final.id, EvaluationRoundStatus.ACTIVE);

    const persisted = await evaluations.get(event.id);
    assert.deepEqual(
      persisted?.rounds[0]?.transitions.map(({ fromStatus, toStatus }) => [fromStatus, toStatus]),
      [
        [null, EvaluationRoundStatus.DRAFT],
        [EvaluationRoundStatus.DRAFT, EvaluationRoundStatus.ACTIVE],
        [EvaluationRoundStatus.ACTIVE, EvaluationRoundStatus.CLOSED],
        [EvaluationRoundStatus.CLOSED, EvaluationRoundStatus.ARCHIVED],
      ],
    );
  });

  test("rejects cross-event identifiers", async () => {
    const firstEvent = await events.create(baseEvent);
    const secondEvent = await events.create({ ...baseEvent, name: "Other event", slug: "other-event" });
    const plan = await evaluations.create(firstEvent.id, "Review");
    const round = await evaluations.createRound({
      eventId: firstEvent.id,
      planId: plan.id,
      name: "Round one",
      reviewerVisibility: ReviewerVisibility.BLIND,
    });

    assert.equal(await evaluations.get(secondEvent.id), null);
    await expectRepositoryError(
      evaluations.updateRound(secondEvent.id, round.id, {
        name: "Cross-event edit",
        reviewerVisibility: ReviewerVisibility.IDENTIFIED,
      }),
      "not-found",
    );
  });
});
