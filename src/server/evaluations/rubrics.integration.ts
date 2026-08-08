import { PrismaPg } from "@prisma/adapter-pg";

import { CfpSubmissionKind, EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { EvaluationRubricRepository } from "./rubrics.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for evaluation rubric integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const rubrics = new EvaluationRubricRepository(client);

async function createRound(slug: string) {
  const event = await client.event.create({
    data: {
      name: `Rubric ${slug}`,
      slug,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-03-13T17:00:00.000Z"),
      endsAt: new Date("2027-03-15T00:00:00.000Z"),
      evaluationPlans: {
        create: {
          key: "main-evaluation",
          versions: {
            create: {
              versionNumber: 1,
              title: "2027 evaluation plan",
              rounds: { create: { key: "review", title: "Review", sortOrder: 0 } },
            },
          },
        },
      },
    },
    include: {
      evaluationPlans: { include: { versions: { include: { rounds: true } } } },
    },
  });
  const version = event.evaluationPlans[0]?.versions[0];
  const round = version?.rounds[0];
  assert.ok(version);
  assert.ok(round);
  return { event, version, round };
}

describe("evaluation rubric administration", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("adds the default rubric and persists edits, required state, weights, and ordering", async () => {
    const { event, round } = await createRound("defaults");
    await rubrics.addDefaults(event.id, round.id);

    let plan = (await rubrics.list(event.id))[0];
    assert.deepEqual(
      plan?.versions[0]?.rounds[0]?.criteria.map(({ key, minimum, maximum, weight, required }) => ({
        key,
        minimum,
        maximum,
        weight,
        required,
      })),
      [
        { key: "relevance", minimum: 1, maximum: 5, weight: 1, required: true },
        { key: "technical-depth", minimum: 1, maximum: 5, weight: 1, required: true },
        { key: "speaker-authority", minimum: 1, maximum: 5, weight: 1, required: true },
      ],
    );

    const criteria = plan?.versions[0]?.rounds[0]?.criteria;
    const relevance = criteria?.[0];
    const authority = criteria?.[2];
    assert.ok(relevance);
    assert.ok(authority);
    await rubrics.update(event.id, relevance.id, {
      key: relevance.key,
      label: "Program relevance",
      description: "Fit for this event.",
      minimum: 0,
      maximum: 10,
      weight: 2.5,
      required: false,
    });
    await rubrics.reorder(event.id, round.id, [authority.id, criteria[1]?.id ?? "", relevance.id]);

    plan = (await rubrics.list(event.id))[0];
    const reloaded = plan?.versions[0]?.rounds[0]?.criteria;
    assert.deepEqual(
      reloaded?.map(({ key }) => key),
      ["speaker-authority", "technical-depth", "relevance"],
    );
    assert.deepEqual(
      reloaded?.find(({ id }) => id === relevance.id),
      {
        id: relevance.id,
        roundId: round.id,
        key: "relevance",
        label: "Program relevance",
        description: "Fit for this event.",
        sortOrder: 2,
        minimum: 0,
        maximum: 10,
        weight: 2.5,
        required: false,
        used: false,
      },
    );
  });

  test("rejects invalid bounds and activation without a complete rubric", async () => {
    const { event, version, round } = await createRound("validation");
    await assert.rejects(
      rubrics.add(event.id, round.id, {
        key: "invalid",
        label: "Invalid",
        minimum: 5,
        maximum: 5,
        weight: 1,
        required: true,
      }),
      (error: unknown) => error instanceof RepositoryError && error.code === "invalid-input",
    );
    await assert.rejects(
      client.evaluationPlanVersion.update({
        where: { id: version.id },
        data: { status: "ACTIVE", activatedAt: new Date() },
      }),
      /requires rubric criteria/,
    );
  });

  test("prevents mutation after activation and after a criterion has evaluation results", async () => {
    const activeFixture = await createRound("active-history");
    await rubrics.addDefaults(activeFixture.event.id, activeFixture.round.id);
    await client.evaluationPlanVersion.update({
      where: { id: activeFixture.version.id },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
    const activeCriterion = (await rubrics.list(activeFixture.event.id))[0]?.versions[0]?.rounds[0]?.criteria[0];
    assert.ok(activeCriterion);
    await assert.rejects(
      rubrics.update(activeFixture.event.id, activeCriterion.id, { ...activeCriterion, label: "Changed" }),
      /Only draft plan versions/,
    );
    await assert.rejects(
      client.evaluationCriterion.create({
        data: {
          roundId: activeFixture.round.id,
          key: "late-addition",
          label: "Late addition",
          sortOrder: 3,
          weight: 1,
          minimum: 1,
          maximum: 5,
        },
      }),
      /active or retired plan versions are immutable/,
    );

    const usedFixture = await createRound("used-history");
    await rubrics.addDefaults(usedFixture.event.id, usedFixture.round.id);
    const usedCriterion = (await rubrics.list(usedFixture.event.id))[0]?.versions[0]?.rounds[0]?.criteria[0];
    assert.ok(usedCriterion);
    const formVersion = await client.cfpFormVersion.create({
      data: {
        form: { create: { eventId: usedFixture.event.id, key: "main-cfp" } },
        versionNumber: 1,
        schemaVersion: 1,
        title: "CFP",
        customTypes: [],
      },
    });
    const submission = await client.cfpSubmission.create({
      data: { eventId: usedFixture.event.id, formVersionId: formVersion.id, kind: CfpSubmissionKind.ABSTRACT },
    });
    const reviewer = await client.evaluationReviewer.create({
      data: {
        eventId: usedFixture.event.id,
        identityId: "reviewer-used-history",
        email: "reviewer@example.test",
        displayName: "Reviewer",
      },
    });
    await client.evaluationAssignment.create({
      data: {
        roundId: usedFixture.round.id,
        submissionId: submission.id,
        reviewerId: reviewer.id,
        evaluation: { create: { results: { create: { criterionId: usedCriterion.id, score: 4 } } } },
      },
    });

    await assert.rejects(
      rubrics.update(usedFixture.event.id, usedCriterion.id, { ...usedCriterion, label: "Changed" }),
      /already used by an evaluation/,
    );
    await assert.rejects(
      client.evaluationCriterion.update({ where: { id: usedCriterion.id }, data: { label: "Direct change" } }),
      /referenced by results are immutable/,
    );
  });
});
