import { Temporal } from "temporal-polyfill";

import {
  EMAIL_TEMPLATE_VARIABLES,
  type EmailTemplateIssue,
  type EmailTemplateVariable,
  validateEmailTemplate,
} from "../communications/email-templates.ts";

export const CFP_MESSAGE_VARIABLES = EMAIL_TEMPLATE_VARIABLES.filter(({ key }) =>
  ["event.name", "event.start_date", "event.location", "recipient.name", "recipient.email", "session.title"].includes(
    key,
  ),
);

export const CFP_MESSAGE_VARIABLE_KEYS = CFP_MESSAGE_VARIABLES.map(
  ({ key }) => key,
) as readonly EmailTemplateVariable[];

export const DEFAULT_REMINDER_DAYS = 3;
export const DEFAULT_REMINDER_SEND_AT_MINUTE = 540;
export const DEFAULT_PORTAL_REDIRECT_DELAY_SECONDS = 10;

export interface CfpMessageSettings {
  readonly portalAutoRedirect: boolean;
  readonly portalRedirectDelaySeconds: number;
  readonly remindersEnabled: boolean;
  readonly reminderDaysBeforeClose: number;
  readonly reminderSendAtMinute: number;
  readonly submissionConfirmation: string;
  readonly thankYou: string;
}

export interface CfpMessageSettingsInput {
  readonly portalAutoRedirect: boolean;
  readonly portalRedirectDelaySeconds: string;
  readonly remindersEnabled: boolean;
  readonly reminderDaysBeforeClose: string;
  readonly reminderSendAt: string;
  readonly submissionConfirmation: string;
  readonly thankYou: string;
}

export type CfpMessageSettingsValidationResult =
  | { readonly fields: CfpMessageSettings; readonly errors: Readonly<Record<string, readonly string[]>> }
  | { readonly fields: null; readonly errors: Readonly<Record<string, readonly string[]>> };

function addError(errors: Record<string, string[]>, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message];
}

function addTemplateErrors(
  errors: Record<string, string[]>,
  field: "submissionConfirmation" | "thankYou",
  issues: readonly EmailTemplateIssue[],
): void {
  for (const issue of issues) addError(errors, field, issue.message);
}

function validateMessage(field: "submissionConfirmation" | "thankYou", bodyTemplate: string) {
  return validateEmailTemplate(
    {
      key: `cfp-${field.toLowerCase()}`,
      name: field,
      subjectTemplate: "Message from {{event.name}}",
      bodyTemplate,
    },
    { allowedVariables: CFP_MESSAGE_VARIABLE_KEYS },
  );
}

function parseSendAtMinute(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  try {
    const time = Temporal.PlainTime.from(value);
    return time.hour * 60 + time.minute;
  } catch {
    return null;
  }
}

export function reminderTimeFromMinute(value: number): string {
  const hour = Math.floor(value / 60)
    .toString()
    .padStart(2, "0");
  const minute = (value % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

export function validateCfpMessageSettings(input: CfpMessageSettingsInput): CfpMessageSettingsValidationResult {
  const errors: Record<string, string[]> = {};
  const confirmation = validateMessage("submissionConfirmation", input.submissionConfirmation);
  const thankYou = validateMessage("thankYou", input.thankYou);
  if (!confirmation.ok) addTemplateErrors(errors, "submissionConfirmation", confirmation.issues);
  if (!thankYou.ok) addTemplateErrors(errors, "thankYou", thankYou.issues);

  const days = Number(input.reminderDaysBeforeClose);
  const portalRedirectDelaySeconds = Number(input.portalRedirectDelaySeconds);
  const sendAtMinute = parseSendAtMinute(input.reminderSendAt);
  if (input.remindersEnabled) {
    if (!Number.isSafeInteger(days) || days < 1 || days > 90) {
      addError(errors, "reminderDaysBeforeClose", "Choose a whole number from 1 to 90 days.");
    }
    if (sendAtMinute === null) {
      addError(errors, "reminderSendAt", "Choose a valid reminder time.");
    }
  }
  if (
    input.portalAutoRedirect &&
    (!Number.isSafeInteger(portalRedirectDelaySeconds) ||
      portalRedirectDelaySeconds < 5 ||
      portalRedirectDelaySeconds > 60)
  ) {
    addError(errors, "portalRedirectDelaySeconds", "Choose a whole number from 5 to 60 seconds.");
  }

  if (!confirmation.ok || !thankYou.ok || Object.keys(errors).length > 0) return { fields: null, errors };
  // Disabled reminders still round-trip whatever timing the form carried, so turning reminders back
  // on restores the administrator's last choice instead of silently reverting to the defaults.
  const retainedDays = Number.isSafeInteger(days) && days >= 1 && days <= 90 ? days : DEFAULT_REMINDER_DAYS;
  const retainedPortalDelay =
    Number.isSafeInteger(portalRedirectDelaySeconds) &&
    portalRedirectDelaySeconds >= 5 &&
    portalRedirectDelaySeconds <= 60
      ? portalRedirectDelaySeconds
      : DEFAULT_PORTAL_REDIRECT_DELAY_SECONDS;
  return {
    fields: {
      portalAutoRedirect: input.portalAutoRedirect,
      portalRedirectDelaySeconds: retainedPortalDelay,
      remindersEnabled: input.remindersEnabled,
      reminderDaysBeforeClose: retainedDays,
      reminderSendAtMinute: sendAtMinute ?? DEFAULT_REMINDER_SEND_AT_MINUTE,
      submissionConfirmation: confirmation.definition.bodyTemplate,
      thankYou: thankYou.definition.bodyTemplate,
    },
    errors,
  };
}
