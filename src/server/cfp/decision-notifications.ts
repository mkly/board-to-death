import { EvaluationDecisionOutcome, type PrismaClient } from "../../generated/prisma/client.ts";
import { parseCfpDefinition, proposalTitleFromAnswers } from "../../lib/cfp/index.ts";
import { CFP_MESSAGE_VARIABLE_KEYS } from "../../lib/cfp/messages.ts";
import { renderEmailTemplate } from "../../lib/communications/email-templates.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface QueuedCfpDecisionNotification {
  readonly deliveryId: string;
  readonly recipientId: string;
  readonly duplicate: boolean;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002";
}

interface DecisionCopy {
  readonly subject: string;
  readonly body: string;
  readonly label: string;
  readonly canonicalSubject: string;
}

// A form need not carry a recognizable proposal title, so every outcome also has copy that reads
// correctly without one. The canonical subject is what the stored template version keeps, so that
// row stays the same for an event whichever submission is decided first.
function outcomeCopy(outcome: EvaluationDecisionOutcome, proposalTitle: string | null): DecisionCopy {
  if (outcome === EvaluationDecisionOutcome.ACCEPTED) {
    const canonicalSubject = "Proposal accepted: {{session.title}} — {{event.name}}";
    return {
      subject: proposalTitle ? canonicalSubject : "Proposal accepted — {{event.name}}",
      body: proposalTitle
        ? "Congratulations, {{recipient.name}}. Your proposal **{{session.title}}** has been accepted for {{event.name}}."
        : "Congratulations, {{recipient.name}}. Your proposal has been accepted for {{event.name}}.",
      label: "acceptance",
      canonicalSubject,
    };
  }
  if (outcome === EvaluationDecisionOutcome.REJECTED) {
    const canonicalSubject = "Proposal decision: {{session.title}} — {{event.name}}";
    return {
      subject: proposalTitle ? canonicalSubject : "Proposal decision — {{event.name}}",
      body: proposalTitle
        ? "Hello {{recipient.name}}. Your proposal **{{session.title}}** was not selected for {{event.name}}."
        : "Hello {{recipient.name}}. Your proposal was not selected for {{event.name}}.",
      label: "rejection",
      canonicalSubject,
    };
  }
  throw new RepositoryError("invalid-input", "Only accepted or rejected decisions notify the applicant.");
}

export class CfpDecisionNotificationRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async queue(eventId: string, decisionId: string): Promise<QueuedCfpDecisionNotification> {
    const idempotencyKey = `cfp-decision:${decisionId}`;
    const existing = await this.#find(eventId, idempotencyKey);
    if (existing) return { ...existing, duplicate: true };

