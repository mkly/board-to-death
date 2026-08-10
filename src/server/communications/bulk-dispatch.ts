import {
  type Prisma,
  type PrismaClient,
  DeliveryAttemptStatus as StoredAttemptStatus,
  DeliveryFailureClass as StoredFailureClass,
  MessageRecipientStatus as StoredRecipientStatus,
} from "../../generated/prisma/client.ts";
import { renderEmailTemplate } from "../../lib/communications/email-templates.ts";
import { RepositoryError } from "../events/repositories.ts";
import { createProductionInfrastructure } from "../infrastructure/composition.ts";
import type { ClockService, EmailService, InfrastructureFailure } from "../infrastructure/index.ts";
import { RecipientAudienceRepository, type RecipientAudienceSelection } from "./audiences.ts";
import {
  type AttemptClaim,
  type DeliveryAttemptAudit,
  type DeliveryAuditRepository,
  type DeliveryFailureClass,
  type DeliveryResult,
  EmailDeliveryCoordinator,
} from "./delivery.ts";

export interface ConfirmBulkDeliveryInput {
  readonly eventId: string;
  readonly templateId: string;
  readonly idempotencyKey: string;
  readonly audience: RecipientAudienceSelection;
}

export interface BulkDeliveryRecipient {
  readonly id: string;
  readonly speakerId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly subjectSnapshot: string;
  readonly htmlSnapshot: string;
  readonly textSnapshot: string | null;
  readonly status: "queued" | "retry-scheduled" | "delivered" | "failed";
  readonly nextAttemptAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly terminalAt: Date | null;
  readonly attempts: readonly DeliveryAttemptAudit[];
}

export interface BulkDelivery {
  readonly id: string;
  readonly eventId: string;
  readonly templateId: string;
  readonly templateName: string;
  readonly templateVersion: number;
  readonly idempotencyKey: string;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly recipients: readonly BulkDeliveryRecipient[];
}

export interface ConfirmedBulkDelivery {
  readonly delivery: BulkDelivery;
  readonly duplicate: boolean;
}

const deliveryInclude = {
  templateVersion: { include: { template: true } },
  recipients: {
    orderBy: [{ displayName: "asc" }, { email: "asc" }],
    include: { attempts: { orderBy: { attemptNumber: "asc" } } },
  },
} as const satisfies Prisma.MessageDeliveryInclude;

type StoredDelivery = Prisma.MessageDeliveryGetPayload<{ include: typeof deliveryInclude }>;

function required(value: string, field: string, maximum = 200): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > maximum) {
    throw new RepositoryError("invalid-input", `${field} must contain between 1 and ${maximum.toString()} characters.`);
  }
  return normalized;
}

function recipientStatus(status: StoredRecipientStatus): BulkDeliveryRecipient["status"] {
  if (status === StoredRecipientStatus.RETRY_SCHEDULED) return "retry-scheduled";
  if (status === StoredRecipientStatus.DELIVERED) return "delivered";
  if (status === StoredRecipientStatus.FAILED) return "failed";
  return "queued";
}

function failureClass(value: StoredFailureClass | null): DeliveryFailureClass | undefined {
  if (value === StoredFailureClass.TRANSIENT) return "retriable";
  if (value === StoredFailureClass.PERMANENT) return "terminal";
  return undefined;
}

function attemptStatus(status: StoredAttemptStatus): DeliveryAttemptAudit["status"] {
  if (status === StoredAttemptStatus.SUCCEEDED) return "delivered";
  if (status === StoredAttemptStatus.FAILED) return "failed";
  return "pending";
}

function fromAttempt(attempt: StoredDelivery["recipients"][number]["attempts"][number]): DeliveryAttemptAudit {
  const storedFailureClass = failureClass(attempt.failureClass);
  return {
    id: attempt.id,
    recipientId: attempt.recipientId,
    attemptNumber: attempt.attemptNumber,
    provider: attempt.provider,
    status: attemptStatus(attempt.status),
    startedAt: attempt.startedAt.toISOString(),
    ...(attempt.completedAt ? { completedAt: attempt.completedAt.toISOString() } : {}),
    ...(attempt.providerMessageId ? { providerMessageId: attempt.providerMessageId } : {}),
    ...(storedFailureClass ? { failureClass: storedFailureClass } : {}),
    ...(attempt.failureCode ? { failureCode: attempt.failureCode as InfrastructureFailure["code"] } : {}),
  };
}

