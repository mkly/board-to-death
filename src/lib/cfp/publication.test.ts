import { describe, expect, it } from "vitest";

import { publicCfpHref, validateCfpDefinitionForPublication } from "./publication";
import type { CfpFormDefinition } from "./types";

const completeDefinition: CfpFormDefinition = {
  version: 1,
  title: "Community CFP",
  submissionKind: "ABSTRACT",
  accessPolicy: "OPEN",
  welcomeTitle: "Share your session",
  welcomeContent: "Tell the program team what you want to teach.",
  instructions: "Complete the proposal and speaker details before submitting.",
  termsContent: "I agree to the event terms.",
  consentRequired: true,
  minimumSpeakerCount: 1,
  maximumSpeakerCount: 4,
  sections: [{ id: "proposal", kind: "questions", title: "Proposal", questions: [] }],
};

describe("CFP publication validation", () => {
  it("accepts a complete saved definition and builds an encoded stable path", () => {
    expect(validateCfpDefinitionForPublication(completeDefinition)).toEqual([]);
    expect(publicCfpHref("public/id")).toBe("/cfp/public%2Fid");
  });

  it("reports every incomplete setup area before publication", () => {
    const issues = validateCfpDefinitionForPublication({
      ...completeDefinition,
      title: "x",
      submissionKind: undefined,
      accessPolicy: undefined,
      welcomeTitle: "",
      welcomeContent: "short",
      instructions: "",
      minimumSpeakerCount: undefined,
      maximumSpeakerCount: undefined,
      termsContent: "short",
    });

    expect(issues.map(({ path }) => path)).toEqual([
      "title",
      "submissionKind",
      "accessPolicy",
      "welcomeTitle",
      "welcomeContent",
      "instructions",
      "speakers",
      "termsContent",
    ]);
  });
});
