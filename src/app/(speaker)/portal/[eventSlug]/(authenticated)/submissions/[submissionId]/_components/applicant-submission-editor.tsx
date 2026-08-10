"use client";

import { useActionState, useMemo, useState } from "react";

import { CircleCheckIcon } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { CfpFormDefinition, CfpQuestion } from "@/lib/cfp";
import { visibleCfpQuestionIds } from "@/lib/cfp";

import { type ApplicantSubmissionActionState, updateApplicantSubmission } from "../actions";

interface ApplicantSubmissionEditorProps {
  readonly eventSlug: string;
  readonly submissionId: string;
  readonly definition: CfpFormDefinition;
  readonly initialAnswers: Readonly<Record<string, unknown>>;
}

type ClientAnswer = boolean | number | string | readonly string[];

const INITIAL_STATE: ApplicantSubmissionActionState = { status: "idle" };

function initialClientAnswers(values: Readonly<Record<string, unknown>>): Readonly<Record<string, ClientAnswer>> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, ClientAnswer] => {
      const value = entry[1];
      return (
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string" ||
        (Array.isArray(value) && value.every((item) => typeof item === "string"))
      );
    }),
  );
}

function QuestionLabel({ question }: { readonly question: CfpQuestion }) {
  return (
    <>
      {question.label}
      {question.required ? (
        <>
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
    </>
  );
}

export function ApplicantSubmissionEditor({
  eventSlug,
  submissionId,
  definition,
  initialAnswers,
}: ApplicantSubmissionEditorProps) {
  const action = updateApplicantSubmission.bind(null, eventSlug, submissionId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [answers, setAnswers] = useState<Readonly<Record<string, ClientAnswer>>>(() =>
    initialClientAnswers(initialAnswers),
  );
  const visibleIds = useMemo(() => visibleCfpQuestionIds(definition, answers), [answers, definition]);

  function setAnswer(questionId: string, value: ClientAnswer): void {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function questionControl(question: CfpQuestion) {
    const name = `answer.${question.id}`;
    const error = state.errors?.[question.id]?.[0];
    const describedBy = [question.description ? `${name}-description` : null, error ? `${name}-error` : null]
      .filter((id) => id !== null)
      .join(" ");
    const common = {
      id: name,
      name,
      "aria-describedby": describedBy === "" ? undefined : describedBy,
      "aria-invalid": error ? true : undefined,
    } as const;
    const answer = answers[question.id];

    if (question.type === "long_text") {
      return (
        <Textarea
          {...common}
          maxLength={question.constraints?.maxLength}
          minLength={question.constraints?.minLength}
          onChange={(event) => setAnswer(question.id, event.target.value)}
          required={question.required}
          value={typeof answer === "string" ? answer : ""}
        />
      );
    }
    if (question.type === "multi_select") {
      return (
        <NativeSelect
          {...common}
          className="w-full"
          multiple
          onChange={(event) =>
            setAnswer(
              question.id,
              Array.from(event.target.selectedOptions, ({ value: selected }) => selected),
            )
          }
          required={question.required}
          value={Array.isArray(answer) ? answer : []}
        >
          {(question.constraints?.options ?? []).map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
    }
    if (question.type === "select") {
      return (
        <FormSelect
          {...common}
          className="w-full"
          onValueChange={(value) => setAnswer(question.id, value)}
          required={question.required}
          value={typeof answer === "string" ? answer : ""}
          placeholder="Select an option"
          options={(question.constraints?.options ?? []).map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      );
    }
    if (question.type === "checkbox") {
      return (
        <Checkbox
          {...common}
          checked={answer === true}
          onCheckedChange={(checked) => setAnswer(question.id, checked === true)}
          required={question.required}
        />
      );
    }

    return (
      <Input
        {...common}
        max={question.constraints?.max}
        maxLength={question.constraints?.maxLength}
        min={question.constraints?.min}
        minLength={question.constraints?.minLength}
        onChange={(event) => setAnswer(question.id, event.target.value)}
        pattern={question.constraints?.pattern}
        required={question.required}
        type={question.type === "short_text" ? "text" : question.type}
        value={typeof answer === "string" || typeof answer === "number" ? answer : ""}
      />
    );
  }

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Edit proposal</CardTitle>
          <CardDescription>You can update your responses until the call for proposals closes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {state.status === "success" ? (
            <Alert>
              <CircleCheckIcon />
              <AlertTitle>Proposal updated</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          {state.status === "error" && state.message ? (
            <Alert variant="destructive">
              <AlertTitle>We could not update your proposal</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          {definition.sections.map((section) => {
            const questions = section.questions.filter(({ id }) => visibleIds.has(id));
            if (questions.length === 0) return null;
            return (
              <section className="flex flex-col gap-4" key={section.id}>
                <div>
                  <h2 className="font-heading font-medium text-base">{section.title}</h2>
                  {section.description ? <p className="text-muted-foreground text-sm">{section.description}</p> : null}
                </div>
                <FieldGroup>
                  {questions.map((question) => {
                    const error = state.errors?.[question.id]?.[0];
                    if (question.type === "checkbox") {
                      return (
                        <Field data-invalid={error ? true : undefined} key={question.id} orientation="horizontal">
                          {questionControl(question)}
                          <FieldContent>
                            <FieldLabel htmlFor={`answer.${question.id}`}>
                              <QuestionLabel question={question} />
                            </FieldLabel>
                            {question.description ? (
                              <FieldDescription id={`answer.${question.id}-description`}>
                                {question.description}
                              </FieldDescription>
                            ) : null}
                            <FieldError id={`answer.${question.id}-error`}>{error}</FieldError>
                          </FieldContent>
                        </Field>
                      );
                    }
                    return (
                      <Field data-invalid={error ? true : undefined} key={question.id}>
                        <FieldLabel htmlFor={`answer.${question.id}`}>
                          <QuestionLabel question={question} />
                        </FieldLabel>
                        {question.description ? (
                          <FieldDescription id={`answer.${question.id}-description`}>
                            {question.description}
                          </FieldDescription>
                        ) : null}
                        {questionControl(question)}
                        <FieldError id={`answer.${question.id}-error`}>{error}</FieldError>
                      </Field>
                    );
                  })}
                </FieldGroup>
              </section>
            );
          })}
        </CardContent>
        <CardFooter>
          <Button disabled={pending} type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Saving changes…" : "Save proposal changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
