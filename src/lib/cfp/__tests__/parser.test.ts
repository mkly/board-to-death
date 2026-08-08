import { describe, expect, it } from "vitest";

import { parseCfpDefinition } from "../parser";
import type { CfpFormDefinition } from "../types";

function baseDefinition(overrides: Partial<CfpFormDefinition> = {}): CfpFormDefinition {
  return {
    version: 1,
    title: "AI Engineer CFP",
    sections: [
      {
        id: "speaker",
        kind: "speaker",
        title: "Speaker details",
        questions: [{ id: "speaker-name", type: "short_text", label: "Full name", required: true }],
      },
      {
        id: "proposal",
        kind: "questions",
        title: "Proposal details",
        questions: [
          {
            id: "session-type",
            type: "select",
            label: "Session type",
            required: true,
            constraints: {
              options: [
                { value: "talk", label: "Talk" },
                { value: "workshop", label: "Workshop" },
              ],
            },
          },
          {
            id: "workshop-length",
            type: "number",
            label: "Workshop length (minutes)",
            required: false,
            constraints: { min: 30, max: 240 },
            visibleWhen: {
              logic: "all",
              conditions: [{ questionId: "session-type", operator: "equals", value: "workshop" }],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("parseCfpDefinition", () => {
  it("accepts a well-formed versioned definition with sections, constraints, and conditional visibility", () => {
    const result = parseCfpDefinition(baseDefinition());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.sections).toHaveLength(2);
      expect(result.definition.sections[1].questions[1].visibleWhen?.conditions[0].questionId).toBe("session-type");
    }
  });

  it("accepts a custom question type declared in customQuestionTypes", () => {
    const definition = baseDefinition({
      customQuestionTypes: ["speaker_bio_rich_text"],
      sections: [
        {
          id: "proposal",
          kind: "questions",
          title: "Proposal",
          questions: [{ id: "bio", type: "speaker_bio_rich_text", label: "Bio", required: true }],
        },
      ],
    });

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(true);
  });

  it("routes categories from a rule referencing a declared question and category", () => {
    const definition = baseDefinition({
      categories: [
        { id: "talks", label: "Talks" },
        { id: "workshops", label: "Workshops" },
      ],
      categoryRouting: [
        {
          id: "route-workshop",
          when: { logic: "all", conditions: [{ questionId: "session-type", operator: "equals", value: "workshop" }] },
          categoryId: "workshops",
        },
      ],
    });

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported version", () => {
    const result = parseCfpDefinition(baseDefinition({ version: 99 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "unsupported_version", path: "version" }));
    }
  });

  it("rejects a malformed definition with structured per-field errors", () => {
    const result = parseCfpDefinition({ version: 1, title: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every((error) => error.code === "malformed_definition")).toBe(true);
    }
  });

  it("rejects non-object input", () => {
    const result = parseCfpDefinition("not a definition");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("malformed_definition");
    }
  });

  it("reports a missing rule target when visibleWhen references an unknown question", () => {
    const definition = baseDefinition();
    definition.sections[1].questions[1].visibleWhen = {
      logic: "all",
      conditions: [{ questionId: "does-not-exist", operator: "equals", value: "workshop" }],
    };

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "missing_rule_target" }));
    }
  });

  it("reports a missing rule target when category routing targets an undeclared category", () => {
    const definition = baseDefinition({
      categories: [{ id: "talks", label: "Talks" }],
      categoryRouting: [
        {
          id: "route-workshop",
          when: { logic: "all", conditions: [{ questionId: "session-type", operator: "equals", value: "workshop" }] },
          categoryId: "does-not-exist",
        },
      ],
    });

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "missing_rule_target", path: "categoryRouting.0.categoryId" }),
      );
    }
  });

  it("reports every category routing target when no categories are declared", () => {
    const definition = baseDefinition({
      categoryRouting: [
        {
          id: "route-talk",
          when: { logic: "all", conditions: [{ questionId: "session-type", operator: "equals", value: "talk" }] },
          categoryId: "talks",
        },
        {
          id: "route-workshop",
          when: { logic: "all", conditions: [{ questionId: "session-type", operator: "equals", value: "workshop" }] },
          categoryId: "workshops",
        },
      ],
    });

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "missing_rule_target", path: "categoryRouting.0.categoryId" }),
          expect.objectContaining({ code: "missing_rule_target", path: "categoryRouting.1.categoryId" }),
        ]),
      );
    }
  });

  it("reports an unknown question type that is neither built-in nor declared custom", () => {
    const definition = baseDefinition();
    definition.sections[0].questions[0].type = "mystery_widget";

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "unknown_question_type" }));
    }
  });

  it("reports duplicate question ids across sections", () => {
    const definition = baseDefinition();
    definition.sections[1].questions.push({
      id: "speaker-name",
      type: "short_text",
      label: "Duplicate",
      required: false,
    });

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "duplicate_id" }));
    }
  });

  it("reports an impossible rule when a question depends on itself", () => {
    const definition = baseDefinition();
    definition.sections[1].questions[0].visibleWhen = {
      logic: "all",
      conditions: [{ questionId: "session-type", operator: "equals", value: "talk" }],
    };

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "impossible_rule", path: "sections.1.questions.0.visibleWhen" }),
      );
    }
  });

  it("reports a cyclic rule when two questions depend on each other", () => {
    const definition = baseDefinition({
      sections: [
        {
          id: "proposal",
          kind: "questions",
          title: "Proposal",
          questions: [
            {
              id: "q1",
              type: "short_text",
              label: "Q1",
              required: false,
              visibleWhen: { logic: "all", conditions: [{ questionId: "q2", operator: "equals", value: "x" }] },
            },
            {
              id: "q2",
              type: "short_text",
              label: "Q2",
              required: false,
              visibleWhen: { logic: "all", conditions: [{ questionId: "q1", operator: "equals", value: "y" }] },
            },
          ],
        },
      ],
    });

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "cyclic_rule" }));
    }
  });

  it("reports an impossible rule when minLength exceeds maxLength", () => {
    const definition = baseDefinition();
    definition.sections[0].questions[0].constraints = { minLength: 10, maxLength: 5 };

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "impossible_rule" }));
    }
  });

  it("rejects constraints that do not apply to a built-in question type", () => {
    const definition = baseDefinition();
    definition.sections[1].questions[1].constraints = { minLength: 2 };

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "impossible_rule", path: "sections.1.questions.1.constraints.minLength" }),
      );
    }
  });

  it("requires unique options for selection questions", () => {
    const definition = baseDefinition();
    definition.sections[1].questions[0].constraints = {
      options: [
        { value: "talk", label: "Talk" },
        { value: "talk", label: "Another talk" },
      ],
    };

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "duplicate_id", path: "sections.1.questions.0.constraints.options" }),
      );
    }
  });

  it("requires selection questions to declare options", () => {
    const definition = baseDefinition();
    definition.sections[1].questions[0].constraints = undefined;

    const result = parseCfpDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "impossible_rule", path: "sections.1.questions.0.constraints.options" }),
      );
    }
  });
});