function fromStored(delivery: StoredDelivery): BulkDelivery {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    templateId: delivery.templateVersion.templateId,
    templateName: delivery.templateVersion.template.name,
    templateVersion: delivery.templateVersion.version,
    idempotencyKey: delivery.idempotencyKey,
    cancelledAt: delivery.cancelledAt,
    createdAt: delivery.createdAt,
    recipients: delivery.recipients.map((recipient) => ({
      id: recipient.id,
      speakerId: recipient.recipientKey.replace(/^speaker:/, ""),
      email: recipient.email,
      displayName: recipient.displayName,
      subjectSnapshot: recipient.subjectSnapshot,
      htmlSnapshot: recipient.htmlSnapshot,
      textSnapshot: recipient.textSnapshot,
      status: recipientStatus(recipient.status),
      nextAttemptAt: recipient.nextAttemptAt,
      deliveredAt: recipient.deliveredAt,
      terminalAt: recipient.terminalAt,
      attempts: recipient.attempts.map(fromAttempt),
    })),
  };
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002";
}

export class BulkCommunicationRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async confirm(input: ConfirmBulkDeliveryInput): Promise<ConfirmedBulkDelivery> {
    const eventId = required(input.eventId, "eventId");
    const templateId = required(input.templateId, "templateId");
    const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
    const existing = await this.#client.messageDelivery.findUnique({
      where: { eventId_idempotencyKey: { eventId, idempotencyKey } },
      include: deliveryInclude,
    });
    if (existing) return { delivery: fromStored(existing), duplicate: true };

    const [event, template, audience] = await Promise.all([
      this.#client.event.findUnique({
        where: { id: eventId },
        select: { id: true, name: true, startsAt: true, timezone: true, location: true },
      }),
      this.#client.communicationTemplate.findFirst({
        where: { id: templateId, eventId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      }),
      new RecipientAudienceRepository(this.#client).preview(eventId, input.audience),
    ]);
    if (!event) throw new RepositoryError("not-found", "The event was not found.");
    const templateVersion = template?.versions[0];
    if (!template || !templateVersion) {
      throw new RepositoryError("not-found", "The event-owned email template was not found.");
    }
    if (audience.recipients.length === 0) {
      throw new RepositoryError("invalid-input", "The selected audience has no eligible recipients.");
    }

    const eventStartDate = new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeZone: event.timezone,
    }).format(event.startsAt);
    const recipients = audience.recipients.map((recipient) => {
      const rendered = renderEmailTemplate(
        {
          key: template.key,
          name: template.name,
          subjectTemplate: templateVersion.subjectTemplate,
          bodyTemplate: templateVersion.htmlTemplate,
          textTemplate: templateVersion.textTemplate,
        },
        {
          "event.name": event.name,
          "event.start_date": eventStartDate,
          "event.location": event.location,
          "recipient.name": recipient.displayName,
          "recipient.email": recipient.email,
          "speaker.name": recipient.displayName,
        },
      );
      if (!rendered.ok) {
        throw new RepositoryError(
          "invalid-input",
          `The template cannot be rendered for ${recipient.displayName}: ${rendered.issues.map(({ message }) => message).join(" ")}`,
        );
      }
      return {
        recipientKey: `speaker:${recipient.speakerId}`,
        email: recipient.email,
        displayName: recipient.displayName,
        subjectSnapshot: rendered.rendered.subject,
        htmlSnapshot: rendered.rendered.html,
        textSnapshot: rendered.rendered.text ?? rendered.rendered.previewMarkdown,
      };
    });

    try {
      const created = await this.#client.messageDelivery.create({
        data: {
          eventId,
          templateVersionId: templateVersion.id,
          idempotencyKey,
          recipients: { create: recipients },
        },
        include: deliveryInclude,
      });
      return { delivery: fromStored(created), duplicate: false };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const duplicate = await this.#client.messageDelivery.findUnique({
        where: { eventId_idempotencyKey: { eventId, idempotencyKey } },
        include: deliveryInclude,
      });
      if (!duplicate) throw error;
      return { delivery: fromStored(duplicate), duplicate: true };
    }
  }

  async get(eventId: string, deliveryId: string): Promise<BulkDelivery | null> {
    const delivery = await this.#client.messageDelivery.findFirst({
      where: { id: deliveryId, eventId },
      include: deliveryInclude,
    });
    return delivery ? fromStored(delivery) : null;
  }

  async cancel(eventId: string, deliveryId: string, cancelledAt = new Date()): Promise<BulkDelivery> {
    const result = await this.#client.messageDelivery.updateMany({
      where: { id: deliveryId, eventId, cancelledAt: null },
      data: { cancelledAt },
    });
    const delivery = await this.get(eventId, deliveryId);
    if (!delivery) throw new RepositoryError("not-found", "The event-owned delivery was not found.");
    if (result.count === 0 && !delivery.cancelledAt) {
      throw new RepositoryError("conflict", "The delivery could not be cancelled.");
    }
    return delivery;
  }
}

