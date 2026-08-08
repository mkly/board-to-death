import type {
  ClockService,
  EmailMessage,
  EmailService,
  InfrastructureFailure,
  InfrastructureResult,
} from "../infrastructure/index.ts";
import { normalizeInfrastructureFailure } from "../infrastructure/index.ts";

export type MessageRecipientDeliveryStatus = "queued" | "retry-scheduled" | "delivered" | "terminal-failure";
export type DeliveryAttemptStatus = "pending" | "delivered" | "failed";
export type DeliveryFailureClass = "retriable" | "terminal";

export interface MessageRecipientAudit {
  readonly id: string;
  readonly status: MessageRecipientDeliveryStatus;
  readonly nextAttemptAt?: string;
  readonly deliveredAt?: string;
  readonly terminalAt?: string;
}

export interface DeliveryAttemptAudit {
  readonly id: string;
  readonly recipientId: string;
  readonly attemptNumber: number;
  readonly provider: string;
  readonly status: DeliveryAttemptStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly providerMessageId?: string;
  readonly failureClass?: DeliveryFailureClass;
  readonly failureCode?: InfrastructureFailure["code"];
}

export type AttemptClaim =
  | { readonly claimed: true; readonly attempt: DeliveryAttemptAudit }
  | {
      readonly claimed: false;
      readonly reason: "not-found" | "in-flight" | "already-delivered" | "terminal-failure" | "not-ready";
      readonly nextAttemptAt?: string;
    };

export interface DeliveryAuditRepository {
  claimAttempt(recipientId: string, provider: string, startedAt: Date): Promise<AttemptClaim>;
  recordDelivered(attemptId: string, providerMessageId: string, completedAt: Date): Promise<void>;
  recordFailure(
    attemptId: string,
    failureClass: DeliveryFailureClass,
    failureCode: InfrastructureFailure["code"],
    completedAt: Date,
    nextAttemptAt?: Date,
  ): Promise<void>;
}

export type DeliveryResult =
  | { readonly status: "delivered"; readonly attempt: DeliveryAttemptAudit }
  | { readonly status: "retry-scheduled"; readonly attempt: DeliveryAttemptAudit; readonly nextAttemptAt: string }
  | { readonly status: "terminal-failure"; readonly attempt: DeliveryAttemptAudit }
  | {
      readonly status: "skipped";
      readonly reason: Exclude<AttemptClaim, { readonly claimed: true }>["reason"];
      readonly nextAttemptAt?: string;
    };

export interface EmailDeliveryCoordinatorOptions {
  readonly provider: EmailService;
  readonly providerName: string;
  readonly auditRepository: DeliveryAuditRepository;
  readonly clock: ClockService;
  readonly defaultRetryDelayMs?: number;
}

export interface DeliverEmailInput {
  readonly recipientId: string;
  readonly message: EmailMessage;
}

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new TypeError(`${field} is required.`);
  }
  return normalized;
}

function requireRetryDelay(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("defaultRetryDelayMs must be a non-negative finite number.");
  }
  return value;
}

export class EmailDeliveryCoordinator {
  readonly #provider: EmailService;
  readonly #providerName: string;
  readonly #auditRepository: DeliveryAuditRepository;
  readonly #clock: ClockService;
  readonly #defaultRetryDelayMs: number;

  constructor(options: EmailDeliveryCoordinatorOptions) {
    this.#provider = options.provider;
    this.#providerName = requireIdentifier(options.providerName, "providerName");
    this.#auditRepository = options.auditRepository;
    this.#clock = options.clock;
    this.#defaultRetryDelayMs = requireRetryDelay(options.defaultRetryDelayMs ?? 60_000);
  }

  async deliver(input: DeliverEmailInput): Promise<DeliveryResult> {
    const recipientId = requireIdentifier(input.recipientId, "recipientId");
    const claim = await this.#auditRepository.claimAttempt(recipientId, this.#providerName, this.#clock.now());
    if (!claim.claimed) {
      return {
        status: "skipped",
        reason: claim.reason,
        ...(claim.nextAttemptAt === undefined ? {} : { nextAttemptAt: claim.nextAttemptAt }),
      };
    }

    const providerResult = await this.#send(input.message);
    const completedAt = this.#clock.now();
    if (providerResult.ok) {
      await this.#auditRepository.recordDelivered(claim.attempt.id, providerResult.value.messageId, completedAt);
      return {
        status: "delivered",
        attempt: {
          ...claim.attempt,
          status: "delivered",
          completedAt: completedAt.toISOString(),
          providerMessageId: providerResult.value.messageId,
        },
      };
    }

    const failureClass = providerResult.error.retryable ? "retriable" : "terminal";
    const nextAttemptAt = providerResult.error.retryable
      ? new Date(completedAt.getTime() + (providerResult.error.retryAfterMs ?? this.#defaultRetryDelayMs))
      : undefined;
    await this.#auditRepository.recordFailure(
      claim.attempt.id,
      failureClass,
      providerResult.error.code,
      completedAt,
      nextAttemptAt,
    );

    const attempt: DeliveryAttemptAudit = {
      ...claim.attempt,
      status: "failed",
      completedAt: completedAt.toISOString(),
      failureClass,
      failureCode: providerResult.error.code,
    };
    if (nextAttemptAt) {
      return { status: "retry-scheduled", attempt, nextAttemptAt: nextAttemptAt.toISOString() };
    }
    return { status: "terminal-failure", attempt };
  }

  async #send(message: EmailMessage): Promise<InfrastructureResult<{ messageId: string; acceptedAt: string }>> {
    try {
      return await this.#provider.send(message);
    } catch (error) {
      return normalizeInfrastructureFailure("email", error);
    }
  }
}

