import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { publicCfpStartHref } from "../../lib/cfp/publication.ts";
import { renderEmailTemplate } from "../../lib/communications/email-templates.ts";
import { EmailDeliveryCoordinator } from "../communications/delivery.ts";
import { PrismaDeliveryAuditRepository } from "../communications/persistence.ts";
import type { ClockService, EmailService } from "../infrastructure/index.ts";
import type { CfpPolicyMessages } from "./policies.ts";

export interface CfpDraftReminderRunOptions {
  readonly client: PrismaClient;
  readonly email: EmailService;
  readonly clock: ClockService;
  readonly providerName: string;
  readonly publicAppUrl: string;
  readonly defaultRetryDelayMs?: number;
}

export interface CfpDraftReminderRunResult {
  readonly occurrencesCreated: number;
  readonly deliveries: number;
  readonly retriesScheduled: number;
  readonly terminalFailures: number;
  readonly skipped: number;
}

const candidateInclude = {
  formVersion: {
    include: {
      steps: { include: { questions: { select: { key: true, type: true } } } },
    },
  },
} as const satisfies Prisma.CfpSubmissionDraftInclude;

type ReminderCandidate = Prisma.CfpSubmissionDraftGetPayload<{ include: typeof candidateInclude }>;

interface ReminderPolicy {
  readonly id: string;
  readonly publicId: string;
  readonly eventId: string;
  readonly versionNumber: number;
  readonly submissionOpensAt: Date;
  readonly submissionClosesAt: Date;
  readonly messages: CfpPolicyMessages;
  readonly event: {
    readonly id: string;
    readonly name: string;
    readonly timezone: string;
    readonly startsAt: Date;
    readonly location: string | null;
  };
}

interface DraftRecipient {
  readonly email: string;
  readonly name: string;
}

const emailSchema = z.email();

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = emailSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

function candidateRecipient(candidate: ReminderCandidate): DraftRecipient | null {
  if (Array.isArray(candidate.participants)) {
    for (const value of candidate.participants) {
      const participant = objectValue(value);
      const email = validEmail(participant?.email);
      if (!participant || !email) continue;
      const name = [participant.givenName, participant.familyName]
        .filter((part): part is string => typeof part === "string" && part.trim() !== "")
        .join(" ");
      return { email, name: name || email };
    }
  }

  const answers = objectValue(candidate.answers);
  if (!answers) return null;
  const emailQuestionKeys = new Set(
    candidate.formVersion.steps.flatMap(({ questions }) =>
      questions.filter(({ type }) => type === "EMAIL").map(({ key }) => key),
    ),
  );
  for (const key of emailQuestionKeys) {
    const email = validEmail(answers[key]);
    if (email) return { email, name: email };
  }
  return null;
}

function scheduledFor(closesAt: Date, timezone: string, daysBeforeClose: number, sendAtMinute: number): Date {
  const closeDate = Temporal.Instant.fromEpochMilliseconds(closesAt.getTime())
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
  const reminderDate = closeDate.subtract({ days: daysBeforeClose });
  return new Date(
    reminderDate
      .toPlainDateTime({ hour: Math.floor(sendAtMinute / 60), minute: sendAtMinute % 60 })
      .toZonedDateTime(timezone)
      .toInstant().epochMilliseconds,
  );
}

function dateLabel(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: timezone }).format(value);
}

function messageValues(policy: ReminderPolicy, recipient: DraftRecipient) {
  return {
    "event.name": policy.event.name,
    "event.start_date": new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeZone: policy.event.timezone,
    }).format(policy.event.startsAt),
    "event.location": policy.event.location ?? "Online",
    "recipient.name": recipient.name,
    "recipient.email": recipient.email,
  } as const;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002";
}