export class PrismaBulkDeliveryAuditRepository implements DeliveryAuditRepository {
  readonly #client: PrismaClient;
  readonly #eventId: string;

  constructor(client: PrismaClient, eventId: string) {
    this.#client = client;
    this.#eventId = eventId;
  }

  async claimAttempt(recipientId: string, provider: string, startedAt: Date): Promise<AttemptClaim> {
    const recipient = await this.#client.messageRecipient.findFirst({
      where: { id: recipientId, delivery: { eventId: this.#eventId } },
      include: { delivery: { select: { cancelledAt: true } }, attempts: { orderBy: { attemptNumber: "desc" } } },
    });
    if (!recipient) return { claimed: false, reason: "not-found" };
    if (recipient.delivery.cancelledAt) return { claimed: false, reason: "cancelled" };
    if (recipient.status === StoredRecipientStatus.DELIVERED) return { claimed: false, reason: "already-delivered" };
    if (recipient.status === StoredRecipientStatus.FAILED) return { claimed: false, reason: "terminal-failure" };
    if (recipient.attempts.some(({ status }) => status === StoredAttemptStatus.PENDING)) {
      return { claimed: false, reason: "in-flight" };
    }
    if (recipient.status === StoredRecipientStatus.RETRY_SCHEDULED && recipient.nextAttemptAt) {
      if (recipient.nextAttemptAt > startedAt) {
        return { claimed: false, reason: "not-ready", nextAttemptAt: recipient.nextAttemptAt.toISOString() };
      }
    }

    try {
      const attempt = await this.#client.deliveryAttempt.create({
        data: {
          recipientId,
          attemptNumber: (recipient.attempts[0]?.attemptNumber ?? 0) + 1,
          provider: required(provider, "provider"),
          startedAt,
        },
      });
      return {
        claimed: true,
        attempt: {
          id: attempt.id,
          recipientId,
          attemptNumber: attempt.attemptNumber,
          provider: attempt.provider,
          status: "pending",
          startedAt: attempt.startedAt.toISOString(),
        },
      };
    } catch (error) {
      if (isUniqueConflict(error)) return { claimed: false, reason: "in-flight" };
      throw error;
    }
  }

  async recordDelivered(attemptId: string, providerMessageId: string, completedAt: Date): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      const attempt = await transaction.deliveryAttempt.findFirst({
        where: {
          id: attemptId,
          status: StoredAttemptStatus.PENDING,
          recipient: { delivery: { eventId: this.#eventId } },
        },
        select: { id: true, recipientId: true },
      });
      if (!attempt) throw new RepositoryError("conflict", "The delivery attempt is no longer pending.");
      await transaction.deliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: StoredAttemptStatus.SUCCEEDED,
          providerMessageId: required(providerMessageId, "providerMessageId"),
          completedAt,
        },
      });
      await transaction.messageRecipient.update({
        where: { id: attempt.recipientId },
        data: {
          status: StoredRecipientStatus.DELIVERED,
          nextAttemptAt: null,
          deliveredAt: completedAt,
          terminalAt: completedAt,
        },
      });
    });
  }

  async recordFailure(
    attemptId: string,
    storedClass: DeliveryFailureClass,
    failureCode: InfrastructureFailure["code"],
    completedAt: Date,
    nextAttemptAt?: Date,
  ): Promise<void> {
    if ((storedClass === "retriable") !== (nextAttemptAt !== undefined)) {
      throw new RepositoryError("invalid-input", "Retriable failures require a next attempt time.");
    }
    await this.#client.$transaction(async (transaction) => {
      const attempt = await transaction.deliveryAttempt.findFirst({
        where: {
          id: attemptId,
          status: StoredAttemptStatus.PENDING,
          recipient: { delivery: { eventId: this.#eventId } },
        },
        select: { id: true, recipientId: true },
      });
      if (!attempt) throw new RepositoryError("conflict", "The delivery attempt is no longer pending.");
      await transaction.deliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: StoredAttemptStatus.FAILED,
          failureClass: storedClass === "retriable" ? StoredFailureClass.TRANSIENT : StoredFailureClass.PERMANENT,
          failureCode,
          completedAt,
        },
      });
      await transaction.messageRecipient.update({
        where: { id: attempt.recipientId },
        data:
          storedClass === "retriable"
            ? { status: StoredRecipientStatus.RETRY_SCHEDULED, nextAttemptAt }
            : {
                status: StoredRecipientStatus.FAILED,
                nextAttemptAt: null,
                deliveredAt: null,
                terminalAt: completedAt,
              },
      });
    });
  }
}

