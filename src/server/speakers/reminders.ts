import { Temporal } from "temporal-polyfill";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { renderEmailTemplate } from "../../lib/communications/email-templates.ts";
import { EmailDeliveryCoordinator } from "../communications/delivery.ts";
import { PrismaDeliveryAuditRepository } from "../communications/persistence.ts";
import { RepositoryError } from "../events/repositories.ts";
import type { ClockService, EmailService } from "../infrastructure/index.ts";

export interface SpeakerTaskReminderRuleInput {
  readonly eventId: string;
  readonly templateId: string;
  readonly name: string;
  readonly daysBeforeDue: number;
  readonly sendAtMinute: number;
}

export interface UpdateSpeakerTaskReminderRuleInput extends Omit<SpeakerTaskReminderRuleInput, "eventId"> {
  readonly ruleId: string;
  readonly eventId: string;
}

export interface OnboardingReminderRunOptions {
  readonly client: PrismaClient;
  readonly email: EmailService;
  readonly clock: ClockService;
  readonly providerName: string;
  readonly defaultRetryDelayMs?: number;
}

export interface OnboardingReminderRunResult {
  readonly occurrencesCreated: number;
  readonly deliveries: number;
  readonly retriesScheduled: number;
  readonly terminalFailures: number;
  readonly skipped: number;
}

const candidateInclude = {
  definitionVersion: true,
  speaker: {
    include: {
      profileVersions: { orderBy: { versionNumber: "desc" }, take: 1 },
      submissions: {
        include: { submission: { select: { status: true } } },
      },
    },
  },
} as const satisfies Prisma.SpeakerTaskAssignmentInclude;

type ReminderCandidate = Prisma.SpeakerTaskAssignmentGetPayload<{ include: typeof candidateInclude }>;

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function normalizedRule(input: SpeakerTaskReminderRuleInput) {
  const name = input.name.trim();
  if (name === "") invalid("Reminder rule name is required.");
  if (!Number.isInteger(input.daysBeforeDue) || input.daysBeforeDue < 0) {
    invalid("daysBeforeDue must be a nonnegative integer.");
  }
  if (!Number.isInteger(input.sendAtMinute) || input.sendAtMinute < 0 || input.sendAtMinute >= 1_440) {
    invalid("sendAtMinute must be an integer from 0 through 1439.");
  }
  return { name, daysBeforeDue: input.daysBeforeDue, sendAtMinute: input.sendAtMinute };
}

function requiresConfirmedSpeaker(applicability: Prisma.JsonValue): boolean {
  return (
    typeof applicability === "object" &&
    applicability !== null &&
    !Array.isArray(applicability) &&
    applicability.confirmedOnly === true
  );
}

function candidateIsEligible(candidate: ReminderCandidate): boolean {
  const statuses = candidate.speaker.submissions.map(({ submission }) => submission.status);
  return requiresConfirmedSpeaker(candidate.definitionVersion.applicability)
    ? statuses.includes("CONFIRMED")
    : statuses.includes("ACCEPTED") || statuses.includes("CONFIRMED");
}

function speakerName(candidate: ReminderCandidate): string {
  const profile = candidate.speaker.profileVersions[0];
  if (!profile) return "Speaker";
  return `${profile.preferredName ?? profile.givenName} ${profile.familyName}`;
}

function scheduledFor(dueAt: Date, timezone: string, daysBeforeDue: number, sendAtMinute: number): Date {
  const dueDate = Temporal.Instant.fromEpochMilliseconds(dueAt.getTime()).toZonedDateTimeISO(timezone).toPlainDate();
  const reminderDate = dueDate.subtract({ days: daysBeforeDue });
  const hour = Math.floor(sendAtMinute / 60);
  const minute = sendAtMinute % 60;
  return new Date(
    reminderDate.toPlainDateTime({ hour, minute }).toZonedDateTime(timezone).toInstant().epochMilliseconds,
  );
}

function deadlineLabel(dueAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: timezone }).format(dueAt);
}

async function requireEventTemplate(client: PrismaClient, eventId: string, templateId: string): Promise<void> {
  const template = await client.communicationTemplate.findFirst({ where: { id: templateId, eventId } });
  if (!template) throw new RepositoryError("not-found", "The event-owned email template was not found.");
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "P2002") throw new RepositoryError("conflict", "A reminder rule with this name already exists.");
    if (code === "P2003" || code === "P2025") {
      throw new RepositoryError("not-found", "The event-owned reminder rule was not found.");
    }
  }
  throw error;
}

