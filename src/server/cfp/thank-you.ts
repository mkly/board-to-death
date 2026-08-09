import type { PrismaClient } from "../../generated/prisma/client.ts";
import { CFP_MESSAGE_VARIABLE_KEYS } from "../../lib/cfp/messages.ts";
import { type RenderedEmailTemplate, renderEmailTemplate } from "../../lib/communications/email-templates.ts";
import { RepositoryError } from "../events/repositories.ts";

export interface CfpApplicantRecipient {
  readonly email: string;
  readonly name: string;
}

export interface CfpApplicantMessageContext {
  readonly event: {
    readonly id: string;
    readonly name: string;
    readonly startsAt: Date;
    readonly timezone: string;
    readonly location: string | null;
  };
  readonly recipient: CfpApplicantRecipient;
}

export interface QueueCfpThankYouInput extends CfpApplicantMessageContext {
  readonly policyId: string;
  readonly policyVersionNumber: number;
  readonly submissionId: string;
  readonly bodyTemplate: string;
  readonly portalUrl: string;
}

export interface QueuedCfpThankYou {
  readonly deliveryId: string;
  readonly recipientId: string;
  readonly duplicate: boolean;
}

function messageValues({ event, recipient }: CfpApplicantMessageContext) {
  const eventStartDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: event.timezone,
  }).format(event.startsAt);
  return {
    "event.name": event.name,
    "event.start_date": eventStartDate,
    "event.location": event.location ?? "Online",
    "recipient.name": recipient.name,
    "recipient.email": recipient.email,
  } as const;
}

export function renderCfpApplicantMessage(
  bodyTemplate: string,
  context: CfpApplicantMessageContext,
): RenderedEmailTemplate {
  const result = renderEmailTemplate(
    {
      key: "cfp-thank-you",
      name: "CFP thank-you",
      subjectTemplate: "Thank you for submitting to {{event.name}}",
      bodyTemplate,
    },
    messageValues(context),
    { allowedVariables: CFP_MESSAGE_VARIABLE_KEYS },
  );
  if (!result.ok) {
    throw new RepositoryError("invalid-input", result.issues.map(({ message }) => message).join(" "));
  }
  return result.rendered;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2002";
}

export class CfpThankYouRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async queue(input: QueueCfpThankYouInput): Promise<QueuedCfpThankYou> {
    const bodyTemplate = `${input.bodyTemplate}\n\n[Open your speaker portal](${input.portalUrl})`;
    const rendered = renderCfpApplicantMessage(bodyTemplate, input);
    const idempotencyKey = `cfp-thank-you:${input.submissionId}`;
    const templateKey = `cfp-thank-you-${input.policyId}`;

    const existing = await this.#find(input.event.id, idempotencyKey);
    if (existing) return { ...existing, duplicate: true };

    try {
      return await this.#client.$transaction(async (transaction) => {
        const template = await transaction.communicationTemplate.upsert({
          where: { eventId_key: { eventId: input.event.id, key: templateKey } },
          create: { eventId: input.event.id, key: templateKey, name: `CFP thank-you for ${input.event.name}` },
          update: {},
        });
        const templateVersion = await transaction.communicationTemplateVersion.upsert({
          where: {
            templateId_version: { templateId: template.id, version: input.policyVersionNumber },
          },
          create: {
            eventId: input.event.id,
            templateId: template.id,
            version: input.policyVersionNumber,
            subjectTemplate: "Thank you for submitting to {{event.name}}",
            htmlTemplate: bodyTemplate,
          },
          update: {},
        });
        const delivery = await transaction.messageDelivery.create({
          data: {
            eventId: input.event.id,
            templateVersionId: templateVersion.id,
            idempotencyKey,
            recipients: {
              create: {
                recipientKey: `submission:${input.submissionId}:applicant`,
                email: input.recipient.email,
                displayName: input.recipient.name,
                subjectSnapshot: rendered.subject,
                htmlSnapshot: rendered.html,
                textSnapshot: rendered.text ?? rendered.previewMarkdown,
              },
            },
          },
          select: { id: true, recipients: { select: { id: true } } },
        });
        const recipient = delivery.recipients[0];
        if (!recipient) throw new RepositoryError("conflict", "The CFP thank-you recipient was not queued.");
        return { deliveryId: delivery.id, recipientId: recipient.id, duplicate: false };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const duplicate = await this.#find(input.event.id, idempotencyKey);
      if (!duplicate) throw error;
      return { ...duplicate, duplicate: true };
    }
  }

  async #find(eventId: string, idempotencyKey: string): Promise<Omit<QueuedCfpThankYou, "duplicate"> | null> {
    const delivery = await this.#client.messageDelivery.findUnique({
      where: { eventId_idempotencyKey: { eventId, idempotencyKey } },
      select: { id: true, recipients: { take: 1, select: { id: true } } },
    });
    const recipient = delivery?.recipients[0];
    return delivery && recipient ? { deliveryId: delivery.id, recipientId: recipient.id } : null;
  }
}