async function currentPolicies(client: PrismaClient, now: Date): Promise<ReminderPolicy[]> {
  const policies = await client.cfpPolicy.findMany({
    where: { status: "PUBLISHED" },
    include: {
      event: { select: { id: true, name: true, timezone: true, startsAt: true, location: true } },
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
    orderBy: { id: "asc" },
  });
  return policies.flatMap((policy) => {
    const version = policy.versions[0];
    if (!version || version.draftPolicy === "DISABLED") return [];
    if (now < version.submissionOpensAt || now > version.submissionClosesAt) return [];
    const messages = version.messages as unknown as CfpPolicyMessages;
    if (!messages.reminder?.enabled) return [];
    return [
      {
        id: policy.id,
        publicId: policy.publicId,
        eventId: policy.eventId,
        versionNumber: version.versionNumber,
        submissionOpensAt: version.submissionOpensAt,
        submissionClosesAt: version.submissionClosesAt,
        messages,
        event: policy.event,
      },
    ];
  });
}

async function createOrFindOccurrence(
  client: PrismaClient,
  policy: ReminderPolicy,
  candidate: ReminderCandidate,
  recipient: DraftRecipient,
  occurrenceAt: Date,
  publicAppUrl: string,
) {
  const occurrenceKey = `cfp-draft-reminder:${candidate.id}`;
  const existing = await client.messageDelivery.findUnique({
    where: { eventId_occurrenceKey: { eventId: policy.eventId, occurrenceKey } },
    include: { recipients: true },
  });
  if (existing) return { delivery: existing, created: false };

  const continueUrl = new URL(publicCfpStartHref(policy.publicId), publicAppUrl).toString();
  const bodyTemplate = [
    "You have an unfinished submission draft for **{{event.name}}**.",
    `Finish and submit it before ${dateLabel(policy.submissionClosesAt, policy.event.timezone)}.`,
    `[Continue your submission](${continueUrl})`,
  ].join("\n\n");
  const subjectTemplate = "Finish your draft for {{event.name}}";
  const rendered = renderEmailTemplate(
    { key: "cfp-draft-reminder", name: "CFP draft reminder", subjectTemplate, bodyTemplate },
    messageValues(policy, recipient),
  );
  if (!rendered.ok) throw new TypeError(rendered.issues.map(({ message }) => message).join(" "));

  try {
    return await client.$transaction(async (transaction) => {
      const template = await transaction.communicationTemplate.upsert({
        where: { eventId_key: { eventId: policy.eventId, key: `cfp-draft-reminder-${policy.id}` } },
        create: {
          eventId: policy.eventId,
          key: `cfp-draft-reminder-${policy.id}`,
          name: `CFP draft reminder for ${policy.event.name}`,
        },
        update: {},
      });
      const templateVersion = await transaction.communicationTemplateVersion.upsert({
        where: { templateId_version: { templateId: template.id, version: policy.versionNumber } },
        create: {
          eventId: policy.eventId,
          templateId: template.id,
          version: policy.versionNumber,
          subjectTemplate,
          htmlTemplate: bodyTemplate,
        },
        update: {},
      });
      const delivery = await transaction.messageDelivery.create({
        data: {
          eventId: policy.eventId,
          templateVersionId: templateVersion.id,
          idempotencyKey: occurrenceKey,
          occurrenceKey,
          scheduledFor: occurrenceAt,
          recipients: {
            create: {
              recipientKey: `cfp-draft:${candidate.id}:applicant`,
              email: recipient.email,
              displayName: recipient.name,
              subjectSnapshot: rendered.rendered.subject,
              htmlSnapshot: rendered.rendered.html,
              textSnapshot: rendered.rendered.text ?? rendered.rendered.previewMarkdown,
            },
          },
        },
        include: { recipients: true },
      });
      return { delivery, created: true };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const delivery = await client.messageDelivery.findUnique({
      where: { eventId_occurrenceKey: { eventId: policy.eventId, occurrenceKey } },
      include: { recipients: true },
    });
    if (!delivery) throw error;
    return { delivery, created: false };
  }
}

export async function runCfpDraftReminderWorker(
  options: CfpDraftReminderRunOptions,
): Promise<CfpDraftReminderRunResult> {
  const now = options.clock.now();
  const coordinator = new EmailDeliveryCoordinator({
    provider: options.email,
    providerName: options.providerName,
    auditRepository: new PrismaDeliveryAuditRepository(options.client),
    clock: options.clock,
    defaultRetryDelayMs: options.defaultRetryDelayMs,
  });
  const result = { occurrencesCreated: 0, deliveries: 0, retriesScheduled: 0, terminalFailures: 0, skipped: 0 };

  for (const policy of await currentPolicies(options.client, now)) {
    const reminder = policy.messages.reminder;
    if (!reminder) continue;
    const occurrenceAt = scheduledFor(
      policy.submissionClosesAt,
      policy.event.timezone,
      reminder.daysBeforeClose,
      reminder.sendAtMinute,
    );
    const candidates = await options.client.cfpSubmissionDraft.findMany({
      where: {
        eventId: policy.eventId,
        policyId: policy.id,
        expiresAt: { gt: now },
        remindersOptedOut: false,
      },
      include: candidateInclude,
      orderBy: { id: "asc" },
    });

    for (const candidate of candidates) {
      const occurrenceKey = `cfp-draft-reminder:${candidate.id}`;
      const existing = await options.client.messageDelivery.findUnique({
        where: { eventId_occurrenceKey: { eventId: policy.eventId, occurrenceKey } },
        select: { recipients: { take: 1, select: { status: true } } },
      });
      if (existing?.recipients[0]?.status === "DELIVERED" || existing?.recipients[0]?.status === "FAILED") continue;
      if (!existing && occurrenceAt > now) continue;
      const recipient = candidateRecipient(candidate);
      if (!recipient) continue;
      const occurrence = await createOrFindOccurrence(
        options.client,
        policy,
        candidate,
        recipient,
        occurrenceAt,
        options.publicAppUrl,
      );
      const messageRecipient = occurrence.delivery.recipients[0];
      if (!messageRecipient) continue;
      if (occurrence.created) result.occurrencesCreated += 1;
      const delivery = await coordinator.deliver({
        recipientId: messageRecipient.id,
        message: {
          to: [
            {
              address: messageRecipient.email,
              ...(messageRecipient.displayName ? { name: messageRecipient.displayName } : {}),
            },
          ],
          subject: messageRecipient.subjectSnapshot,
          text: messageRecipient.textSnapshot ?? messageRecipient.htmlSnapshot,
          html: messageRecipient.htmlSnapshot,
          idempotencyKey: occurrence.delivery.idempotencyKey,
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
