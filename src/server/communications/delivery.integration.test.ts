import { describe, test } from "vitest";

import { createDeterministicInfrastructure } from "../infrastructure/index.ts";
import { EmailDeliveryCoordinator, InMemoryDeliveryAuditRepository } from "./delivery.ts";
import assert from "node:assert/strict";

const message = {
  to: [{ address: "speaker@example.test", name: "Speaker" }],
  subject: "Your session",
  text: "Your session is ready.",
  idempotencyKey: "session-confirmation:speaker-1",
} as const;

function createDeliveryHarness(recipientIds: readonly string[] = ["recipient-1"]) {
  const infrastructure = createDeterministicInfrastructure({
    repositories: {},
    now: "2027-02-01T17:00:00.000Z",
  });
  const auditRepository = new InMemoryDeliveryAuditRepository(recipientIds);
  const coordinator = new EmailDeliveryCoordinator({
    provider: infrastructure.email,
    providerName: "local",
    auditRepository,
    clock: infrastructure.clock,
  });
  return { infrastructure, auditRepository, coordinator };
}

describe("email delivery coordination", () => {
  test("audits queued and delivered states and does not redeliver an idempotently completed recipient", async () => {
    const { infrastructure, auditRepository, coordinator } = createDeliveryHarness();

    assert.deepEqual(auditRepository.getRecipient("recipient-1"), { id: "recipient-1", status: "queued" });
    const delivered = await coordinator.deliver({ recipientId: "recipient-1", message });
    const duplicate = await coordinator.deliver({ recipientId: "recipient-1", message });

    assert.equal(delivered.status, "delivered");
    assert.deepEqual(duplicate, { status: "skipped", reason: "already-delivered" });
    assert.equal(infrastructure.email.sentMessages.length, 1);
    assert.deepEqual(auditRepository.getRecipient("recipient-1"), {
      id: "recipient-1",
      status: "delivered",
      deliveredAt: "2027-02-01T17:00:00.000Z",
      terminalAt: "2027-02-01T17:00:00.000Z",
    });
    assert.deepEqual(auditRepository.listAttempts("recipient-1"), [
      {
        id: "local-attempt-0001",
        recipientId: "recipient-1",
        attemptNumber: 1,
        provider: "local",
        status: "delivered",
        startedAt: "2027-02-01T17:00:00.000Z",
        completedAt: "2027-02-01T17:00:00.000Z",
        providerMessageId: "fake-email-0001",
      },
    ]);
  });

  test("classifies retryable failures, defers early attempts, and records a later delivery", async () => {
    const { infrastructure, auditRepository, coordinator } = createDeliveryHarness();
    infrastructure.email.failNext("rate-limited", 2_500);

    const failed = await coordinator.deliver({ recipientId: "recipient-1", message });
    infrastructure.clock.advanceBy(2_000);
    const early = await coordinator.deliver({ recipientId: "recipient-1", message });
    infrastructure.clock.advanceBy(500);
    const delivered = await coordinator.deliver({ recipientId: "recipient-1", message });

    assert.equal(failed.status, "retry-scheduled");
    assert.deepEqual(early, {
      status: "skipped",
      reason: "not-ready",
      nextAttemptAt: "2027-02-01T17:00:02.500Z",
    });
    assert.equal(delivered.status, "delivered");
    assert.equal(infrastructure.email.sentMessages.length, 1);
    assert.deepEqual(
      auditRepository.listAttempts("recipient-1").map(({ attemptNumber, status, failureClass, failureCode }) => ({
        attemptNumber,
        status,
        failureClass,
        failureCode,
      })),
      [
        { attemptNumber: 1, status: "failed", failureClass: "retriable", failureCode: "rate-limited" },
        { attemptNumber: 2, status: "delivered", failureClass: undefined, failureCode: undefined },
      ],
    );
  });

  test("records terminal failures without provider credentials, message contents, or raw exceptions", async () => {
    const secret = "provider-token-do-not-store";
    const { infrastructure, auditRepository, coordinator } = createDeliveryHarness(["invalid", "exception"]);
    infrastructure.email.failNext("unauthorized");

    const unauthorized = await coordinator.deliver({ recipientId: "invalid", message });
    infrastructure.email.throwNext(new Error(`Rejected ${secret}`));
    const exception = await coordinator.deliver({ recipientId: "exception", message });
    const serializedAudit = JSON.stringify({
      recipients: [auditRepository.getRecipient("invalid"), auditRepository.getRecipient("exception")],
      attempts: [...auditRepository.listAttempts("invalid"), ...auditRepository.listAttempts("exception")],
    });

    assert.equal(unauthorized.status, "terminal-failure");
    assert.equal(exception.status, "terminal-failure");
    assert.deepEqual(
      auditRepository.listAttempts("invalid").map(({ failureClass, failureCode }) => ({ failureClass, failureCode })),
      [{ failureClass: "terminal", failureCode: "unauthorized" }],
    );
    assert.deepEqual(
      auditRepository.listAttempts("exception").map(({ failureClass, failureCode }) => ({ failureClass, failureCode })),
      [{ failureClass: "terminal", failureCode: "unexpected" }],
    );
    assert.equal(serializedAudit.includes(secret), false);
    assert.equal(serializedAudit.includes("speaker@example.test"), false);
    assert.equal(serializedAudit.includes(message.text), false);
  });

  test("claims only one provider attempt while an asynchronous send is in flight", async () => {
    const { infrastructure, auditRepository } = createDeliveryHarness();
    let releaseProvider: (() => void) | undefined;
    const provider = {
      send: async () => {
        await new Promise<void>((resolve) => {
          releaseProvider = resolve;
        });
        return {
          ok: true as const,
          value: { messageId: "async-message", acceptedAt: infrastructure.clock.now().toISOString() },
        };
      },
    };
    const coordinator = new EmailDeliveryCoordinator({
      provider,
      providerName: "async-local",
      auditRepository,
      clock: infrastructure.clock,
    });

    const first = coordinator.deliver({ recipientId: "recipient-1", message });
    const concurrent = await coordinator.deliver({ recipientId: "recipient-1", message });
    releaseProvider?.();

    assert.deepEqual(concurrent, { status: "skipped", reason: "in-flight" });
    assert.equal((await first).status, "delivered");
    assert.equal(auditRepository.listAttempts("recipient-1").length, 1);
  });
});
