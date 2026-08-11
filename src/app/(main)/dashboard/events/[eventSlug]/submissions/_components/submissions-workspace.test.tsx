// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  recordSubmissionDecision: vi.fn(),
  resetSubmissionView: vi.fn(),
  saveSubmissionView: vi.fn(),
}));

vi.mock("../actions", () => actionMocks);

import { CfpSubmissionKind, CfpSubmissionStatus } from "@/generated/prisma/client";
import type { CfpSubmissionListResult } from "@/server/cfp/submissions";

import { SubmissionsWorkspace } from "./submissions-workspace";

const event = {
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  timezone: "America/Los_Angeles",
};

function result(overrides: Partial<CfpSubmissionListResult> = {}): CfpSubmissionListResult {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    pageCount: 1,
    metrics: {
      DRAFT: 0,
      SUBMITTED: 0,
      UNDER_REVIEW: 0,
      WAITLISTED: 0,
      ACCEPTED: 0,
      REJECTED: 0,
      CONFIRMED: 0,
    },
    ...overrides,
  };
}

afterEach(cleanup);

describe("SubmissionsWorkspace", () => {
  it("renders lifecycle metrics and the empty state", () => {
    render(
      <SubmissionsWorkspace
        event={event}
        filters={{}}
        options={{ categories: [], assignees: [], customColumns: [] }}
        result={result()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Submissions" })).toBeTruthy();
    expect(screen.getByText("No submissions found")).toBeTruthy();
    expect(screen.getByText("Total submissions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
  });

  it("renders populated rows and keeps composed filters in pagination links", () => {
    render(
      <SubmissionsWorkspace
        event={event}
        filters={{
          search: "lex",
          status: CfpSubmissionStatus.UNDER_REVIEW,
          kind: CfpSubmissionKind.ABSTRACT,
          categoryId: "category-1",
          assigneeId: "reviewer-1",
          page: 2,
        }}
        options={{
          categories: [{ id: "category-1", label: "Strategy" }],
          assignees: [{ id: "reviewer-1", displayName: "Casey Reviewer" }],
          customColumns: [{ id: "audience", label: "Audience", type: "short_text" }],
        }}
        result={result({
          items: [
            {
              id: "submission-1",
              kind: CfpSubmissionKind.ABSTRACT,
              status: CfpSubmissionStatus.UNDER_REVIEW,
              submittedAt: new Date("2027-03-13T18:30:00.000Z"),
              updatedAt: new Date("2027-03-13T18:30:00.000Z"),
              formTitle: "Board Game Design CFP",
              categories: [{ id: "category-1", label: "Strategy" }],
              applicants: [{ id: "speaker-1", name: "Lex", email: "lex@example.test" }],
              assignees: [{ id: "reviewer-1", displayName: "Casey Reviewer" }],
              answers: { audience: "Design leaders" },
              averageScore: 4.25,
              completedReviews: 1,
              totalReviews: 2,
            },
          ],
          total: 21,
          page: 2,
          pageCount: 2,
          metrics: { ...result().metrics, UNDER_REVIEW: 1, DRAFT: 20 },
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "Board Game Design CFP" }).getAttribute("href")).toBe(
      "/dashboard/events/board-to-death-2027/submissions/submission-1",
    );
    expect(screen.getByText("Lex")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeTruthy();
    // The assignee name renders three times: the row cell, the Radix select trigger label, and the
    // hidden native select option Radix keeps for form submission.
    expect(screen.getAllByText("Casey Reviewer")).toHaveLength(3);
    const previous = screen.getByRole("link", { name: "Go to previous page" });
    expect(previous.getAttribute("href")).toContain("q=lex");
    expect(previous.getAttribute("href")).toContain("status=UNDER_REVIEW");
    expect(previous.getAttribute("href")).toContain("category=category-1");
    expect(screen.getByRole("link", { name: "Page 2 of 2" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Columns" })).toBeTruthy();
    const exportButton = screen.getByRole("button", { name: "Export" });
    fireEvent.pointerDown(exportButton, { button: 0, ctrlKey: false });
    expect(screen.getByRole("menuitem", { name: "CSV spreadsheet" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Excel workbook" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Attachment bundle" })).toBeNull();
  });
});
