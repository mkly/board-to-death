import { describe, expect, it, vi } from "vitest";

import type { Event, Room, Track } from "@/generated/prisma/client";

import { EventAdminOperations, type EventAdminRepositories } from "./event-admin";
import { type AuthenticatedPrincipal, AuthorizationError, authorizeEventResource, type EventRole } from "./policy";
import { EventScopedAuthorizer } from "./scoped-operations";

const FIRST_EVENT_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_EVENT_ID = "00000000-0000-4000-8000-000000000002";
const PRINCIPAL_ID = "principal-1";

function principal(role: EventRole, eventId = FIRST_EVENT_ID): AuthenticatedPrincipal {
  return { id: PRINCIPAL_ID, memberships: [{ eventId, roles: [role] }] };
}

function event(id: string): Event {
  return {
    id,
    name: `Event ${id}`,
    slug: `event-${id.at(-1)}`,
    type: "CONFERENCE",
    websiteUrl: null,
    location: null,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-01-01T18:00:00.000Z"),
    endsAt: new Date("2027-01-02T02:00:00.000Z"),
    theme: null,
    exhibitorsEnabled: false,
    sponsorsEnabled: false,
    logoObjectKey: null,
    backgroundObjectKey: null,
    archivedAt: null,
    clonedFromEventId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function repositories(): EventAdminRepositories {
  const events = [event(FIRST_EVENT_ID), event(SECOND_EVENT_ID)];
  return {
    events: {
      list: vi.fn(async (ids: readonly string[]) => events.filter(({ id }) => ids.includes(id))),
      get: vi.fn(async (id: string) => events.find((candidate) => candidate.id === id) ?? null),
      update: vi.fn(async (id: string) => events.find((candidate) => candidate.id === id) as Event),
      delete: vi.fn(async () => undefined),
    },
    rooms: {
      list: vi.fn(async () => [] as Room[]),
      get: vi.fn(async () => null),
      create: vi.fn(async () => ({}) as Room),
      update: vi.fn(async () => ({}) as Room),
      delete: vi.fn(async () => undefined),
      reorder: vi.fn(async () => [] as Room[]),
    },
    tracks: {
      list: vi.fn(async () => [] as Track[]),
      get: vi.fn(async () => null),
      create: vi.fn(async () => ({}) as Track),
      update: vi.fn(async () => ({}) as Track),
      delete: vi.fn(async () => undefined),
      reorder: vi.fn(async () => [] as Track[]),
    },
  };
}

async function expectMaskedDenial(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code: "not-found",
    message: "The requested resource was not found.",
  });
}

describe("event role policy", () => {
  it("allows organizer admins to read and mutate event-program resources", () => {
    for (const action of ["read", "write"] as const) {
      expect(
        authorizeEventResource(principal("organizer-admin"), {
          eventId: FIRST_EVENT_ID,
          kind: "event-program",
          action,
        }),
      ).toMatchObject({ eventId: FIRST_EVENT_ID, principalId: PRINCIPAL_ID });
    }
  });

  it("limits reviewers to review work assigned to their authenticated identity", () => {
    const reviewer = principal("reviewer");
    expect(
      authorizeEventResource(reviewer, {
        eventId: FIRST_EVENT_ID,
        kind: "review",
        action: "write",
        assignedReviewerIds: [PRINCIPAL_ID],
      }),
    ).toBeDefined();
    expect(() =>
      authorizeEventResource(reviewer, {
        eventId: FIRST_EVENT_ID,
        kind: "review",
        action: "read",
        assignedReviewerIds: ["another-reviewer"],
      }),
    ).toThrow(AuthorizationError);
    expect(() =>
      authorizeEventResource(reviewer, { eventId: FIRST_EVENT_ID, kind: "event-program", action: "read" }),
    ).toThrow(AuthorizationError);
  });

  it.each(["applicant", "speaker"] as const)(
    "limits %s principals to their own profiles, submissions, sessions, files, and tasks",
    (role) => {
      const viewer = principal(role);
      for (const kind of ["profile", "submission", "session", "file", "task"] as const) {
        expect(
          authorizeEventResource(viewer, {
            eventId: FIRST_EVENT_ID,
            kind,
            action: "read",
            ownerPrincipalIds: [PRINCIPAL_ID],
          }),
        ).toBeDefined();
        expect(() =>
          authorizeEventResource(viewer, {
            eventId: FIRST_EVENT_ID,
            kind,
            action: "write",
            ownerPrincipalIds: ["another-principal"],
          }),
        ).toThrow(AuthorizationError);
      }
    },
  );
});

