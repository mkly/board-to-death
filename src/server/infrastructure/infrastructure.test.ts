import { composeInfrastructure, createDeterministicInfrastructure, defineAcceleventsOperation } from "./index.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("deterministic infrastructure composition", () => {
  test("injects typed fakes without reading production credentials", async () => {
    const repositories = { events: new Map<string, { name: string }>() };
    const infrastructure = createDeterministicInfrastructure({
      repositories,
      now: "2026-05-02T12:30:00.000Z",
      tokenSeed: "contract-test",
    });
    const composed = composeInfrastructure(infrastructure);

    const transaction = await composed.persistence.transaction((availableRepositories) => {
      availableRepositories.events.set("event-1", { name: "Board to Death" });
      return availableRepositories.events.get("event-1");
    });
    const firstToken = composed.tokenGenerator.generate({ purpose: "cfp-resume" });
    const secondToken = composed.tokenGenerator.generate({ purpose: "cfp-resume" });

    assert.deepEqual(transaction, { ok: true, value: { name: "Board to Death" } });
    assert.equal(infrastructure.persistence.transactionCount, 1);
    assert.equal(composed.clock.now().toISOString(), "2026-05-02T12:30:00.000Z");
    assert.deepEqual(firstToken, { ok: true, value: "fake-cfp-resume-contract-test-0001" });
    assert.deepEqual(secondToken, { ok: true, value: "fake-cfp-resume-contract-test-0002" });
  });
});

describe("service result contracts", () => {
  test("return deterministic email and storage successes and typed expected failures", async () => {
    const infrastructure = createDeterministicInfrastructure({ repositories: {} });
    const delivery = await infrastructure.email.send({
      to: [{ address: "speaker@example.test", name: "Speaker" }],
      subject: "Your session",
      text: "Your session is ready.",
    });
    const invalidEmail = await infrastructure.email.send({ to: [], subject: "Missing recipient", text: "Body" });
    const bytes = Uint8Array.from([1, 2, 3]);
    const stored = await infrastructure.fileStorage.put({
      key: "speaker/slides.pdf",
      bytes,
      contentType: "application/pdf",
    });
    bytes[0] = 9;
    const fetched = await infrastructure.fileStorage.get("speaker/slides.pdf");
    const missing = await infrastructure.fileStorage.get("speaker/missing.pdf");

    assert.deepEqual(delivery, {
      ok: true,
      value: { messageId: "fake-email-0001", acceptedAt: "2026-01-01T00:00:00.000Z" },
    });
    assert.equal(infrastructure.email.sentMessages.length, 1);
    assert.equal(invalidEmail.ok, false);
    if (!invalidEmail.ok) {
      assert.equal(invalidEmail.error.code, "invalid-input");
      assert.equal(invalidEmail.error.retryable, false);
    }
    assert.equal(stored.ok, true);
    assert.equal(fetched.ok, true);
    if (fetched.ok) {
      assert.deepEqual(fetched.value.bytes, Uint8Array.from([1, 2, 3]));
    }
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.code, "not-found");
    }
  });

  test("normalizes provider exceptions and never exposes their secret-bearing messages", async () => {
    const infrastructure = createDeterministicInfrastructure({ repositories: {} });
    const lookupSpeaker = defineAcceleventsOperation<{ email: string }, { remoteId: string }>("lookup-speaker");
    const secret = "accelevents-api-key-do-not-leak";

    infrastructure.accelevents.register(lookupSpeaker, () => {
      throw new Error(`Provider rejected ${secret}`);
    });

    const result = await infrastructure.accelevents.execute(lookupSpeaker, { email: "speaker@example.test" });
    const serialized = JSON.stringify(result);

    assert.deepEqual(result, {
      ok: false,
      error: {
        service: "accelevents",
        code: "unexpected",
        message: "The service request failed unexpectedly.",
        retryable: false,
      },
    });
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("speaker@example.test"), false);
  });

  test("preserves safe retry guidance without retaining the originating error", async () => {
    const infrastructure = createDeterministicInfrastructure({ repositories: {} });
    infrastructure.email.failNext("rate-limited", 2_500);

    const result = await infrastructure.email.send({
      to: [{ address: "speaker@example.test" }],
      subject: "Retry later",
      text: "Queued message",
    });

    assert.deepEqual(result, {
      ok: false,
      error: {
        service: "email",
        code: "rate-limited",
        message: "The service rate limit was reached.",
        retryable: true,
        retryAfterMs: 2_500,
      },
    });
    assert.equal(infrastructure.email.sentMessages.length, 0);
  });
});
