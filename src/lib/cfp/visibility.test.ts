import { describe, expect, it } from "vitest";

import type { CfpQuestion } from "./types";
import { conditionOperatorsForQuestion, evaluateCfpVisibilityRule, validateConditionForQuestion } from "./visibility";

const formatQuestion: CfpQuestion = {
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
};

describe("CFP conditional visibility", () => {
  it("evaluates matching and nonmatching all/any rules without coercing answer values", () => {
    expect(
      evaluateCfpVisibilityRule(
        {
          logic: "all",
          conditions: [
            { questionId: "format", operator: "equals", value: "workshop" },
            { questionId: "capacity", operator: "not_equals", value: 0 },
          ],
        },
        { format: "workshop", capacity: 20 },
      ),
    ).toBe(true);
    expect(
      evaluateCfpVisibilityRule(
        {
          logic: "all",
          conditions: [
            { questionId: "format", operator: "equals", value: "workshop" },
            { questionId: "capacity", operator: "not_equals", value: 0 },
          ],
        },
        { format: "talk", capacity: 20 },
      ),
    ).toBe(false);
    expect(
      evaluateCfpVisibilityRule(
        {
          logic: "any",
          conditions: [
            { questionId: "topics", operator: "in", value: ["design", "playtesting"] },
            { questionId: "notes", operator: "is_not_empty" },
          ],
        },
        { topics: ["publishing"], notes: "Bring a prototype" },
      ),
    ).toBe(true);
    expect(
      evaluateCfpVisibilityRule(
        { logic: "all", conditions: [{ questionId: "capacity", operator: "equals", value: 20 }] },
        { capacity: "20" },
      ),
    ).toBe(false);
  });

  it("defines compatible operators and values from the source question type", () => {
    expect(conditionOperatorsForQuestion("multi_select")).toEqual(["in", "not_in", "is_empty", "is_not_empty"]);
    expect(conditionOperatorsForQuestion("custom_rich_text")).toEqual(["is_empty", "is_not_empty"]);
    expect(
      validateConditionForQuestion({ questionId: "format", operator: "equals", value: "workshop" }, formatQuestion),
    ).toBeNull();
    expect(
      validateConditionForQuestion({ questionId: "format", operator: "equals", value: "webinar" }, formatQuestion),
    ).toContain("not one of its configured options");
    expect(
      validateConditionForQuestion({ questionId: "format", operator: "is_empty", value: "talk" }, formatQuestion),
    ).toContain("must not include a comparison value");
  });
});
