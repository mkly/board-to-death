import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findEvent: vi.fn(),
  getSession: vi.fn(),
  isAuthorizedAdminSession: vi.fn(),
  storageGet: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/admin-access", () => ({ isAuthorizedAdminSession: mocks.isAuthorizedAdminSession }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/server/database/client", () => ({
  getDatabaseClient: () => ({ event: { findUnique: mocks.findEvent } }),
}));
vi.mock("@/server/infrastructure/configured-file-storage", () => ({
  getConfiguredFileStorage: () => ({ get: mocks.storageGet }),
}));

import { GET } from "./route";

const eventId = "11111111-1111-4111-8111-111111111111";

function request() {
  return GET(new Request(`http://localhost/dashboard/event-settings/branding/${eventId}/logo`), {
    params: Promise.resolve({ asset: "logo", eventId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "admin-1" } });
  mocks.isAuthorizedAdminSession.mockResolvedValue(true);
  mocks.findEvent.mockResolvedValue({ backgroundObjectKey: null, logoObjectKey: "events/event/branding/logo-1" });
  mocks.storageGet.mockResolvedValue({
    ok: true,
    value: { bytes: new Uint8Array([1, 2, 3]), metadata: { contentType: "image/png" } },
  });
});

describe("event branding route", () => {
  it("serves the stored image to an authorized organizer", async () => {
    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("returns 404 without reading the event when the session is not authorized", async () => {
    mocks.isAuthorizedAdminSession.mockResolvedValue(false);

    const response = await request();

    expect(response.status).toBe(404);
    expect(mocks.findEvent).not.toHaveBeenCalled();
    expect(mocks.storageGet).not.toHaveBeenCalled();
  });

  it("returns 404 when the stored object is not an image", async () => {
    mocks.storageGet.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([1]), metadata: { contentType: "text/html" } },
    });

    expect((await request()).status).toBe(404);
  });
});
