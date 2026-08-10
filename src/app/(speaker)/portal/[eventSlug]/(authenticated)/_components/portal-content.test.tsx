// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CfpSubmissionStatus } from "@/generated/prisma/client";

vi.mock("server-only", () => ({}));

import { SubmissionStatus } from "./portal-content";

afterEach(cleanup);

describe("SubmissionStatus", () => {
  it.each([
    [CfpSubmissionStatus.ACCEPTED, "Accepted"],
    [CfpSubmissionStatus.WAITLISTED, "Waitlisted"],
    [CfpSubmissionStatus.REJECTED, "Rejected"],
  ] as const)("renders the %s applicant decision", (status, label) => {
    render(<SubmissionStatus status={status} />);

    expect(screen.getByText(label).closest('[data-slot="badge"]')).toBeTruthy();
  });
});