describe("event-scoped protected operations", () => {
  it("scopes admin lists to organizer memberships and rejects forged event identifiers before repository access", async () => {
    const data = repositories();
    const operations = new EventAdminOperations(data, async () => principal("organizer-admin"));

    await expect(operations.listEvents()).resolves.toEqual([event(FIRST_EVENT_ID)]);
    expect(data.events.list).toHaveBeenCalledWith([FIRST_EVENT_ID]);

    await expectMaskedDenial(operations.getEvent(SECOND_EVENT_ID));
    expect(data.events.get).not.toHaveBeenCalled();
    await expectMaskedDenial(operations.createRoom({ eventId: SECOND_EVENT_ID, name: "Forged" }));
    expect(data.rooms.create).not.toHaveBeenCalled();
  });

  it("authenticates each direct protected-operation invocation", async () => {
    const data = repositories();
    let currentPrincipal: AuthenticatedPrincipal | null = principal("organizer-admin");
    const operations = new EventAdminOperations(data, async () => currentPrincipal);

    await expect(operations.getEvent(FIRST_EVENT_ID)).resolves.toEqual(event(FIRST_EVENT_ID));
    currentPrincipal = null;
    await expect(operations.updateEvent(FIRST_EVENT_ID, { name: "Unauthorized" })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(data.events.update).not.toHaveBeenCalled();
  });

  it("guards every existing event, room, and track admin read and mutation", async () => {
    const data = repositories();
    const operations = new EventAdminOperations(data, async () => null);
    const directInvocations = [
      () => operations.listEvents(),
      () => operations.getEvent(FIRST_EVENT_ID),
      () => operations.updateEvent(FIRST_EVENT_ID, { name: "Changed" }),
      () => operations.deleteEvent(FIRST_EVENT_ID),
      () => operations.listRooms(FIRST_EVENT_ID),
      () => operations.getRoom(FIRST_EVENT_ID, "room-1"),
      () => operations.createRoom({ eventId: FIRST_EVENT_ID, name: "Room" }),
      () => operations.updateRoom(FIRST_EVENT_ID, "room-1", "Changed"),
      () => operations.deleteRoom(FIRST_EVENT_ID, "room-1"),
      () => operations.reorderRooms(FIRST_EVENT_ID, ["room-1"]),
      () => operations.listTracks(FIRST_EVENT_ID),
      () => operations.getTrack(FIRST_EVENT_ID, "track-1"),
      () => operations.createTrack({ eventId: FIRST_EVENT_ID, name: "Track", color: "blue" }),
      () => operations.updateTrack(FIRST_EVENT_ID, "track-1", { color: "green" }),
      () => operations.deleteTrack(FIRST_EVENT_ID, "track-1"),
      () => operations.reorderTracks(FIRST_EVENT_ID, ["track-1"]),
    ];

    for (const invoke of directInvocations) {
      await expect(invoke()).rejects.toMatchObject({ code: "unauthenticated" });
    }
    for (const repository of [data.events, data.rooms, data.tracks]) {
      for (const operation of Object.values(repository)) {
        expect(operation).not.toHaveBeenCalled();
      }
    }
  });

  it("uses the authorized event in trusted resource lookups for endpoint and action callers", async () => {
    const authorizer = new EventScopedAuthorizer(async () => principal("reviewer"));
    const loadResource = vi.fn(async (eventId: string, resourceId: string) => {
      if (eventId === FIRST_EVENT_ID && resourceId === "assigned-review") {
        return { eventId, assignedReviewerIds: [PRINCIPAL_ID] };
      }
      return null;
    });

    await expect(
      authorizer.requireResource(FIRST_EVENT_ID, "assigned-review", "review", "write", loadResource),
    ).resolves.toMatchObject({ eventId: FIRST_EVENT_ID, principalId: PRINCIPAL_ID });
    await expectMaskedDenial(
      authorizer.requireResource(SECOND_EVENT_ID, "assigned-review", "review", "read", loadResource),
    );
    expect(loadResource).toHaveBeenCalledTimes(1);
    await expectMaskedDenial(
      authorizer.requireResource(FIRST_EVENT_ID, "another-review", "review", "read", loadResource),
    );
  });
});
