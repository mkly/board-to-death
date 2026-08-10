import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventType } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  eventGet: vi.fn(),
  eventUpdate: vi.fn(),
  getSession: vi.fn(),
  isAuthorizedAdminSession: vi.fn(),
  roomList: vi.fn(),
  storagePut: vi.fn(),
  trackList: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/admin-access", () => ({ isAuthorizedAdminSession: mocks.isAuthorizedAdminSession }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/server/database", () => ({ getDatabaseClient: () => ({}) }));
vi.mock("@/server/events", () => ({
  EventRepository: class {
    readonly get = mocks.eventGet;
    readonly update = mocks.eventUpdate;
  },
  RepositoryError: class extends Error {},
  RoomRepository: class {
    readonly list = mocks.roomList;
  },
  TrackRepository: class {
    readonly list = mocks.trackList;
  },
}));
vi.mock("@/server/infrastructure/configured-file-storage", () => ({
  getConfiguredFileStorage: () => ({ put: mocks.storagePut }),
}));
vi.mock("@/server/infrastructure/file-names", () => ({
  contentDisposition: (name: string) => `inline; filename=${name}`,
  safeFileName: (name: string) => name,
}));

import { updateEvent } from "./actions";

const eventId = "11111111-1111-4111-8111-111111111111";
const event = {
  id: eventId,
  orgId: "22222222-2222-4222-8222-222222222222",
  name: "Board to Death 2027",
  slug: "board-to-death-2027",
  type: EventType.CONFERENCE,
  websiteUrl: null,
  location: "Portland",
  timezone: "America/Los_Angeles",
  startsAt: new Date("2027-09-12T16:00:00.000Z"),
  endsAt: new Date("2027-09-14T01:00:00.000Z"),
  theme: null,
  exhibitorsEnabled: false,
  sponsorsEnabled: false,
  logoObjectKey: "events/event/logo-old",
  backgroundObjectKey: "events/event/background-old",
  archivedAt: null,
};

function eventForm(): FormData {
  const data = new FormData();
  data.set("name", event.name);
  data.set("slug", event.slug);
  data.set("type", event.type);
  data.set("websiteUrl", "");
  data.set("location", event.location);
  data.set("timezone", event.timezone);
  data.set("startsAt", "2027-09-12T09:00");
  data.set("endsAt", "2027-09-13T18:00");
  data.set("theme", "");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "admin" } });
  mocks.isAuthorizedAdminSession.mockReturnValue(true);
  mocks.eventGet.mockResolvedValue(event);
  mocks.eventUpdate.mockResolvedValue(event);
  mocks.roomList.mockResolvedValue([]);
  mocks.trackList.mockResolvedValue([]);
});

describe("updateEvent branding", () => {
  it("preserves stored branding when the form has no upload or remove intent", async () => {
    const result = await updateEvent(eventId, eventForm());

    expect(result.ok).toBe(true);
    const update = mocks.eventUpdate.mock.calls[0]?.[1];
    expect(update).not.toHaveProperty("logoObjectKey");
    expect(update).not.toHaveProperty("backgroundObjectKey");
  });

  it("stores a validated upload and updates only its branding key", async () => {
    const data = eventForm();
    data.set(
      "logoFile",
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "logo.png", { type: "image/png" }),
    );
    mocks.storagePut.mockResolvedValue({ ok: true, value: {} });

    const result = await updateEvent(eventId, data);

    expect(result.ok).toBe(true);
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/png", key: expect.stringContaining(`/branding/logo-`) }),
    );
    const update = mocks.eventUpdate.mock.calls[0]?.[1];
    expect(update.logoObjectKey).toContain("/branding/logo-");
    expect(update).not.toHaveProperty("backgroundObjectKey");
  });

  it("clears a stored key only for an explicit remove intent", async () => {
    const data = eventForm();
    data.set("removeBackground", "true");

    const result = await updateEvent(eventId, data);

    expect(result.ok).toBe(true);
    expect(mocks.eventUpdate.mock.calls[0]?.[1]).toMatchObject({ backgroundObjectKey: null });
    expect(mocks.eventUpdate.mock.calls[0]?.[1]).not.toHaveProperty("logoObjectKey");
  });
});
