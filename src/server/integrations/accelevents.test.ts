import { describe, expect, test } from "vitest";

import type { AcceleventsConnection, AcceleventsSpeaker } from "./accelevents.ts";
import { DeterministicAcceleventsAdapter } from "./accelevents.ts";

const connection: AcceleventsConnection = { remoteEventId: "event-42", apiKey: "runtime-only-key" };

const speakers: readonly AcceleventsSpeaker[] = [
  { remoteId: "speaker-a", email: "a@example.test", firstName: "Ada", lastName: "Lovelace" },
  { remoteId: "speaker-b", email: "b@example.test", firstName: "Grace", lastName: "Hopper" },
  { remoteId: "speaker-c", email: "c@example.test", firstName: "Katherine", lastName: "Johnson" },
];

describe("Accelevents adapter contract", () => {
  test("checks credentials and supports deterministic cursor pagination and remote identifiers", async () => {
    const adapter = new DeterministicAcceleventsAdapter({
      remoteEventId: connection.remoteEventId,
      apiKey: connection.apiKey,
      accountId: "organizer-7",
      speakers,
      pageSize: 2,
    });

    await expect(adapter.checkCredentials(connection)).resolves.toEqual({
      ok: true,
      value: { accountId: "organizer-7", remoteEventId: "event-42" },
    });
    const firstPage = await adapter.listSpeakers(connection);
    expect(firstPage).toEqual({ ok: true, value: { items: speakers.slice(0, 2), nextCursor: "cursor-2" } });
    if (!firstPage.ok) throw new Error("Expected the first page to succeed.");
    await expect(
      adapter.listSpeakers(connection, { cursor: firstPage.value.nextCursor ?? undefined }),
    ).resolves.toEqual({
      ok: true,
      value: { items: speakers.slice(2), nextCursor: null },
    });

    const created = await adapter.createSpeaker(connection, {
      email: "new@example.test",
      firstName: "New",
      lastName: "Speaker",
    });
    expect(created).toEqual({
      ok: true,
      value: { remoteId: "speaker-0004", email: "new@example.test", firstName: "New", lastName: "Speaker" },
    });
    if (!created.ok) throw new Error("Expected speaker creation to succeed.");
    await expect(
      adapter.updateSpeaker(connection, created.value.remoteId, {
        email: "new@example.test",
        firstName: "Updated",
        lastName: "Speaker",
      }),
    ).resolves.toMatchObject({ ok: true, value: { remoteId: "speaker-0004", firstName: "Updated" } });
    await expect(adapter.getSpeaker(connection, created.value.remoteId)).resolves.toMatchObject({
      ok: true,
      value: { remoteId: "speaker-0004", firstName: "Updated" },
    });
  });

  test("creates, looks up, and updates sessions while validating remote speaker references", async () => {
    const adapter = new DeterministicAcceleventsAdapter({
      remoteEventId: connection.remoteEventId,
      apiKey: connection.apiKey,
      speakers,
    });

    await expect(
      adapter.createSession(connection, { title: "Unknown speaker", speakerRemoteIds: ["missing"] }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input", retryable: false } });
    const created = await adapter.createSession(connection, {
      title: "Typed integrations",
      description: "A contract-first walkthrough",
      speakerRemoteIds: ["speaker-a", "speaker-b"],
    });
    expect(created).toMatchObject({ ok: true, value: { remoteId: "session-0001" } });
    if (!created.ok) throw new Error("Expected session creation to succeed.");
    await expect(
      adapter.updateSession(connection, created.value.remoteId, {
        title: "Typed integrations, updated",
        speakerRemoteIds: ["speaker-c"],
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        remoteId: "session-0001",
        title: "Typed integrations, updated",
        description: "",
        speakerRemoteIds: ["speaker-c"],
      },
    });
    await expect(adapter.getSession(connection, created.value.remoteId)).resolves.toMatchObject({
      ok: true,
      value: { remoteId: "session-0001", speakerRemoteIds: ["speaker-c"] },
    });
  });

  test("normalizes authentication, validation, throttling, transient failure, and retry results", async () => {
    const adapter = new DeterministicAcceleventsAdapter({
      remoteEventId: connection.remoteEventId,
      apiKey: connection.apiKey,
      speakers,
    });

    await expect(adapter.checkCredentials({ ...connection, apiKey: "wrong" })).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized", retryable: false },
    });
    await expect(
      adapter.createSpeaker(connection, { email: "invalid", firstName: "", lastName: "" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input", retryable: false } });

    adapter.failNext("list-speakers", "rate-limited", 3_000);
    await expect(adapter.listSpeakers(connection)).resolves.toMatchObject({
      ok: false,
      error: { code: "rate-limited", retryable: true, retryAfterMs: 3_000 },
    });
    await expect(adapter.listSpeakers(connection)).resolves.toMatchObject({ ok: true });

    adapter.failNext("get-speaker", "unavailable");
    await expect(adapter.getSpeaker(connection, "speaker-a")).resolves.toMatchObject({
      ok: false,
      error: { code: "unavailable", retryable: true },
    });
    await expect(adapter.getSpeaker(connection, "speaker-a")).resolves.toMatchObject({
      ok: true,
      value: { remoteId: "speaker-a" },
    });
  });

  test("never retains credentials or provider exception details in request audit and results", async () => {
    const adapter = new DeterministicAcceleventsAdapter({
      remoteEventId: connection.remoteEventId,
      apiKey: connection.apiKey,
    });
    adapter.throwNext("list-sessions", new Error(`provider rejected ${connection.apiKey}`));

    const result = await adapter.listSessions(connection);
    expect(result).toMatchObject({ ok: false, error: { code: "unexpected", retryable: false } });
    const serialized = JSON.stringify({ result, requests: adapter.requests });
    expect(serialized).not.toContain(connection.apiKey);
    expect(serialized).not.toContain("provider rejected");
    expect(adapter.requests).toEqual([{ operation: "list-sessions", remoteEventId: "event-42" }]);
  });
});
