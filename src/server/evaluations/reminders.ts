import {
  EvaluationAssignmentStatus,
  EvaluationPlanVersionStatus,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { renderEmailTemplate } from "../../lib/communications/email-templates.ts";
import { RepositoryError } from "../events/repositories.ts";
import { randomUUID } from "node:crypto";

const reminderTemplateKey = "evaluation-review-reminder";
const reminderOccurrencePrefix = "evaluation-review-reminder";

export interface EvaluationReminderTarget {
  readonly reviewerId: string;
  readonly displayName: string;
  readonly email: string;
  readonly assignedCount: number;
  readonly completedCount: number;
  readonly outstandingCount: number;
  readonly lastReminderAt: Date | null;
}

export interface EvaluationReminderLog {
  readonly deliveryId: string;
  readonly createdAt: Date;
  readonly recipientCount: number;
}

export interface EvaluationReminderWorkspace {
  readonly targets: readonly EvaluationReminderTarget[];
  readonly deliveries: readonly EvaluationReminderLog[];
}

export interface QueueEvaluationRemindersInput {
  readonly eventId: string;
  readonly roundId: string;
  readonly reviewerIds: readonly string[];
}

export interface QueuedEvaluationReminders {
  readonly deliveryId: string;
  readonly recipientCount: number;
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function uniqueReviewerIds(reviewerIds: readonly string[]): string[] {
  const normalized = reviewerIds.map((id) => id.trim()).filter(Boolean);
  const unique = [...new Set(normalized)];
  if (unique.length === 0) invalid("Select at least one reviewer with outstanding assignments.");
  if (unique.length !== normalized.length) invalid("Each reviewer may be selected only once.");
  return unique;
}

export class EvaluationReminderRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async getWorkspace(eventId: string, roundId: string): Promise<EvaluationReminderWorkspace> {
    const [reviewers, deliveries] = await Promise.all([
      this.#client.evaluationReviewer.findMany({
        where: {
          eventId,
          status: EvaluationReviewerStatus.ACTIVE,
          assignments: { some: { roundId, status: { not: EvaluationAssignmentStatus.REVOKED } } },
        },
        orderBy: [{ displayName: "asc" }, { email: "asc" }],
        select: {
          id: true,
          displayName: true,
          email: true,
          assignments: {
            where: { roundId, status: { not: EvaluationAssignmentStatus.REVOKED } },
            select: { status: true },
          },
        },
      }),
      this.#client.messageDelivery.findMany({
        where: { eventId, occurrenceKey: { startsWith: `${reminderOccurrencePrefix}:${roundId}:` } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          recipients: { select: { recipientKey: true } },
        },
      }),
    ]);

    const lastReminderByReviewer = new Map<string, Date>();
    for (const delivery of deliveries) {
      for (const recipient of delivery.recipients) {
        const reviewerId = recipient.recipientKey.replace(/^evaluation-reviewer:/, "");
        if (!lastReminderByReviewer.has(reviewerId)) lastReminderByReviewer.set(reviewerId, delivery.createdAt);
      }
    }

    return {
      targets: reviewers
        .map((reviewer) => {
          const completedCount = reviewer.assignments.filter(
            ({ status }) => status === EvaluationAssignmentStatus.COMPLETED,
          ).length;
          return {
            reviewerId: reviewer.id,
            displayName: reviewer.displayName,
            email: reviewer.email,
            assignedCount: reviewer.assignments.length,
            completedCount,
            outstandingCount: reviewer.assignments.length - completedCount,
            lastReminderAt: lastReminderByReviewer.get(reviewer.id) ?? null,
          };
        })
        .filter(({ outstandingCount }) => outstandingCount > 0),
      deliveries: deliveries.map((delivery) => ({
        deliveryId: delivery.id,
        createdAt: delivery.createdAt,
        recipientCount: delivery.recipients.length,
      })),
    };
  }

  async queue(input: QueueEvaluationRemindersInput): Promise<QueuedEvaluationReminders> {
    const reviewerIds = uniqueReviewerIds(input.reviewerIds);
    return this.#client.$transaction(async (transaction) => {
      const round = await transaction.evaluationRound.findFirst({
        where: {
          id: input.roundId,
          status: EvaluationRoundStatus.OPEN,
          planVersion: { status: EvaluationPlanVersionStatus.ACTIVE, plan: { eventId: input.eventId } },
        },
        select: {
          id: true,
          title: true,
          planVersion: { select: { plan: { select: { event: { select: { name: true } } } } } },
        },
      });
      if (!round) invalid("Reminders can only be sent for an open evaluation round in this event.");

      const reviewers = await transaction.evaluationReviewer.findMany({
        where: {
          id: { in: reviewerIds },
          eventId: input.eventId,
          status: EvaluationReviewerStatus.ACTIVE,
          assignments: { some: { roundId: round.id, status: EvaluationAssignmentStatus.ASSIGNED } },
        },
        orderBy: [{ displayName: "asc" }, { email: "asc" }],
        select: { id: true, displayName: true, email: true },
      });
      if (reviewers.length !== reviewerIds.length) {
        invalid("Every selected reviewer must still have an outstanding assignment in this open round.");
      }

      const subjectTemplate = "Reminder: outstanding reviews for {{event.name}}";
      const bodyTemplate = [
        "Hello {{recipient.name}},",
        "You have outstanding reviews in the current evaluation round for **{{event.name}}**.",
        "Sign in to the reviewer workspace to complete them.",
      ].join("\n\n");
      const template = await transaction.communicationTemplate.upsert({
        where: { eventId_key: { eventId: input.eventId, key: reminderTemplateKey } },
        create: {
          eventId: input.eventId,
          key: reminderTemplateKey,
          name: "Reviewer assignment reminder",
        },
        update: {},
      });
      const templateVersion = await transaction.communicationTemplateVersion.upsert({
        where: { templateId_version: { templateId: template.id, version: 1 } },
        create: {
          eventId: input.eventId,
          templateId: template.id,
          version: 1,
          subjectTemplate,
          htmlTemplate: bodyTemplate,
          textTemplate: bodyTemplate,
        },
        update: {},
      });
      const eventName = round.planVersion.plan.event.name;
      const recipients = reviewers.map((reviewer) => {
        const rendered = renderEmailTemplate(
          {
            key: reminderTemplateKey,
            name: "Reviewer assignment reminder",
            subjectTemplate,
            bodyTemplate,
            textTemplate: bodyTemplate,
          },
          { "event.name": eventName, "recipient.name": reviewer.displayName },
        );
        if (!rendered.ok) invalid(rendered.issues.map(({ message }) => message).join(" "));
        return {
          recipientKey: `evaluation-reviewer:${reviewer.id}`,
          email: reviewer.email,
          displayName: reviewer.displayName,
          subjectSnapshot: rendered.rendered.subject,
          htmlSnapshot: rendered.rendered.html,
          textSnapshot: rendered.rendered.text ?? rendered.rendered.previewMarkdown,
        };
      });
      const occurrenceKey = `${reminderOccurrencePrefix}:${round.id}:${randomUUID()}`;
      const delivery = await transaction.messageDelivery.create({
        data: {
          eventId: input.eventId,
          templateVersionId: templateVersion.id,
          idempotencyKey: occurrenceKey,
          occurrenceKey,
          recipients: { create: recipients },
        },
        select: { id: true, recipients: { select: { id: true } } },
      });
      return { deliveryId: delivery.id, recipientCount: delivery.recipients.length };
    });
  }
}