export interface BulkDeliveryDispatcherOptions {
  readonly client: PrismaClient;
  readonly provider: EmailService;
  readonly providerName: string;
  readonly clock: ClockService;
  readonly defaultRetryDelayMs?: number;
}

export class BulkDeliveryDispatcher {
  readonly #client: PrismaClient;
  readonly #provider: EmailService;
  readonly #providerName: string;
  readonly #clock: ClockService;
  readonly #defaultRetryDelayMs?: number;

  constructor(options: BulkDeliveryDispatcherOptions) {
    this.#client = options.client;
    this.#provider = options.provider;
    this.#providerName = options.providerName;
    this.#clock = options.clock;
    this.#defaultRetryDelayMs = options.defaultRetryDelayMs;
  }

  async process(eventId: string, deliveryId: string): Promise<readonly DeliveryResult[]> {
    const delivery = await new BulkCommunicationRepository(this.#client).get(eventId, deliveryId);
    if (!delivery) throw new RepositoryError("not-found", "The event-owned delivery was not found.");
    const coordinator = new EmailDeliveryCoordinator({
      provider: this.#provider,
      providerName: this.#providerName,
      auditRepository: new PrismaBulkDeliveryAuditRepository(this.#client, eventId),
      clock: this.#clock,
      ...(this.#defaultRetryDelayMs === undefined ? {} : { defaultRetryDelayMs: this.#defaultRetryDelayMs }),
    });
    const results: DeliveryResult[] = [];
    for (const recipient of delivery.recipients) {
      if (recipient.status !== "queued" && recipient.status !== "retry-scheduled") continue;
      results.push(
        await coordinator.deliver({
          recipientId: recipient.id,
          message: {
            to: [{ address: recipient.email, ...(recipient.displayName ? { name: recipient.displayName } : {}) }],
            subject: recipient.subjectSnapshot,
            html: recipient.htmlSnapshot,
            text: recipient.textSnapshot ?? recipient.htmlSnapshot,
            idempotencyKey: `message-recipient:${recipient.id}`,
          },
        }),
      );
    }
    return results;
  }
}

export async function createConfiguredBulkDeliveryDispatcher(client: PrismaClient): Promise<BulkDeliveryDispatcher> {
  const infrastructure = await createProductionInfrastructure();
  return new BulkDeliveryDispatcher({
    client,
    provider: infrastructure.email,
    providerName: "resend",
    clock: infrastructure.clock,
  });
}
