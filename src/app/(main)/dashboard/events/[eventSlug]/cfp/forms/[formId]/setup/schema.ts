import { Temporal } from "temporal-polyfill";
import { z } from "zod";

export const CFP_DRAFT_POLICIES = ["DISABLED", "ALLOWED", "REQUIRED"] as const;
export type CfpDraftPolicyValue = (typeof CFP_DRAFT_POLICIES)[number];

export interface CfpPolicySettingsFields {
  readonly submissionOpensAt: string;
  readonly submissionClosesAt: string;
  readonly draftPolicy: CfpDraftPolicyValue;
  readonly maxSubmissionsPerSpeaker: number;
  readonly maxParticipantsPerSubmission: number;
}

export interface CfpPolicySettingsValidation {
  readonly fields?: CfpPolicySettingsFields & {
    readonly submissionOpensAtInstant: Date;
    readonly submissionClosesAtInstant: Date;
  };
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const settingsSchema = z.object({
  submissionOpensAt: z.string().min(1, "Choose when submissions open."),
  submissionClosesAt: z.string().min(1, "Choose when submissions close."),
  draftPolicy: z.enum(CFP_DRAFT_POLICIES, { message: "Choose a supported draft policy." }),
  maxSubmissionsPerSpeaker: z.coerce
    .number()
    .int("Use a whole number of submissions.")
    .min(1, "Allow at least one submission per speaker.")
    .max(100, "Allow no more than 100 submissions per speaker."),
  maxParticipantsPerSubmission: z.coerce
    .number()
    .int("Use a whole number of participants.")
    .min(1, "Allow at least one participant per submission.")
    .max(100, "Allow no more than 100 participants per submission."),
});

function instantFromLocalDateTime(value: string, timezone: string): Date | null {
  try {
    const instant = Temporal.PlainDateTime.from(value)
      .toZonedDateTime(timezone, { disambiguation: "reject" })
      .toInstant();
    return new Date(instant.epochMilliseconds);
  } catch {
    return null;
  }
}

export function validateCfpPolicySettings(input: unknown, timezone: string): CfpPolicySettingsValidation {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const submissionOpensAtInstant = instantFromLocalDateTime(parsed.data.submissionOpensAt, timezone);
  const submissionClosesAtInstant = instantFromLocalDateTime(parsed.data.submissionClosesAt, timezone);
  const errors: Record<string, string[]> = {};
  if (!submissionOpensAtInstant) errors.submissionOpensAt = [`Enter a valid date and time in ${timezone}.`];
  if (!submissionClosesAtInstant) errors.submissionClosesAt = [`Enter a valid date and time in ${timezone}.`];
  if (submissionOpensAtInstant && submissionClosesAtInstant && submissionClosesAtInstant <= submissionOpensAtInstant) {
    errors.submissionClosesAt = ["Submissions must close after they open."];
  }
  if (Object.keys(errors).length > 0 || !submissionOpensAtInstant || !submissionClosesAtInstant) return { errors };

  return { fields: { ...parsed.data, submissionOpensAtInstant, submissionClosesAtInstant } };
}
