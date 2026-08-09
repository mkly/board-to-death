import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { AttemptClaim, DeliveryAttemptAudit, DeliveryAuditRepository, DeliveryFailureClass } from "./delivery.ts";

function attemptAudit(attempt: {
  id: string;
  recipientId: string;
  attemptNumber: number;
  provider: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  startedAt: Date;
  completedAt: Date | null;
  providerMessageId: string | null;
  failureClass: "TRANSIENT" | "PERMANENT" | null;
  failureCode: string | null;
}): DeliveryAttemptAudit {
  let status: DeliveryAttemptAudit["status"] = "failed";
  if (attempt.status === "PENDING") status = "pending";
  if (attempt.status === "SUCCEEDED") status = "delivered";
  return {
    id: attempt.id,
    recipientId: attempt.recipientId,
    attemptNumber: attempt.attemptNumber,
    provider: attempt.provider,
    status,
    startedAt: attempt.startedAt.toISOString(),
    ...(attempt.completedAt ? { completedAt: attempt.completedAt.toISOString() } : {}),
    ...(attempt.providerMessageId ? { providerMessageId: attempt.providerMessageId } : {}),
    ...(attempt.failureClass ? { failureClass: attempt.failureClass === "TRANSIENT" ? "retriable" : "terminal" } : {}),
    ...(attempt.failureCode ? { failureCode: attempt.failureCode as DeliveryAttemptAudit["failureCode"] } : {}),
  };
}

export class PrismaDeliveryAuditRepository implements DeliveryAuditRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async claimAttempt(recipientId: string, provider: string, startedAt: Date): Promise<AttemptClaim> {
    return this.#client.$transaction(async (transaction) => {
      const recipients = await transaction.$queryRaw<
        Array<{ id: string; status: "QUEUED" | "RETRY_SCHEDULED" | "DELIVERED" | "FAILED"; nextAttemptAt: Date | null }>
      >(Prisma.sql`
        SELECT "id", "status", "nextAttemptAt"
        FROM "message_recipients"
        WHERE "id" = ${recipientId}::uuid
        FOR UPDATE
      `);
      const recipient = recipients[0];
      if (!recipient) return { claimed: false, reason: "not-found" };
      if (recipient.status === "DELIVERED") return { claimed: false, reason: "already-delivered" };
      if (recipient.status === "FAILED") return { claimed: false, reason: "terminal-failure" };
      if (recipient.status === "RETRY_SCHEDULED" && recipient.nextAttemptAt && recipient.nextAttemptAt > startedAt) {
        return { claimed: false, reason: "not-ready", nextAttemptAt: recipient.nextAttemptAt.toISOString() };
      }

      const attempts = await transaction.deliveryAttempt.findMany({
        where: { recipientId },
        orderBy: { attemptNumber: "desc" },
      });
      if (attempts.some(({ status }) => status === "PENDING")) {
        return { claimed: false, reason: "in-flight" };
      }

      const attempt = await transaction.deliveryAttempt.create({
        data: {
          recipientId,
          attemptNumber: (attempts[0]?.attemptNumber ?? 0) + 1,
          provider,
          startedAt,
        },
      });
      return { claimed: true, attempt: attemptAudit(attempt) };
    });
  }

  async recordDelivered(attemptId: string, providerMessageId: string, completedAt: Date): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      const attempt = await transaction.deliveryAttempt.update({
        where: { id: attemptId, status: "PENDING" },
        data: { status: "SUCCEEDED", providerMessageId, completedAt },
        select: { recipientId: true },
      });
      await transaction.messageRecipient.update({
        where: { id: attempt.recipientId },
        data: { status: "DELIVERED", deliveredAt: completedAt, terminalAt: completedAt, nextAttemptAt: null },
      });
    });
  }

  async recordFailure(
    attemptId: string,
    failureClass: DeliveryFailureClass,
    failureCode: DeliveryAttemptAudit["failureCode"],
    completedAt: Date,
    nextAttemptAt?: Date,
  ): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      const attempt = await transaction.deliveryAttempt.update({
        where: { id: attemptId, status: "PENDING" },
        data: {
          status: "FAILED",
          failureClass: failureClass === "retriable" ? "TRANSIENT" : "PERMANENT",
          failureCode,
          completedAt,
        },
        select: { recipientId: true },
      });
      await transaction.messageRecipient.update({
        where: { id: attempt.recipientId },
        data: nextAttemptAt
          ? { status: "RETRY_SCHEDULED", nextAttemptAt }
          : { status: "FAILED", terminalAt: completedAt, nextAttemptAt: null },
      });
    });
  }
}
