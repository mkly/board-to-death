import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";

import { EvaluationResultsRepository } from "./results";

const decimal = (value: number) => ({ toNumber: () => value });

describe("EvaluationResultsRepository", () => {
  it("excludes draft evaluation scores from official aggregates and rankings", async () => {
    const round = {
      id: "round-1",
      title: "Screening",
      status: "OPEN",
      sortOrder: 0,
      planVersionId: "plan-version-1",
      planVersion: { title: "Program review", versionNumber: 1 },
      criteria: [
        { id: "clarity", label: "Clarity", weight: decimal(1) },
        { id: "novelty", label: "Novelty", weight: decimal(3) },
      ],
    };
    const client = {
      evaluationRound: {
        findMany: vi.fn().mockResolvedValue([round]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      cfpSubmission: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "submission-1",
            status: "UNDER_REVIEW",
            formVersion: { title: "Program CFP" },
            categories: [],
            participants: [],
            evaluationAssignments: [
              {
                status: "COMPLETED",
                evaluation: {
                  status: "FINAL",
                  results: [
                    { criterionId: "clarity", score: decimal(4) },
                    { criterionId: "novelty", score: decimal(5) },
                  ],
                },
              },
              {
                status: "ASSIGNED",
                evaluation: {
                  status: "DRAFT",
                  results: [
                    { criterionId: "clarity", score: decimal(2) },
                    { criterionId: "novelty", score: decimal(1) },
                  ],
                },
              },
            ],
            evaluationAdvancements: [],
            evaluationDecisions: [],
          },
        ]),
      },
    } as unknown as PrismaClient;

    const workspace = await new EvaluationResultsRepository(client).getWorkspace("event-1", round.id);

    expect(workspace.submissions).toHaveLength(1);
    expect(workspace.submissions[0]).toMatchObject({
      completedReviewerCount: 1,
      incompleteReviewerCount: 1,
      weightedAverage: 4.75,
      rank: 1,
      tied: false,
      criteria: [
        { label: "Clarity", average: 4, scoreCount: 1, missingScoreCount: 1 },
        { label: "Novelty", average: 5, scoreCount: 1, missingScoreCount: 1 },
      ],
    });
  });
});
