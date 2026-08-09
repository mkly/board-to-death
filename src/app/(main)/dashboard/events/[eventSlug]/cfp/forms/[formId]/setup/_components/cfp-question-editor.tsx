"use client";

import { useActionState, useMemo, useRef, useState } from "react";

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
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CFP_BUILT_IN_QUESTION_TYPES,
  type CfpFormDefinition,
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
  const nextEditorId = useRef(1);
  const [state, formAction, pending] = useActionState(
    async (previousState: SaveCfpQuestionsState, formData: FormData) => {
      const result = await saveCfpQuestions(previousState, formData);
      if (result.status === "success") {
        setSections((current) => [...current]);
      }
      return result;
    },
    INITIAL_SAVE_STATE,
  );
  const draftDefinition = useMemo(() => buildDefinition(definition, sections), [definition, sections]);
  const localValidation = useMemo(() => parseCfpDefinition(draftDefinition), [draftDefinition]);
  const sourceQuestions = useMemo(
    () =>
      sections.flatMap((section) =>
        section.questions.map((question) => ({ ...question, constraints: constraintsFromDraft(question) })),
      ),
    [sections],
  );
  const displayedVersion = state.status === "success" ? (state.versionNumber ?? versionNumber) : versionNumber;

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
    <form action={formAction} className="flex flex-col gap-6">
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
        <Button type="submit" disabled={pending || !localValidation.ok}>
          {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
          {pending ? "Saving..." : "Save questions"}
        </Button>
      </div>

      {!localValidation.ok ? (
        <Alert variant="destructive">
          <AlertTitle>Review the question definition</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 flex list-disc flex-col gap-1">
              {localValidation.errors.map(({ path, message }) => (
                <li key={`${path}-${message}`}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Questions were not saved</AlertTitle>
          <AlertDescription>
            <p>{state.message}</p>
            {state.errors ? (
              <ul className="ml-4 flex list-disc flex-col gap-1">
                {state.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {state.status === "success" ? (
        <Alert>
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
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
                    return (
                      <Card key={question.editorId} size="sm">
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
                            <Field>
                              <FieldLabel htmlFor={`${idPrefix}-label`}>Label</FieldLabel>
                              <Input
                                id={`${idPrefix}-label`}
                                value={question.label}
                                onChange={(event) =>
                                  updateQuestion(section.id, question.editorId, { label: event.target.value })
                                }
                                placeholder="Session title"
                                required
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${idPrefix}-id`}>Stable identifier</FieldLabel>
                              <Input
                                id={`${idPrefix}-id`}
                                value={question.id}
                                onChange={(event) =>
                                  updateQuestion(section.id, question.editorId, { id: event.target.value })
                                }
                                placeholder="session-title"
                                required
                              />
                              <FieldDescription>Unique across this form.</FieldDescription>
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
                                <SelectContent>
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
                              <Field>
                                <FieldLabel htmlFor={`${idPrefix}-custom-type`}>Custom type identifier</FieldLabel>
                                <Input
                                  id={`${idPrefix}-custom-type`}
                                  value={question.type}
                                  onChange={(event) =>
                                    updateQuestion(section.id, question.editorId, { type: event.target.value })
                                  }
                                  placeholder="session_format"
                                  required
                                />
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

                            {["short_text", "long_text", "url", "email"].includes(question.type) ? (
                              <>
                                <Field>
                                  <FieldLabel htmlFor={`${idPrefix}-min-length`}>Minimum length</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-min-length`}
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={question.minLength}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { minLength: event.target.value })
                                    }
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor={`${idPrefix}-max-length`}>Maximum length</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-max-length`}
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={question.maxLength}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { maxLength: event.target.value })
                                    }
                                  />
                                </Field>
                                <Field className="sm:col-span-2">
                                  <FieldLabel htmlFor={`${idPrefix}-pattern`}>Validation pattern</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-pattern`}
                                    value={question.pattern}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { pattern: event.target.value })
                                    }
                                    placeholder="Optional regular expression"
                                  />
                                </Field>
                              </>
                            ) : null}

                            {question.type === "number" ? (
                              <>
                                <Field>
                                  <FieldLabel htmlFor={`${idPrefix}-min`}>Minimum value</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-min`}
                                    type="number"
                                    value={question.min}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { min: event.target.value })
                                    }
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor={`${idPrefix}-max`}>Maximum value</FieldLabel>
                                  <Input
                                    id={`${idPrefix}-max`}
                                    type="number"
                                    value={question.max}
                                    onChange={(event) =>
                                      updateQuestion(section.id, question.editorId, { max: event.target.value })
                                    }
                                  />
                                </Field>
                              </>
                            ) : null}

                            {question.type === "select" || question.type === "multi_select" ? (
                              <Field className="sm:col-span-2">
                                <FieldLabel htmlFor={`${idPrefix}-options`}>Options</FieldLabel>
                                <Textarea
                                  id={`${idPrefix}-options`}
                                  value={question.options}
                                  onChange={(event) =>
                                    updateQuestion(section.id, question.editorId, { options: event.target.value })
                                  }
                                  placeholder={"talk | Talk\nworkshop | Workshop"}
                                  required
                                />
                                <FieldDescription>One option per line as value | Label.</FieldDescription>
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
        {state.status === "idle" ? "Changes are saved as a new immutable form version." : state.message}
      </p>
    </form>
  );
}
