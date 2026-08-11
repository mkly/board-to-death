import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findEvent: vi.fn(),
  getSession: vi.fn(),
  isAuthorizedAdminSession: vi.fn(),
  promote: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/admin-access", () => ({ isAuthorizedAdminSession: mocks.isAuthorizedAdminSession }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/server/database/client", () => ({
  getDatabaseClient: () => ({ event: { findUnique: mocks.findEvent } }),
}));
vi.mock("@/server/sessions/repositories", () => ({
  ProgramSessionRepository: class {
    readonly promote = mocks.promote;
  },
}));

import { promoteSubmissionToSession } from "./actions";

const eventId = "11111111-1111-4111-8111-111111111111";
const submissionId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

function promotionForm(): FormData {
  const formData = new FormData();
  formData.set("eventSlug", "event-one");
  formData.set("submissionId", submissionId);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "organizer-one" } });
  mocks.isAuthorizedAdminSession.mockResolvedValue(true);
  mocks.findEvent.mockResolvedValue({ id: eventId, slug: "event-one" });
  mocks.promote.mockResolvedValue({ id: sessionId });
});

describe("promoteSubmissionToSession", () => {
  it("promotes an event-owned accepted submission and revalidates both workflows", async () => {
    const result = await promoteSubmissionToSession({ status: "idle" }, promotionForm());

    expect(mocks.promote).toHaveBeenCalledWith({ eventId, sourceSubmissionId: submissionId });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/dashboard/events/event-one/submissions"],
      [`/dashboard/events/event-one/submissions/${submissionId}`],
      ["/dashboard/events/event-one/sessions"],
    ]);
    expect(result).toEqual({
      status: "success",
      message: "Proposal promoted to a program session.",
      sessionId,
    });
  });

  it("does not expose the promotion operation to an unauthorized session", async () => {
    mocks.isAuthorizedAdminSession.mockResolvedValue(false);

    const result = await promoteSubmissionToSession({ status: "idle" }, promotionForm());

    expect(mocks.promote).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "error", message: "Your admin session expired. Sign in and try again." });
  });
});
