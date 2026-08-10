import { describe, expect, it } from "vitest";

import { type CfpApplicantMessageContext, renderCfpApplicantMessage } from "./thank-you.ts";

function context(proposalTitle: string | null): CfpApplicantMessageContext {
  return {
    event: {
      id: "event-1",
      name: "Board to Death 2027",
      startsAt: new Date("2027-05-04T16:00:00.000Z"),
      timezone: "UTC",
      location: null,
    },
    recipient: { email: "avery@example.test", name: "Avery Chen" },
    proposalTitle,
  };
}

describe("CFP applicant confirmation", () => {
  it("names the proposal and the event in the subject", () => {
    const rendered = renderCfpApplicantMessage(
      "Thanks, {{recipient.name}}.",
      context("Designing Welcoming Game Nights"),
    );

    expect(rendered.subject).toBe("Submission received: Designing Welcoming Game Nights — Board to Death 2027");
  });

  it("falls back to the title-free subject when the form has no proposal title question", () => {
    const rendered = renderCfpApplicantMessage("Thanks, {{recipient.name}}.", context(null));

    expect(rendered.subject).toBe("Thank you for submitting to Board to Death 2027");
  });
});