    const decision = await this.#client.evaluationDecision.findFirst({
      where: { id: decisionId, submission: { eventId } },
      select: {
        outcome: true,
        submission: {
          select: {
            id: true,
            event: {
              select: { id: true, name: true, startsAt: true, timezone: true, location: true },
            },
            revisions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: {
                definitionSnapshot: true,
                answers: { orderBy: { sortOrder: "asc" }, select: { questionId: true, value: true } },
              },
            },
            participants: {
              orderBy: { sortOrder: "asc" },
              take: 1,
              select: {
                speaker: {
                  select: {
                    profileVersions: {
                      orderBy: { versionNumber: "desc" },
                      take: 1,
                      select: { email: true, givenName: true, familyName: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!decision) throw new RepositoryError("not-found", "The event-owned decision was not found.");

    const revision = decision.submission.revisions[0];
    if (!revision) throw new RepositoryError("invalid-input", "The decided submission has no proposal revision.");
    const parsedDefinition = parseCfpDefinition(revision.definitionSnapshot);
    if (!parsedDefinition.ok) {
      throw new RepositoryError("invalid-input", "The decided submission has an invalid form snapshot.");
    }
    const proposalTitle = proposalTitleFromAnswers(parsedDefinition.definition, revision.answers);
    const copy = outcomeCopy(decision.outcome, proposalTitle);

    const leadProfile = decision.submission.participants[0]?.speaker.profileVersions[0];
    const emailQuestionIds = new Set(
      parsedDefinition.definition.sections
        .flatMap(({ questions }) => questions)
        .filter(({ type }) => type === "email")
        .map(({ id }) => id),
    );
    const emailAnswer = revision.answers.find(
      ({ questionId, value }) => emailQuestionIds.has(questionId) && typeof value === "string" && value.trim() !== "",
    )?.value;
    const email = leadProfile?.email ?? (typeof emailAnswer === "string" ? emailAnswer.trim().toLowerCase() : null);
    if (!email) throw new RepositoryError("invalid-input", "The decided submission has no applicant email.");
    const displayName = leadProfile ? `${leadProfile.givenName} ${leadProfile.familyName}` : email;

    const eventStartDate = new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeZone: decision.submission.event.timezone,
    }).format(decision.submission.event.startsAt);
    const rendered = renderEmailTemplate(
      {
        key: `cfp-decision-${copy.label}`,
        name: `CFP ${copy.label}`,
        subjectTemplate: copy.subject,
        bodyTemplate: copy.body,
      },
      {
        "event.name": decision.submission.event.name,
        "event.start_date": eventStartDate,
        "event.location": decision.submission.event.location ?? "Online",
        "recipient.name": displayName,
        "recipient.email": email,
        "session.title": proposalTitle ?? "",
      },
      { allowedVariables: CFP_MESSAGE_VARIABLE_KEYS },
    );
    if (!rendered.ok) {
      throw new RepositoryError("invalid-input", rendered.issues.map(({ message }) => message).join(" "));
    }

    try {
      return await this.#client.$transaction(async (transaction) => {
        const template = await transaction.communicationTemplate.upsert({
          where: { eventId_key: { eventId, key: `cfp-decision-${copy.label}` } },
          create: {
            eventId,
            key: `cfp-decision-${copy.label}`,
            name: `CFP ${copy.label} for ${decision.submission.event.name}`,
          },
          update: {},
        });
        const templateVersion = await transaction.communicationTemplateVersion.upsert({
          where: { templateId_version: { templateId: template.id, version: 1 } },
          create: {
            eventId,
            templateId: template.id,
            version: 1,
            subjectTemplate: copy.canonicalSubject,
            htmlTemplate: copy.body,
          },
          update: {},
        });
        const delivery = await transaction.messageDelivery.create({
          data: {
            eventId,
            templateVersionId: templateVersion.id,
            idempotencyKey,
            recipients: {
              create: {
                recipientKey: `submission:${decision.submission.id}:applicant`,
                email,
                displayName,
                subjectSnapshot: rendered.rendered.subject,
                htmlSnapshot: rendered.rendered.html,
                textSnapshot: rendered.rendered.text ?? rendered.rendered.previewMarkdown,
              },
            },
          },
          select: { id: true, recipients: { take: 1, select: { id: true } } },
        });
        const recipient = delivery.recipients[0];
        if (!recipient) throw new RepositoryError("conflict", "The decision notification recipient was not queued.");
        return { deliveryId: delivery.id, recipientId: recipient.id, duplicate: false };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const duplicate = await this.#find(eventId, idempotencyKey);
      if (!duplicate) throw error;
      return { ...duplicate, duplicate: true };
    }
  }

  async #find(
    eventId: string,
    idempotencyKey: string,
  ): Promise<Omit<QueuedCfpDecisionNotification, "duplicate"> | null> {
    const delivery = await this.#client.messageDelivery.findUnique({
      where: { eventId_idempotencyKey: { eventId, idempotencyKey } },
      select: { id: true, recipients: { take: 1, select: { id: true } } },
    });
    const recipient = delivery?.recipients[0];
    return delivery && recipient ? { deliveryId: delivery.id, recipientId: recipient.id } : null;
  }
}
