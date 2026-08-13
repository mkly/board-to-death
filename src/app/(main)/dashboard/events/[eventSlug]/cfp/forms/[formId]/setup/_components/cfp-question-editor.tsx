"use client";

import { type SubmitEvent, useActionState, useMemo, useRef, useState } from "react";

import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/hooks/use-action-toast";
import {
  CFP_BUILT_IN_QUESTION_TYPES,
  type CfpFormDefinition,
  type CfpParseError,
  type CfpQuestion,
  type CfpQuestionConstraints,
  parseCfpDefinition,
} from "@/lib/cfp";

import { type SaveCfpQuestionsState, saveCfpQuestions } from "../actions";
import { CfpVisibilityRuleEditor } from "./cfp-visibility-rule-editor";

interface DraftQuestion {
  readonly editorId: string;
  readonly originalId: string | null;
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly minLength: string;
  readonly maxLength: string;
  readonly min: string;
  readonly max: string;
  readonly pattern: string;
  readonly options: string;
  readonly visibleWhen: CfpQuestion["visibleWhen"];
}

interface DraftSection {
  readonly id: string;
  readonly questions: readonly DraftQuestion[];
}

interface CfpQuestionEditorProps {
  readonly eventSlug: string;
  readonly formId: string;
  readonly versionNumber: number;
  readonly definition: CfpFormDefinition;
}

const INITIAL_SAVE_STATE: SaveCfpQuestionsState = { status: "idle" };
const CUSTOM_TYPE_VALUE = "__custom__";
const TYPE_LABELS: Readonly<Record<string, string>> = {
  short_text: "Short text",
  long_text: "Long text",
  select: "Single select",
  multi_select: "Multi-select",
  checkbox: "Checkbox",
  number: "Number",
  url: "URL",
  email: "Email",
  date: "Date",
};
const BUILT_IN_TYPES = new Set<string>(CFP_BUILT_IN_QUESTION_TYPES);

function optionLines(question: CfpQuestion): string {
  return question.constraints?.options?.map(({ label, value }) => `${value} | ${label}`).join("\n") ?? "";
}

function toDraftQuestion(question: CfpQuestion, editorId: string): DraftQuestion {
  return {
    editorId,
    originalId: question.id,
    id: question.id,
    type: question.type,
    label: question.label,
    description: question.description ?? "",
    required: question.required,
    minLength: question.constraints?.minLength?.toString() ?? "",
    maxLength: question.constraints?.maxLength?.toString() ?? "",
    min: question.constraints?.min?.toString() ?? "",
    max: question.constraints?.max?.toString() ?? "",
    pattern: question.constraints?.pattern ?? "",
    options: optionLines(question),
    visibleWhen: question.visibleWhen,
  };
}

function initialSections(definition: CfpFormDefinition): DraftSection[] {
  return definition.sections.map((section, sectionIndex) => ({
    id: section.id,
    questions: section.questions.map((question, questionIndex) =>
      toDraftQuestion(question, `${sectionIndex}-${questionIndex}-${question.id}`),
    ),
  }));
}

function newQuestion(editorId: string): DraftQuestion {
  return {
    editorId,
    originalId: null,
    id: "",
    type: "short_text",
    label: "",
    description: "",
    required: false,
    minLength: "",
    maxLength: "",
    min: "",
    max: "",
    pattern: "",
    options: "",
    visibleWhen: undefined,
  };
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

function optionsFromLines(value: string): { value: string; label: string }[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawValue, ...rawLabel] = line.split("|");
      const optionValue = rawValue?.trim() ?? "";
      const label = rawLabel.join("|").trim();
      return { value: optionValue, label: label || optionValue };
    });
}

function constraintsFromDraft(question: DraftQuestion): CfpQuestionConstraints | undefined {
  const constraints: CfpQuestionConstraints = {};
  if (["short_text", "long_text", "url", "email"].includes(question.type)) {
    constraints.minLength = optionalNumber(question.minLength);
    constraints.maxLength = optionalNumber(question.maxLength);
    if (question.pattern.trim()) constraints.pattern = question.pattern.trim();
  } else if (question.type === "number") {
    constraints.min = optionalNumber(question.min);
    constraints.max = optionalNumber(question.max);
  } else if (question.type === "select" || question.type === "multi_select") {
    constraints.options = optionsFromLines(question.options);
  }
  return Object.keys(constraints).length === 0 ? undefined : constraints;
}

