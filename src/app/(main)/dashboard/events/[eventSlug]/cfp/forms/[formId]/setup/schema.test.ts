import { describe, expect, test } from "vitest";

import { validateCfpPolicySettings } from "./schema";

const validInput = {
  submissionOpensAt: "2027-03-13T10:00",
  submissionClosesAt: "2027-03-13T12:00",
  draftPolicy: "ALLOWED",
  maxSubmissionsPerSpeaker: "3",
  maxParticipantsPerSubmission: "4",
};

describe("validateCfpPolicySettings", () => {
  test("converts event-local values to instants across a daylight-saving boundary", () => {
    const result = validateCfpPolicySettings(validInput, "America/Los_Angeles");

    expect(result.fields?.submissionOpensAtInstant.toISOString()).toBe("2027-03-13T18:00:00.000Z");
    expect(result.fields?.submissionClosesAtInstant.toISOString()).toBe("2027-03-13T20:00:00.000Z");
  });

  test("rejects nonexistent local times and a closing time that is not after opening", () => {
    expect(
      validateCfpPolicySettings({ ...validInput, submissionOpensAt: "2027-03-14T02:30" }, "America/Los_Angeles").errors
        ?.submissionOpensAt,
    ).toEqual(["Enter a valid date and time in America/Los_Angeles."]);
    expect(
      validateCfpPolicySettings({ ...validInput, submissionClosesAt: "2027-03-13T10:00" }, "America/Los_Angeles").errors
        ?.submissionClosesAt,
    ).toEqual(["Submissions must close after they open."]);
  });

  test("rejects unsupported draft policies and invalid limits", () => {
    const result = validateCfpPolicySettings(
      { ...validInput, draftPolicy: "SOMETIMES", maxSubmissionsPerSpeaker: "-1", maxParticipantsPerSubmission: "1.5" },
      "America/Los_Angeles",
    );

    expect(result.errors?.draftPolicy).toBeDefined();
    expect(result.errors?.maxSubmissionsPerSpeaker).toEqual(["Allow at least one submission per speaker."]);
    expect(result.errors?.maxParticipantsPerSubmission).toEqual(["Use a whole number of participants."]);
  });
});