export class InMemoryDeliveryAuditRepository implements DeliveryAuditRepository {
  readonly #recipients = new Map<string, MessageRecipientAudit>();
  readonly #attempts = new Map<string, DeliveryAttemptAudit>();
  readonly #attemptIdsByRecipient = new Map<string, string[]>();
  #attemptSequence = 0;

  constructor(recipientIds: readonly string[]) {
    for (const recipientId of recipientIds) {
      const id = requireIdentifier(recipientId, "recipientId");
      if (this.#recipients.has(id)) {
        throw new TypeError(`Duplicate recipientId: ${id}`);
      }
      this.#recipients.set(id, { id, status: "queued" });
      this.#attemptIdsByRecipient.set(id, []);
    }
  }

  getRecipient(recipientId: string): MessageRecipientAudit | undefined {
    const recipient = this.#recipients.get(recipientId);
    return recipient ? structuredClone(recipient) : undefined;
  }

  listAttempts(recipientId: string): readonly DeliveryAttemptAudit[] {
    return (this.#attemptIdsByRecipient.get(recipientId) ?? []).map((id) => structuredClone(this.#requireAttempt(id)));
  }

  async claimAttempt(recipientId: string, provider: string, startedAt: Date): Promise<AttemptClaim> {
    const recipient = this.#recipients.get(recipientId);
    if (!recipient) {
      return { claimed: false, reason: "not-found" };
    }
    if (recipient.status === "delivered") {
      return { claimed: false, reason: "already-delivered" };
    }
    if (recipient.status === "terminal-failure") {
      return { claimed: false, reason: "terminal-failure" };
    }

    const attempts = this.listAttempts(recipientId);
    if (attempts.some(({ status }) => status === "pending")) {
      return { claimed: false, reason: "in-flight" };
    }
    if (recipient.status === "retry-scheduled" && recipient.nextAttemptAt) {
      const nextAttemptAt = new Date(recipient.nextAttemptAt);
      if (nextAttemptAt > startedAt) {
        return { claimed: false, reason: "not-ready", nextAttemptAt: recipient.nextAttemptAt };
      }
    }

    this.#attemptSequence += 1;
    const attempt: DeliveryAttemptAudit = {
      id: `local-attempt-${String(this.#attemptSequence).padStart(4, "0")}`,
      recipientId,
      attemptNumber: attempts.length + 1,
      provider,
      status: "pending",
      startedAt: startedAt.toISOString(),
    };
    this.#attempts.set(attempt.id, attempt);
    this.#attemptIdsByRecipient.get(recipientId)?.push(attempt.id);
    return { claimed: true, attempt: structuredClone(attempt) };
  }

  async recordDelivered(attemptId: string, providerMessageId: string, completedAt: Date): Promise<void> {
    const attempt = this.#requirePendingAttempt(attemptId);
    this.#attempts.set(attemptId, {
      ...attempt,
      status: "delivered",
      completedAt: completedAt.toISOString(),
      providerMessageId: requireIdentifier(providerMessageId, "providerMessageId"),
    });
    this.#recipients.set(attempt.recipientId, {
      id: attempt.recipientId,
      status: "delivered",
      deliveredAt: completedAt.toISOString(),
      terminalAt: completedAt.toISOString(),
    });
  }

  async recordFailure(
    attemptId: string,
    failureClass: DeliveryFailureClass,
    failureCode: InfrastructureFailure["code"],
    completedAt: Date,
    nextAttemptAt?: Date,
  ): Promise<void> {
    const attempt = this.#requirePendingAttempt(attemptId);
    if ((failureClass === "retriable") !== (nextAttemptAt !== undefined)) {
      throw new TypeError("Retriable failures require nextAttemptAt and terminal failures forbid it.");
    }
    this.#attempts.set(attemptId, {
      ...attempt,
      status: "failed",
      completedAt: completedAt.toISOString(),
      failureClass,
      failureCode,
    });
    this.#recipients.set(
      attempt.recipientId,
      nextAttemptAt
        ? { id: attempt.recipientId, status: "retry-scheduled", nextAttemptAt: nextAttemptAt.toISOString() }
        : { id: attempt.recipientId, status: "terminal-failure", terminalAt: completedAt.toISOString() },
    );
  }

  #requireAttempt(attemptId: string): DeliveryAttemptAudit {
    const attempt = this.#attempts.get(attemptId);
    if (!attempt) {
      throw new TypeError(`Unknown delivery attempt: ${attemptId}`);
    }
    return attempt;
  }

  #requirePendingAttempt(attemptId: string): DeliveryAttemptAudit {
    const attempt = this.#requireAttempt(attemptId);
    if (attempt.status !== "pending") {
      throw new TypeError(`Delivery attempt is already complete: ${attemptId}`);
    }
    return attempt;
  }
}
