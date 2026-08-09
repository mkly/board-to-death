import { describe, expect, it } from "vitest";

import { validateCfpAnswers, visibleCfpQuestionIds } from "./answers";
import type { CfpFormDefinition } from "./types";

const definition: CfpFormDefinition = {
  version: 1,
  title: "Conference CFP",
  categories: [{ id: "workshops", label: "Workshops" }],
  categoryRouting: [
    {
      id: "route-workshops",
      categoryId: "workshops",
      when: { logic: "all", conditions: [{ questionId: "format", operator: "equals", value: "workshop" }] },
    },
  ],
  sections: [
    {
      id: "proposal",
      kind: "questions",
      title: "Proposal",
      questions: [
        { id: "title", type: "short_text", label: "Title", required: true, constraints: { minLength: 3 } },
        { id: "abstract", type: "long_text", label: "Abstract", required: true, constraints: { maxLength: 200 } },
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
          id: "topics",
          type: "multi_select",
          label: "Topics",
          required: true,
          constraints: {
            options: [
              { value: "web", label: "Web" },
              { value: "data", label: "Data" },
            ],
          },
        },
        { id: "recording", type: "checkbox", label: "Recording permission", required: true },
        { id: "duration", type: "number", label: "Duration", required: true, constraints: { min: 30, max: 180 } },
        { id: "slides", type: "url", label: "Slides", required: true },
        { id: "email", type: "email", label: "Email", required: true },
        { id: "available", type: "date", label: "Available", required: true },
        {
          id: "workshop-needs",
          type: "long_text",
          label: "Workshop needs",
          required: true,
          visibleWhen: {
            logic: "all",
            conditions: [{ questionId: "format", operator: "equals", value: "workshop" }],
          },
        },
      ],
    },
  ],
};

function validAnswers(): Record<string, unknown> {
  return {
    title: "Typed forms",
    abstract: "A practical tour of schema-driven forms.",
    format: "workshop",
    topics: ["web", "data"],
    recording: true,
    duration: "90",
    slides: "https://example.com/slides",
    email: "speaker@example.com",
    available: "2026-10-05",
    "workshop-needs": "Tables and power outlets",
  };
}

describe("validateCfpAnswers", () => {
  it("normalizes every built-in type in saved order and derives categories", () => {
    const result = validateCfpAnswers(definition, validAnswers());

    expect(result).toEqual({
      ok: true,
      categoryKeys: ["workshops"],
      answers: [
        { questionId: "title", value: "Typed forms" },
        { questionId: "abstract", value: "A practical tour of schema-driven forms." },
        { questionId: "format", value: "workshop" },
        { questionId: "topics", value: ["web", "data"] },
        { questionId: "recording", value: true },
        { questionId: "duration", value: 90 },
        { questionId: "slides", value: "https://example.com/slides" },
        { questionId: "email", value: "speaker@example.com" },
        { questionId: "available", value: "2026-10-05" },
        { questionId: "workshop-needs", value: "Tables and power outlets" },
      ],
    });
  });

  it("strips hidden answers and does not require hidden questions", () => {
    const answers = validAnswers();
    answers.format = "talk";
    answers["workshop-needs"] = "A client-supplied hidden value";
    const result = validateCfpAnswers(definition, answers);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answers).not.toContainEqual(expect.objectContaining({ questionId: "workshop-needs" }));
      expect(result.categoryKeys).toEqual([]);
    }
  });

  it("does not let an answer to a hidden controller reveal a dependent question", () => {
    const chained: CfpFormDefinition = {
      ...definition,
      sections: [
        {
          ...definition.sections[0],
          questions: [
            ...definition.sections[0].questions,
            {
              id: "hidden-controller",
              type: "short_text",
              label: "Hidden controller",
              required: false,
              visibleWhen: { logic: "all", conditions: [{ questionId: "format", operator: "equals", value: "talk" }] },
            },
            {
              id: "dependent",
              type: "short_text",
              label: "Dependent",
              required: false,
              visibleWhen: {
                logic: "all",
                conditions: [{ questionId: "hidden-controller", operator: "equals", value: "reveal" }],
              },
            },
          ],
        },
      ],
    };

    expect(visibleCfpQuestionIds(chained, { ...validAnswers(), "hidden-controller": "reveal" }).has("dependent")).toBe(
      false,
    );
  });

  it("returns per-question errors for malformed and out-of-contract values", () => {
    const result = validateCfpAnswers(definition, {
      ...validAnswers(),
      title: "x",
      format: "keynote",
      topics: ["unknown"],
      recording: false,
      duration: "many",
      slides: "javascript:alert(1)",
      email: "not-an-email",
      available: "2026-02-31",
      injected: "do not trust me",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toEqual(
        expect.arrayContaining([
          "title",
          "format",
          "topics",
          "recording",
          "duration",
          "slides",
          "email",
          "available",
          "injected",
        ]),
      );
    }
  });
});