function buildDefinition(definition: CfpFormDefinition, sections: readonly DraftSection[]): CfpFormDefinition {
  const questionIds = new Set(sections.flatMap((section) => section.questions.map((question) => question.id)));
  const renamedQuestionIds = new Map(
    sections.flatMap((section) =>
      section.questions.flatMap((question) =>
        question.originalId ? [[question.originalId, question.id] as const] : [],
      ),
    ),
  );
  const rewriteRule = (rule: NonNullable<CfpQuestion["visibleWhen"]>) => ({
    ...rule,
    conditions: rule.conditions.map((condition) => ({
      ...condition,
      questionId: renamedQuestionIds.get(condition.questionId) ?? condition.questionId,
    })),
  });
  const ruleHasTargets = (rule: NonNullable<CfpQuestion["visibleWhen"]>) =>
    rule.conditions.every(({ questionId }) => questionIds.has(questionId));
  const usedCustomTypes = sections
    .flatMap((section) => section.questions.map((question) => question.type))
    .filter((type) => type !== "" && !BUILT_IN_TYPES.has(type));
  const customQuestionTypes = [...new Set([...(definition.customQuestionTypes ?? []), ...usedCustomTypes])];

  return {
    ...definition,
    ...(customQuestionTypes.length === 0 ? { customQuestionTypes: undefined } : { customQuestionTypes }),
    sections: definition.sections.map((section) => {
      const draftSection = sections.find(({ id }) => id === section.id);
      return {
        ...section,
        questions: (draftSection?.questions ?? []).map((question) => {
          const visibleWhen = question.visibleWhen ? rewriteRule(question.visibleWhen) : undefined;
          return {
            id: question.id.trim(),
            type: question.type.trim(),
            label: question.label.trim(),
            ...(question.description.trim() ? { description: question.description.trim() } : {}),
            required: question.required,
            ...(constraintsFromDraft(question) ? { constraints: constraintsFromDraft(question) } : {}),
            ...(visibleWhen ? { visibleWhen } : {}),
          };
        }),
      };
    }),
    ...(definition.categoryRouting
      ? {
          categoryRouting: definition.categoryRouting
            .map((rule) => ({ ...rule, when: rewriteRule(rule.when) }))
            .filter((rule) => ruleHasTargets(rule.when)),
        }
      : {}),
  };
}

type QuestionFieldKey =
  | "label"
  | "id"
  | "type"
  | "options"
  | "pattern"
  | "minLength"
  | "maxLength"
  | "min"
  | "max"
  | "visibleWhen";

function questionFieldKey(remainder: string, message: string): QuestionFieldKey | null {
  if (remainder === "label") return "label";
  if (remainder === "id") return "id";
  if (remainder === "type") return "type";
  if (remainder.startsWith("visibleWhen")) return "visibleWhen";
  if (remainder.startsWith("constraints.options")) return "options";
  if (remainder === "constraints.pattern") return "pattern";
  if (remainder === "constraints.minLength") return "minLength";
  if (remainder === "constraints.maxLength") return "maxLength";
  if (remainder === "constraints.min") return "min";
  if (remainder === "constraints.max") return "max";
  if (remainder === "constraints") return message.includes("Length") ? "minLength" : "min";
  return null;
}

function humanizeQuestionError(field: QuestionFieldKey, error: CfpParseError): string {
  if (error.code === "malformed_definition") {
    if (field === "label") return "Enter a label.";
    if (field === "id") return "Enter an identifier.";
    if (field === "type") return "Enter a type identifier.";
    if (field === "options") return "Enter one option per line as value | Label.";
    if (field === "visibleWhen") return "Complete this visibility rule.";
  }
  if (error.code === "duplicate_id") {
    if (field === "id") return "Another question already uses this identifier.";
    if (field === "options") return "Option values must be unique.";
  }
  if (error.code === "impossible_rule") {
    if (field === "options") return "Add at least one option.";
    if (field === "minLength") return "Minimum length can't exceed maximum length.";
    if (field === "min") return "Minimum value can't exceed maximum value.";
  }
  if (error.code === "missing_rule_target") {
    return "This rule references a question that no longer exists.";
  }
  if (error.code === "cyclic_rule") {
    return "This rule forms a loop with other questions' visibility rules.";
  }
  return error.message;
}

