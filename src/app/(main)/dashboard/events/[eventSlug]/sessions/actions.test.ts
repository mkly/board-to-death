import { beforeEach, describe, expect, it, vi } from "vitest";

import { type CustomFieldDefinition, CustomFieldEntityType, CustomFieldType } from "@/generated/prisma/client";
import { customFieldFormPrefix } from "@/lib/custom-fields";

const mocks = vi.hoisted(() => ({
  createManual: vi.fn(),
  findEvent: vi.fn(),
  getSession: vi.fn(),
  isAllowedAdminEmail: vi.fn(),
  listDefinitions: vi.fn(),
  listValues: vi.fn(),
  setValue: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/config/runtime-env.server", () => ({
  getRuntimeConfig: () => ({ server: { FILE_STORAGE_PATH: "/tmp/board-to-death-tests" } }),
}));
vi.mock("@/server/auth/admin-access", () => ({ isAllowedAdminEmail: mocks.isAllowedAdminEmail }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/server/custom-fields/repositories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/custom-fields/repositories")>();
  return {
    ...actual,
    CustomFieldRepository: class {
      readonly listDefinitions = mocks.listDefinitions;
      readonly listValues = mocks.listValues;
      readonly setValue = mocks.setValue;
    },
  };
});
vi.mock("@/server/database/client", () => ({
  getDatabaseClient: () => ({ event: { findFirst: mocks.findEvent } }),
}));
vi.mock("@/server/infrastructure", () => ({
  contentDisposition: vi.fn(),
  createFileStorage: vi.fn(),
  safeFileName: (name: string) => name,
}));
vi.mock("@/server/sessions/repositories", () => ({
  ProgramSessionRepository: class {
    readonly createManual = mocks.createManual;
    readonly update = mocks.update;
  },
}));

import { saveProgramSession } from "./actions";

const eventId = "11111111-1111-4111-8111-111111111111";

function definition(type: CustomFieldType, overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    eventId,
    entityType: CustomFieldEntityType.PROGRAM_SESSION,
    key: "session_detail",
    label: "Session detail",
    description: null,
    type,
    required: true,
    characterLimit: null,
    options: type === CustomFieldType.SINGLE_SELECT ? ["Talk", "Workshop"] : null,
    position: 0,
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
    updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    ...overrides,
  };
}

function sessionForm(): FormData {
  const formData = new FormData();
  formData.set("eventSlug", "event-one");
  formData.set("sessionId", "");
  formData.set("title", "Atomic custom fields");
  formData.set("description", "");
  formData.set("durationMinutes", "45");
  formData.set("trackId", "unassigned");
  formData.set("parentSessionId", "standalone");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { email: "admin@example.test" } });
  mocks.isAllowedAdminEmail.mockReturnValue(true);
  mocks.findEvent.mockResolvedValue({ id: eventId, slug: "event-one" });
  mocks.listValues.mockResolvedValue([]);
});

describe("saveProgramSession custom field validation", () => {
  it("rejects a missing required file before creating a session or custom field value", async () => {
    mocks.listDefinitions.mockResolvedValue([
      definition(CustomFieldType.FILE, { label: "Slide deck", key: "slide_deck" }),
    ]);

    const result = await saveProgramSession({ status: "idle" }, sessionForm());

    expect(result).toEqual({ status: "error", message: "Slide deck is required." });
    expect(mocks.createManual).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.setValue).not.toHaveBeenCalled();
  });

  it("rejects an unset required single select before creating a session or custom field value", async () => {
    const select = definition(CustomFieldType.SINGLE_SELECT, { label: "Session format", key: "session_format" });
    mocks.listDefinitions.mockResolvedValue([select]);
    const formData = sessionForm();
    formData.set(`${customFieldFormPrefix}${select.id}`, "__empty__");

    const result = await saveProgramSession({ status: "idle" }, formData);

    expect(result).toEqual({ status: "error", message: "Session format is required." });
    expect(mocks.createManual).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.setValue).not.toHaveBeenCalled();
  });
});
