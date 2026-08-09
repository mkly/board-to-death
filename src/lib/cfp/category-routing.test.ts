import { describe, expect, it } from "vitest";

import { resolveCfpPolicyCategoryId, validateCfpPolicyCategoryRouting } from "./category-routing";
import type { CfpFormDefinition } from "./types";

const definition: CfpFormDefinition = {
  version: 1,
  title: "Call for proposals",
  sections: [
    {
      id: "details",
      kind: "questions",
      title: "Details",
      questions: [
        {
          id: "topic",
          type: "select",
          label: "Topic",
          required: true,
          constraints: {
            options: [
              { value: "game-design", label: "Game design" },
              { value: "publishing", label: "Publishing" },
            ],
          },
        },
        {
          id: "notes",
          type: "long_text",
          label: "Notes",
          required: false,
        },
      ],
    },
  ],
};

const categoryIds = new Set(["design-category", "publishing-category"]);

describe("validateCfpPolicyCategoryRouting", () => {
  it("accepts a route targeting an event-owned category with a rule over a form question", () => {
    expect(
      validateCfpPolicyCategoryRouting(
        [
          {
            categoryId: "design-category",
            condition: { logic: "all", conditions: [{ questionId: "topic", operator: "equals", value: "game-design" }] },
          },
        ],
        definition,
        categoryIds,
      ),
    ).toEqual([]);
  });

  it("rejects a category not owned by the current event", () => {
    const errors = validateCfpPolicyCategoryRouting(
      [
        {
          categoryId: "other-event-category",
          condition: { logic: "all", conditions: [{ questionId: "topic", operator: "equals", value: "game-design" }] },
        },
      ],
      definition,
      categoryIds,
    );
    expect(errors).toEqual(["Route 1: category is not owned by this event."]);
  });

  it("rejects a condition that references a question outside the form", () => {
    const errors = validateCfpPolicyCategoryRouting(
      [
        {
          categoryId: "design-category",
          condition: { logic: "all", conditions: [{ questionId: "missing-question", operator: "equals", value: "x" }] },
        },
      ],
      definition,
      categoryIds,
    );
    expect(errors).toEqual(["Route 1: references a question that is not part of this form."]);
  });

  it("rejects an answer value incompatible with the referenced question", () => {
    const errors = validateCfpPolicyCategoryRouting(
      [
        {
          categoryId: "design-category",
          condition: { logic: "all", conditions: [{ questionId: "topic", operator: "equals", value: "webinar" }] },
        },
      ],
      definition,
      categoryIds,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Route 1:");
  });

  it("rejects two routes with structurally identical conditions targeting different categories", () => {
    const errors = validateCfpPolicyCategoryRouting(
      [
        {
          categoryId: "design-category",
          condition: { logic: "all", conditions: [{ questionId: "topic", operator: "equals", value: "game-design" }] },
        },
        {
          categoryId: "publishing-category",
          condition: { logic: "all", conditions: [{ questionId: "topic", operator: "equals", value: "game-design" }] },
        },
      ],
      definition,
      categoryIds,
    );
    expect(errors).toEqual(["Route 2: this condition conflicts with another route targeting a different category."]);
  });

  it("rejects a second route targeting a category that already has one", () => {
    const errors = validateCfpPolicyCategoryRouting(
      [
        {
          categoryId: "design-category",
          condition: { logic: "all", conditions: [{ questionId: "topic", operator: "equals", value: "game-design" }] },
        },
        {
          categoryId: "design-category",
          condition: { logic: "all", conditions: [{ questionId: "notes", operator: "is_not_empty" }] },
        },
      ],
      definition,
      categoryIds,
    );
    expect(errors).toEqual(["Route 2: category already has a route configured."]);
  });
});

describe("resolveCfpPolicyCategoryId", () => {
  const routes = [
    {
      categoryId: "design-category",
      condition: { logic: "all" as const, conditions: [{ questionId: "topic", operator: "equals" as const, value: "game-design" }] },
    },
    {
      categoryId: "publishing-category",
      condition: { logic: "all" as const, conditions: [{ questionId: "topic", operator: "equals" as const, value: "publishing" }] },
    },
  ];

  it("chooses the category whose rule matches the submitted answers", () => {
    expect(resolveCfpPolicyCategoryId(routes, { topic: "game-design" })).toBe("design-category");
    expect(resolveCfpPolicyCategoryId(routes, { topic: "publishing" })).toBe("publishing-category");
  });

  it("returns null when no route matches", () => {
    expect(resolveCfpPolicyCategoryId(routes, { topic: "other" })).toBeNull();
  });

  it("deterministically chooses the first configured match when multiple routes are ambiguous", () => {
    const ambiguousRoutes = [
      {
        categoryId: "design-category",
        condition: { logic: "all" as const, conditions: [{ questionId: "topic", operator: "is_not_empty" as const }] },
      },
      {
        categoryId: "publishing-category",
        condition: { logic: "all" as const, conditions: [{ questionId: "topic", operator: "equals" as const, value: "game-design" }] },
      },
    ];
    expect(resolveCfpPolicyCategoryId(ambiguousRoutes, { topic: "game-design" })).toBe("design-category");
  });
});