/** Groups parse errors by the draft question and editor field they belong to,
 * so each message renders next to the input that fixes it. Errors that do not
 * map to an editable field fall back to the general list. */
function indexQuestionErrors(
  errors: readonly CfpParseError[],
  definition: CfpFormDefinition,
  sections: readonly DraftSection[],
): { byQuestion: Map<string, Map<QuestionFieldKey, string>>; general: string[] } {
  const byQuestion = new Map<string, Map<QuestionFieldKey, string>>();
  const general: string[] = [];

  for (const error of errors) {
    const match = /^sections\.(\d+)\.questions\.(\d+)\.(.+)$/.exec(error.path);
    const sectionId = match ? definition.sections[Number(match[1])]?.id : undefined;
    const question = sectionId ? sections.find(({ id }) => id === sectionId)?.questions[Number(match?.[2])] : undefined;
    const field = match ? questionFieldKey(match[3] ?? "", error.message) : null;
    if (!question || !field) {
      general.push(error.message);
      continue;
    }
    const fields = byQuestion.get(question.editorId) ?? new Map<QuestionFieldKey, string>();
    if (!fields.has(field)) fields.set(field, humanizeQuestionError(field, error));
    byQuestion.set(question.editorId, fields);
  }

  return { byQuestion, general };
}

function questionTypeValue(question: DraftQuestion): string {
  return BUILT_IN_TYPES.has(question.type) ? question.type : CUSTOM_TYPE_VALUE;
}

function questionTypeDescription(type: string): string {
  if (type === "select" || type === "multi_select") return "Enter one option per line as value | Label.";
  if (type === "checkbox") return "A single yes-or-no choice.";
  if (type === "date") return "A calendar date without a time.";
  if (!BUILT_IN_TYPES.has(type)) return "A project-specific type declared with this form version.";
  return "Configure optional validation limits below.";
}

