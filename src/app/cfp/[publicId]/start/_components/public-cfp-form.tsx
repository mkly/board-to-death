"use client";

import { useActionState, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { CfpFormDefinition, CfpQuestion } from "@/lib/cfp";
import { visibleCfpQuestionIds } from "@/lib/cfp";

import { type PublicCfpFormActionState, submitPublicCfpForm } from "../actions";

interface PublicCfpFormProps {
  readonly publicId: string;
  readonly definition: CfpFormDefinition;
}

type ClientAnswer = boolean | string | readonly string[];

const INITIAL_STATE: PublicCfpFormActionState = { status: "idle" };

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

function errorsFor(state: PublicCfpFormActionState, questionId: string) {
  return state.errors?.[questionId]?.map((message) => ({ message }));
}

export function PublicCfpForm({ publicId, definition }: PublicCfpFormProps) {
  const action = submitPublicCfpForm.bind(null, publicId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [answers, setAnswers] = useState<Readonly<Record<string, ClientAnswer>>>({});
  const visibleIds = useMemo(() => visibleCfpQuestionIds(definition, answers), [answers, definition]);

  function setAnswer(questionId: string, value: ClientAnswer): void {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function questionControl(question: CfpQuestion) {
    const name = `answer.${question.id}`;
    const error = state.errors?.[question.id]?.[0];
    const common = {
      id: name,
      name,
      "aria-describedby": question.description ? `${name}-description` : undefined,
      "aria-invalid": error ? true : undefined,
    } as const;

    if (question.type === "long_text") {
      return (
        <Textarea
          {...common}
          maxLength={question.constraints?.maxLength}
          minLength={question.constraints?.minLength}
          onChange={(event) => setAnswer(question.id, event.target.value)}
          required={question.required}
        />
      );
    }
    if (question.type === "select" || question.type === "multi_select") {
      const multiple = question.type === "multi_select";
      return (
        <NativeSelect
          {...common}
          className="w-full"
          multiple={multiple}
          onChange={(event) =>
            setAnswer(
              question.id,
              multiple ? Array.from(event.target.selectedOptions, ({ value }) => value) : event.target.value,
            )
          }
          required={question.required}
        >
          {!multiple ? <NativeSelectOption value="">Select an option</NativeSelectOption> : null}
          {(question.constraints?.options ?? []).map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
    }
    if (question.type === "checkbox") {
      return (
        <Checkbox
          {...common}
          checked={answers[question.id] === true}
          onCheckedChange={(checked) => setAnswer(question.id, checked === true)}
          required={question.required}
        />
      );
    }

    const type = question.type === "short_text" ? "text" : question.type;
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
        type={type}
      />
    );
  }

  if (state.status === "success") {
    return (
      <Alert>
        <AlertTitle>
          <h2>Responses saved</h2>
        </AlertTitle>
        <AlertDescription>
          Your submission draft is ready. Keep this reference for the next step: {state.submissionId}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertTitle>We could not save your responses</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {definition.sections.map((section) => {
        const questions = section.questions.filter(({ id }) => visibleIds.has(id));
        if (questions.length === 0) return null;
        return (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle>
                <h2>{section.title}</h2>
              </CardTitle>
              {section.description ? <CardDescription>{section.description}</CardDescription> : null}
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {questions.map((question) => {
                  const error = state.errors?.[question.id]?.[0];
                  const isCheckbox = question.type === "checkbox";
                  if (isCheckbox) {
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
                          <FieldError errors={errorsFor(state, question.id)} />
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
                      <FieldError errors={errorsFor(state, question.id)} />
                    </Field>
                  );
                })}
              </FieldGroup>
            </CardContent>
          </Card>
        );
      })}

      {definition.consentRequired ? (
        <Card size="sm">
          <CardContent>
            <Field data-invalid={state.errors?.consent ? true : undefined} orientation="horizontal">
              <Checkbox aria-invalid={state.errors?.consent ? true : undefined} id="consent" name="consent" required />
              <FieldLabel htmlFor="consent">I agree to the terms and consent to this submission.</FieldLabel>
            </Field>
            <FieldError errors={errorsFor(state, "consent")} />
          </CardContent>
        </Card>
      ) : null}

      <Button className="self-start" disabled={pending} size="lg" type="submit">
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? "Saving responses…" : "Save responses"}
      </Button>
    </form>
  );
}
