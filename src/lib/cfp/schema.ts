import { z } from "zod";

/** Structural (shape-only) validation for a CFP form definition. Semantic checks
 * (rule targets, cycles, duplicate ids, ...) run separately in parser.ts. */

const conditionOperatorSchema = z.enum(["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"]);

const conditionSchema = z.object({
  questionId: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.unknown().optional(),
});

const visibilityRuleSchema = z.object({
  logic: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1),
});

const questionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

const questionConstraintsSchema = z.object({
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  options: z.array(questionOptionSchema).optional(),
});

const questionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean(),
  constraints: questionConstraintsSchema.optional(),
  visibleWhen: visibilityRuleSchema.optional(),
});

const sectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["speaker", "questions"]),
  title: z.string().min(1),
  description: z.string().optional(),
  questions: z.array(questionSchema),
});

const categorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

const categoryRoutingRuleSchema = z.object({
  id: z.string().min(1),
  when: visibilityRuleSchema,
  categoryId: z.string().min(1),
});

export const cfpFormDefinitionSchema = z.object({
  version: z.number().int(),
  title: z.string().min(1),
  description: z.string().optional(),
  submissionKind: z.enum(["ABSTRACT", "GUARANTEED_SESSION"]).optional(),
  accessPolicy: z.enum(["OPEN", "RESTRICTED"]).optional(),
  welcomeTitle: z.string().optional(),
  welcomeContent: z.string().optional(),
  instructions: z.string().optional(),
  termsContent: z.string().optional(),
  consentRequired: z.boolean().optional(),
  customQuestionTypes: z.array(z.string().min(1)).optional(),
  categories: z.array(categorySchema).optional(),
  sections: z.array(sectionSchema).min(1),
  categoryRouting: z.array(categoryRoutingRuleSchema).optional(),
});

export type CfpFormDefinitionParsed = z.infer<typeof cfpFormDefinitionSchema>;