export function CfpQuestionEditor({ eventSlug, formId, versionNumber, definition }: CfpQuestionEditorProps) {
  const [sections, setSections] = useState<DraftSection[]>(() => initialSections(definition));
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);
  const nextEditorId = useRef(1);
  const [state, formAction, pending] = useActionState(
    async (previousState: SaveCfpQuestionsState, formData: FormData) => {
      const result = await saveCfpQuestions(previousState, formData);
      if (result.status === "success") {
        setSections((current) => [...current]);
        setTouched(new Set());
        setShowAllErrors(false);
      }
      return result;
    },
    INITIAL_SAVE_STATE,
  );
  useActionToast(state);
  const draftDefinition = useMemo(() => buildDefinition(definition, sections), [definition, sections]);
  const localValidation = useMemo(() => parseCfpDefinition(draftDefinition), [draftDefinition]);
  const questionErrors = useMemo(
    () => indexQuestionErrors(localValidation.errors, definition, sections),
    [localValidation, definition, sections],
  );
  const sourceQuestions = useMemo(
    () =>
      sections.flatMap((section) =>
        section.questions.map((question) => ({ ...question, constraints: constraintsFromDraft(question) })),
      ),
    [sections],
  );
  const displayedVersion = state.status === "success" ? (state.versionNumber ?? versionNumber) : versionNumber;

  const markTouched = (editorId: string, field: QuestionFieldKey) => {
    setTouched((current) => {
      if (current.has(`${editorId}:${field}`)) return current;
      return new Set(current).add(`${editorId}:${field}`);
    });
  };

  const errorFor = (editorId: string, field: QuestionFieldKey): string | undefined =>
    showAllErrors || touched.has(`${editorId}:${field}`)
      ? questionErrors.byQuestion.get(editorId)?.get(field)
      : undefined;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    if (localValidation.ok) return;
    event.preventDefault();
    setShowAllErrors(true);
    const firstInvalid = sections
      .flatMap((section) => section.questions)
      .find((question) => questionErrors.byQuestion.has(question.editorId));
    if (firstInvalid) {
      document
        .getElementById(`question-card-${firstInvalid.editorId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const updateQuestion = (sectionId: string, editorId: string, update: Partial<DraftQuestion>) => {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: section.questions.map((question) =>
                question.editorId === editorId ? { ...question, ...update } : question,
              ),
            }
          : section,
      ),
    );
  };

  const addQuestion = (sectionId: string) => {
    const editorId = `new-${nextEditorId.current}`;
    nextEditorId.current += 1;
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId ? { ...section, questions: [...section.questions, newQuestion(editorId)] } : section,
      ),
    );
  };

  const removeQuestion = (sectionId: string, editorId: string) => {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? { ...section, questions: section.questions.filter((question) => question.editorId !== editorId) }
          : section,
      ),
    );
  };

  const moveQuestion = (sectionId: string, questionIndex: number, direction: -1 | 1) => {
    setSections((current) =>
      current.map((section) => {
        if (section.id !== sectionId) return section;
        const destination = questionIndex + direction;
        if (destination < 0 || destination >= section.questions.length) return section;
        const questions = [...section.questions];
        [questions[questionIndex], questions[destination]] = [questions[destination], questions[questionIndex]];
        return { ...section, questions };
      }),
    );
  };

  return (
    // No HTML constraint attributes here: validation is Zod-driven so the global FormSubmitValidator leaves this form alone.
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="definition" value={JSON.stringify(draftDefinition)} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="font-heading font-medium text-xl">Questions</h2>
            <Badge variant="outline">Version {displayedVersion}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Build the ordered speaker and proposal fields applicants complete.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {pending ? "Saving..." : "Save and continue"}
          </Button>
          {showAllErrors && !localValidation.ok ? (
            <p role="alert" className="text-destructive text-sm">
              Fix the highlighted fields to save.
            </p>
          ) : null}
        </div>
      </div>

      {showAllErrors && questionErrors.general.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Resolve these issues to save</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 flex list-disc flex-col gap-1">
              {questionErrors.general.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {definition.sections.map((section) => {
        const draftSection = sections.find(({ id }) => id === section.id);
        const questions = draftSection?.questions ?? [];
        return (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>
                {section.description ?? `Configure the ordered fields in this ${section.kind} step.`}
              </CardDescription>
              <CardAction>
                <Button type="button" size="sm" variant="outline" onClick={() => addQuestion(section.id)}>
                  <Plus data-icon="inline-start" />
                  Add question
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {questions.length === 0 ? (
                <Empty className="py-8">
                  <EmptyHeader>
                    <EmptyTitle>No questions in this step</EmptyTitle>
                    <EmptyDescription>
                      Add a field when this step should collect applicant information.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="flex flex-col gap-4">
                  {questions.map((question, questionIndex) => {
                    const idPrefix = `question-${question.editorId}`;
                    const isCustomType = !BUILT_IN_TYPES.has(question.type);
                    const fieldError = (field: QuestionFieldKey) => errorFor(question.editorId, field);
                    const questionFields = questionErrors.byQuestion.get(question.editorId);
                    const hasVisibleError = [...(questionFields?.keys() ?? [])].some((field) =>
                      Boolean(fieldError(field)),
                    );
                    return (
                      <Card
                        key={question.editorId}
                        id={`question-card-${question.editorId}`}
                        size="sm"
                        className={hasVisibleError ? "border-destructive/50" : undefined}
                      >
                        <CardHeader>
                          <CardTitle>{question.label || `Question ${questionIndex + 1}`}</CardTitle>
                          <CardDescription>
                            {TYPE_LABELS[question.type] ?? (question.type || "Choose a question type")}
                          </CardDescription>
                          <CardAction>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Move ${question.label || `question ${questionIndex + 1}`} up`}
                                disabled={questionIndex === 0}
                                onClick={() => moveQuestion(section.id, questionIndex, -1)}
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Move ${question.label || `question ${questionIndex + 1}`} down`}
                                disabled={questionIndex === questions.length - 1}
                                onClick={() => moveQuestion(section.id, questionIndex, 1)}
                              >
                                <ArrowDown />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Remove ${question.label || `question ${questionIndex + 1}`}`}
                                  >
                                    <Trash2 />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove this question?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This removes the field from the new form version. Existing submissions keep their
                                      original version and answers.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      variant="destructive"
                                      onClick={() => removeQuestion(section.id, question.editorId)}
                                    >
                                      Remove question
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </CardAction>
                        </CardHeader>
                        <CardContent>
                          <FieldGroup className="sm:grid sm:grid-cols-2">
                            <Field data-invalid={Boolean(fieldError("label")) || undefined}>
                              <FieldLabel htmlFor={`${idPrefix}-label`}>Label</FieldLabel>
                              <Input
                                id={`${idPrefix}-label`}
                                value={question.label}
                                onChange={(event) =>
                                  updateQuestion(section.id, question.editorId, { label: event.target.value })
                                }
                                onBlur={() => markTouched(question.editorId, "label")}
                                aria-invalid={Boolean(fieldError("label")) || undefined}
                                placeholder="Session title"
                                aria-required="true"
                              />
                              <FieldError>{fieldError("label")}</FieldError>
                            </Field>
                            <Field data-invalid={Boolean(fieldError("id")) || undefined}>
                              <FieldLabel htmlFor={`${idPrefix}-id`}>Stable identifier</FieldLabel>
                              <Input
                                id={`${idPrefix}-id`}
                                value={question.id}
                                onChange={(event) =>
                                  updateQuestion(section.id, question.editorId, { id: event.target.value })
                                }
                                onBlur={() => markTouched(question.editorId, "id")}
                                aria-invalid={Boolean(fieldError("id")) || undefined}
                                placeholder="session-title"
                                aria-required="true"
                              />
                              <FieldDescription>Unique across this form.</FieldDescription>
                              <FieldError>{fieldError("id")}</FieldError>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${idPrefix}-type`}>Answer type</FieldLabel>
                              <Select
                                value={questionTypeValue(question)}
                                onValueChange={(type) =>
                                  updateQuestion(section.id, question.editorId, {
                                    type: type === CUSTOM_TYPE_VALUE ? "" : type,
                                  })
                                }
                              >
                                <SelectTrigger id={`${idPrefix}-type`} className="w-full">
                                  <SelectValue placeholder="Choose a type" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectGroup>
                                    {CFP_BUILT_IN_QUESTION_TYPES.map((type) => (
                                      <SelectItem key={type} value={type}>
                                        {TYPE_LABELS[type]}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value={CUSTOM_TYPE_VALUE}>Custom type</SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                              <FieldDescription>{questionTypeDescription(question.type)}</FieldDescription>
                            </Field>
                            {isCustomType ? (
                              <Field data-invalid={Boolean(fieldError("type")) || undefined}>
                                <FieldLabel htmlFor={`${idPrefix}-custom-type`}>Custom type identifier</FieldLabel>
                                <Input
                                  id={`${idPrefix}-custom-type`}
                                  value={question.type}
                                  onChange={(event) =>
                                    updateQuestion(section.id, question.editorId, { type: event.target.value })
                                  }
                                  onBlur={() => markTouched(question.editorId, "type")}
                                  aria-invalid={Boolean(fieldError("type")) || undefined}
                                  placeholder="session_format"
                                  aria-required="true"
                                />
                                <FieldError>{fieldError("type")}</FieldError>
                              </Field>
                            ) : null}
                            <Field className="sm:col-span-2">
                              <FieldLabel htmlFor={`${idPrefix}-description`}>Help text</FieldLabel>
                              <Textarea
                                id={`${idPrefix}-description`}
                                value={question.description}
                                onChange={(event) =>
                                  updateQuestion(section.id, question.editorId, { description: event.target.value })
                                }
                                placeholder="Explain what a useful answer includes."
                              />
                            </Field>
                            <Field orientation="horizontal" className="sm:col-span-2">
                              <FieldTitle id={`${idPrefix}-required-label`}>Required answer</FieldTitle>
                              <Switch
                                aria-labelledby={`${idPrefix}-required-label`}
                                checked={question.required}
                                onCheckedChange={(required) =>
                                  updateQuestion(section.id, question.editorId, { required })
                                }
                              />
                            </Field>

                            <CfpVisibilityRuleEditor
                              idPrefix={idPrefix}
                              questionEditorId={question.editorId}
                              rule={question.visibleWhen}
                              sourceQuestions={sourceQuestions}
                              onChange={(visibleWhen) => updateQuestion(section.id, question.editorId, { visibleWhen })}
                            />
                            {fieldError("visibleWhen") ? (
                              <FieldError className="sm:col-span-2">{fieldError("visibleWhen")}</FieldError>
                            ) : null}

                            {["short_text", "long_text", "url", "email"].includes(question.type) ? (
                              <>
                                <Field data-invalid={Boolean(fieldError("minLength")) || undefined}>
                                  <FieldLabel htmlFor={`${idPrefix}-min-length`}>Minimum length</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-min-length`}
                                    type="number"
                                    inputMode="numeric"
                                    step="1"
                                    value={question.minLength}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { minLength: event.target.value })
                                    }
                                    onBlur={() => markTouched(question.editorId, "minLength")}
                                    aria-invalid={Boolean(fieldError("minLength")) || undefined}
                                  />
                                  <FieldError>{fieldError("minLength")}</FieldError>
                                </Field>
                                <Field data-invalid={Boolean(fieldError("maxLength")) || undefined}>
                                  <FieldLabel htmlFor={`${idPrefix}-max-length`}>Maximum length</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-max-length`}
                                    type="number"
                                    inputMode="numeric"
                                    step="1"
                                    value={question.maxLength}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { maxLength: event.target.value })
                                    }
                                    onBlur={() => markTouched(question.editorId, "maxLength")}
                                    aria-invalid={Boolean(fieldError("maxLength")) || undefined}
                                  />
                                  <FieldError>{fieldError("maxLength")}</FieldError>
                                </Field>
                                <Field
                                  className="sm:col-span-2"
                                  data-invalid={Boolean(fieldError("pattern")) || undefined}
                                >
                                  <FieldLabel htmlFor={`${idPrefix}-pattern`}>Validation pattern</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-pattern`}
                                    value={question.pattern}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { pattern: event.target.value })
                                    }
                                    onBlur={() => markTouched(question.editorId, "pattern")}
                                    aria-invalid={Boolean(fieldError("pattern")) || undefined}
                                    placeholder="Optional regular expression"
                                  />
                                  <FieldError>{fieldError("pattern")}</FieldError>
                                </Field>
                              </>
                            ) : null}

                            {question.type === "number" ? (
                              <>
                                <Field data-invalid={Boolean(fieldError("min")) || undefined}>
                                  <FieldLabel htmlFor={`${idPrefix}-min`}>Minimum value</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-min`}
                                    type="number"
                                    value={question.min}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { min: event.target.value })
                                    }
                                    onBlur={() => markTouched(question.editorId, "min")}
                                    aria-invalid={Boolean(fieldError("min")) || undefined}
                                  />
                                  <FieldError>{fieldError("min")}</FieldError>
                                </Field>
                                <Field data-invalid={Boolean(fieldError("max")) || undefined}>
                                  <FieldLabel htmlFor={`${idPrefix}-max`}>Maximum value</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-max`}
                                    type="number"
                                    value={question.max}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { max: event.target.value })
                                    }
                                    onBlur={() => markTouched(question.editorId, "max")}
                                    aria-invalid={Boolean(fieldError("max")) || undefined}
                                  />
                                  <FieldError>{fieldError("max")}</FieldError>
                                </Field>
                              </>
                            ) : null}

                            {question.type === "select" || question.type === "multi_select" ? (
                              <Field
                                className="sm:col-span-2"
                                data-invalid={Boolean(fieldError("options")) || undefined}
                              >
                                <FieldLabel htmlFor={`${idPrefix}-options`}>Options</FieldLabel>
                                <Textarea
                                  id={`${idPrefix}-options`}
                                  value={question.options}
                                  onChange={(event) =>
                                    updateQuestion(section.id, question.editorId, { options: event.target.value })
                                  }
                                  onBlur={() => markTouched(question.editorId, "options")}
                                  aria-invalid={Boolean(fieldError("options")) || undefined}
                                  placeholder={"talk | Talk\nworkshop | Workshop"}
                                  aria-required="true"
                                />
                                <FieldDescription>One option per line as value | Label.</FieldDescription>
                                <FieldError>{fieldError("options")}</FieldError>
                              </Field>
                            ) : null}
                          </FieldGroup>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <p aria-live="polite" className="text-muted-foreground text-sm">
        Changes are saved as a new immutable form version.
      </p>
    </form>
  );
}