export class SpeakerTaskReminderRepository {
  readonly #client: PrismaClient;
  readonly #now: () => Date;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.#client = client;
    this.#now = now;
  }

  async list(eventId: string) {
    return this.#client.speakerTaskReminderRule.findMany({
      where: { eventId },
      include: { template: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } } },
      orderBy: [{ cancelledAt: "asc" }, { name: "asc" }],
    });
  }

  async create(input: SpeakerTaskReminderRuleInput) {
    const rule = normalizedRule(input);
    await requireEventTemplate(this.#client, input.eventId, input.templateId);
    try {
      return await this.#client.speakerTaskReminderRule.create({
        data: { eventId: input.eventId, templateId: input.templateId, ...rule },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async update(input: UpdateSpeakerTaskReminderRuleInput) {
    const rule = normalizedRule(input);
    await requireEventTemplate(this.#client, input.eventId, input.templateId);
    try {
      return await this.#client.speakerTaskReminderRule.update({
        where: { id: input.ruleId, eventId: input.eventId, cancelledAt: null },
        data: { templateId: input.templateId, ...rule },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async activate(eventId: string, ruleId: string) {
    try {
      return await this.#client.speakerTaskReminderRule.update({
        where: { id: ruleId, eventId, cancelledAt: null },
        data: { enabledAt: this.#now() },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async cancel(eventId: string, ruleId: string) {
    try {
      return await this.#client.speakerTaskReminderRule.update({
        where: { id: ruleId, eventId, cancelledAt: null },
        data: { cancelledAt: this.#now() },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async setAssignmentOptOut(eventId: string, assignmentId: string, optedOut: boolean) {
    try {
      return await this.#client.speakerTaskAssignment.update({
        where: { id: assignmentId, eventId },
        data: { remindersOptedOut: optedOut },
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async previewEligibleAssignments(eventId: string): Promise<ReminderCandidate[]> {
    const candidates = await this.#client.speakerTaskAssignment.findMany({
      where: {
        eventId,
        dueAt: { not: null },
        remindersOptedOut: false,
        status: { in: ["PENDING", "SUBMITTED", "REVISION_REQUESTED"] },
      },
      include: candidateInclude,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    });
    return candidates.filter(candidateIsEligible);
  }
}

async function createOrFindOccurrence(
  client: PrismaClient,
  rule: Awaited<ReturnType<SpeakerTaskReminderRepository["list"]>>[number],
  candidate: ReminderCandidate,
  event: { id: string; name: string; startsAt: Date; location: string | null; timezone: string },
  occurrenceAt: Date,
) {
  const templateVersion = rule.template.versions[0];
  const profile = candidate.speaker.profileVersions[0];
  if (!templateVersion || !profile || !candidate.dueAt) return { delivery: null, created: false };

  const name = speakerName(candidate);
  const rendered = renderEmailTemplate(
    {
      key: rule.template.key,
      name: rule.template.name,
      subjectTemplate: templateVersion.subjectTemplate,
      bodyTemplate: templateVersion.htmlTemplate,
      textTemplate: templateVersion.textTemplate,
    },
    {
      "event.name": event.name,
      "event.start_date": deadlineLabel(event.startsAt, event.timezone),
      "event.location": event.location ?? "Online",
      "recipient.name": name,
      "recipient.email": profile.email,
      "speaker.name": name,
      "session.title": "",
      "onboarding.deadline": deadlineLabel(candidate.dueAt, event.timezone),
    },
  );
  if (!rendered.ok) {
    throw new RepositoryError("invalid-input", rendered.issues.map(({ message }) => message).join(" "));
  }

  const occurrenceKey = `onboarding-reminder:${rule.id}:${candidate.id}:${occurrenceAt.toISOString()}`;
  try {
    const delivery = await client.messageDelivery.create({
      data: {
        eventId: event.id,
        templateVersionId: templateVersion.id,
        idempotencyKey: occurrenceKey,
        occurrenceKey,
        scheduledFor: occurrenceAt,
        recipients: {
          create: {
            recipientKey: `assignment:${candidate.id}`,
            email: profile.email,
            displayName: name,
            subjectSnapshot: rendered.rendered.subject,
            htmlSnapshot: rendered.rendered.html,
            textSnapshot: rendered.rendered.text ?? rendered.rendered.previewMarkdown,
          },
        },
      },
      include: { recipients: true },
    });
    return { delivery, created: true };
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002")) {
      throw error;
    }
    const delivery = await client.messageDelivery.findUnique({
      where: { eventId_occurrenceKey: { eventId: event.id, occurrenceKey } },
      include: { recipients: true },
    });
    return { delivery, created: false };
  }
}

export async function runOnboardingReminderWorker(
  options: OnboardingReminderRunOptions,
): Promise<OnboardingReminderRunResult> {
  const now = options.clock.now();
  const rules = await options.client.speakerTaskReminderRule.findMany({
    where: { enabledAt: { not: null, lte: now }, cancelledAt: null },
    include: {
      template: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
      event: { select: { id: true, name: true, startsAt: true, location: true, timezone: true } },
    },
    orderBy: { id: "asc" },
  });
  const coordinator = new EmailDeliveryCoordinator({
    provider: options.email,
    providerName: options.providerName,
    auditRepository: new PrismaDeliveryAuditRepository(options.client),
    clock: options.clock,
    defaultRetryDelayMs: options.defaultRetryDelayMs,
  });
  const result = { occurrencesCreated: 0, deliveries: 0, retriesScheduled: 0, terminalFailures: 0, skipped: 0 };

  for (const rule of rules) {
    const candidates = await new SpeakerTaskReminderRepository(options.client).previewEligibleAssignments(rule.eventId);
    for (const candidate of candidates) {
      if (!candidate.dueAt) continue;
      const occurrenceAt = scheduledFor(candidate.dueAt, rule.event.timezone, rule.daysBeforeDue, rule.sendAtMinute);
      if (occurrenceAt > now) continue;
      const occurrence = await createOrFindOccurrence(options.client, rule, candidate, rule.event, occurrenceAt);
      const recipient = occurrence.delivery?.recipients[0];
      if (!recipient) continue;
      if (occurrence.created) result.occurrencesCreated += 1;
      const delivery = await coordinator.deliver({
        recipientId: recipient.id,
        message: {
          to: [{ address: recipient.email, ...(recipient.displayName ? { name: recipient.displayName } : {}) }],
          subject: recipient.subjectSnapshot,
          text: recipient.textSnapshot ?? recipient.htmlSnapshot,
          html: recipient.htmlSnapshot,
          idempotencyKey: occurrence.delivery?.idempotencyKey,
        },
      });
      if (delivery.status === "delivered") result.deliveries += 1;
      else if (delivery.status === "retry-scheduled") result.retriesScheduled += 1;
      else if (delivery.status === "terminal-failure") result.terminalFailures += 1;
      else result.skipped += 1;
    }
  }
  return result;
}
