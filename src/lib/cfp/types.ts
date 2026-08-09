/** Public types for the versioned CFP JSON form definition. */

export const CFP_BUILT_IN_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "select",
  "multi_select",
  "checkbox",
  "number",
  "url",
  "email",
  "date",
] as const;

export type CfpBuiltInQuestionType = (typeof CFP_BUILT_IN_QUESTION_TYPES)[number];

/** Any built-in type, or a custom type declared in `customQuestionTypes`. */
export type CfpQuestionType = CfpBuiltInQuestionType | string;

export type CfpConditionOperator = "equals" | "not_equals" | "in" | "not_in" | "is_empty" | "is_not_empty";

export interface CfpCondition {
  questionId: string;
  operator: CfpConditionOperator;
  value?: unknown;
}

/** A group of conditions combined with "all" (AND) or "any" (OR) logic. */
export interface CfpVisibilityRule {
  logic: "all" | "any";
  conditions: CfpCondition[];
}

export interface CfpQuestionOption {
  value: string;
  label: string;
}

export interface CfpQuestionConstraints {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: CfpQuestionOption[];
}

export interface CfpQuestion {
  id: string;
  type: CfpQuestionType;
  label: string;
  description?: string;
  required: boolean;
  constraints?: CfpQuestionConstraints;
  /** The question is hidden unless this rule evaluates to true. */
  visibleWhen?: CfpVisibilityRule;
}

export type CfpSectionKind = "speaker" | "questions";

export type CfpSubmissionKind = "ABSTRACT" | "GUARANTEED_SESSION";

export type CfpAccessPolicy = "OPEN" | "RESTRICTED";

export const CFP_REQUIRED_SPEAKER_FIELDS = ["biography", "contact", "consent"] as const;

export type CfpRequiredSpeakerField = (typeof CFP_REQUIRED_SPEAKER_FIELDS)[number];

export interface CfpSection {
  id: string;
  kind: CfpSectionKind;
  title: string;
  description?: string;
  questions: CfpQuestion[];
}

export interface CfpCategory {
  id: string;
  label: string;
}

export interface CfpCategoryRoutingRule {
  id: string;
  when: CfpVisibilityRule;
  categoryId: string;
}

export interface CfpFormDefinition {
  version: number;
  title: string;
  description?: string;
  submissionKind?: CfpSubmissionKind;
  accessPolicy?: CfpAccessPolicy;
  welcomeTitle?: string;
  welcomeContent?: string;
  instructions?: string;
  termsContent?: string;
  consentRequired?: boolean;
  minimumSpeakerCount?: number;
  maximumSpeakerCount?: number;
  requiredSpeakerFields?: CfpRequiredSpeakerField[];
  /** Question type identifiers beyond CFP_BUILT_IN_QUESTION_TYPES that this definition may use. */
  customQuestionTypes?: string[];
  categories?: CfpCategory[];
  sections: CfpSection[];
  categoryRouting?: CfpCategoryRoutingRule[];
}

export const CFP_SUPPORTED_VERSIONS = [1] as const;
