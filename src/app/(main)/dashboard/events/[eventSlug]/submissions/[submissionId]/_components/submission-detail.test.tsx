// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { CfpSubmissionDetail } from "@/server/cfp/submissions";

import { SubmissionDetail } from "./submission-detail";

const now = new Date("2027-03-13T18:30:00.000Z");

function detail(overrides: Partial<CfpSubmissionDetail> = {}): CfpSubmissionDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "ABSTRACT" as CfpSubmissionDetail["kind"],
    status: "SUBMITTED" as CfpSubmissionDetail["status"],
    submittedAt: now,
    reviewStartedAt: null,
    decidedAt: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    event: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Board to Death 2027",
      slug: "board-to-death-2027",
      timezone: "America/Los_Angeles",
    },
    categories: [{ id: "33333333-3333-4333-8333-333333333333", label: "Game design" }],
    participants: [
      {
        sortOrder: 0,
        speaker: {
          id: "44444444-4444-4444-8444-444444444444",
          email: "alex@example.test",
          givenName: "Alex",
          familyName: "Rivera",
          preferredName: "Lex",
          pronouns: "they/them",
          organization: "Tabletop Guild",
          jobTitle: "Designer",
        },
      },
      {
        sortOrder: 1,
        speaker: {
          id: "55555555-5555-4555-8555-555555555555",
          email: "sam@example.test",
          givenName: "Sam",
          familyName: "Lee",
          preferredName: null,
          pronouns: null,
          organization: null,
          jobTitle: null,
        },
      },
    ],
    revision: {
      id: "66666666-6666-4666-8666-666666666666",
      versionNumber: 2,
      kind: "FINAL" as NonNullable<CfpSubmissionDetail["revision"]>["kind"],
      formVersionId: "77777777-7777-4777-8777-777777777777",
      definition: {
        version: 1,
        title: "Board Game Design CFP",
        sections: [
          {
            id: "proposal",
            kind: "questions",
            title: "Proposal",
            questions: [
              { id: "abstract", type: "long_text", label: "Abstract", required: true },
              { id: "duration", type: "number", label: "Duration", required: true },
            ],
          },
        ],
      },
      answers: [
        { questionId: "abstract", value: "How collaborative games create memorable stories." },
        { questionId: "duration", value: 45 },
      ],
      createdAt: now,
    },
    ...overrides,
  };
}

afterEach(cleanup);

describe("SubmissionDetail", () => {
  it("renders abstract answers, category, and speakers in applicant order", () => {
    render(<SubmissionDetail submission={detail()} />);

    expect(screen.getByRole("heading", { name: "Submission details" })).toBeTruthy();
    expect(screen.getByText("Abstract", { selector: "dt" })).toBeTruthy();
    expect(screen.getByText("How collaborative games create memorable stories.")).toBeTruthy();
    expect(screen.getByText("Game design")).toBeTruthy();
    const [primarySpeaker, secondarySpeaker] = screen.getAllByRole("listitem");
    if (!primarySpeaker || !secondarySpeaker) throw new Error("Expected two ordered speaker rows.");
    expect(within(primarySpeaker).getByText("Lex")).toBeTruthy();
    expect(within(primarySpeaker).getByText("Applicant")).toBeTruthy();
    expect(within(secondarySpeaker).getByText("Sam Lee")).toBeTruthy();
  });

  it("renders a guaranteed session without optional responses or participants", () => {
    render(
      <SubmissionDetail
        submission={detail({
          kind: "GUARANTEED_SESSION" as CfpSubmissionDetail["kind"],
          categories: [],
          participants: [],
          revision: null,
        })}
      />,
    );

    expect(screen.getAllByText("Guaranteed Session").length).toBeGreaterThan(0);
    expect(screen.getByText("No speakers are attached to this submission.")).toBeTruthy();
    expect(screen.getByText("This submission does not have a saved response revision.")).toBeTruthy();
    expect(screen.getByText("No categories assigned.")).toBeTruthy();
  });
});
