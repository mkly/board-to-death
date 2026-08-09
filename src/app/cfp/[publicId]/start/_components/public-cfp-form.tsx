"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { CfpDraftPolicy } from "@/generated/prisma/client";
import type { CfpFormDefinition, CfpQuestion } from "@/lib/cfp";
import { publicCfpStartHref, visibleCfpQuestionIds } from "@/lib/cfp";

import {
  type PublicCfpFormActionState,
  type SaveCfpDraftActionState,
  saveCfpDraft,
  submitPublicCfpForm,
} from "../actions";
import { PublicCfpSpeakers } from "./public-cfp-speakers";

interface PublicCfpFormProps {
  readonly publicId: string;
  readonly definition: CfpFormDefinition;
  readonly submissionKey: string;
  readonly draftPolicy: CfpDraftPolicy;
  readonly draftToken?: string;
  readonly draftError?: string | null;
  readonly formVersionChanged?: boolean;
  readonly initialAnswers?: Readonly<Record<string, unknown>>;
  readonly initialParticipants?: readonly Record<string, string>[];
}

type ClientAnswer = boolean | string | readonly string[];

const INITIAL_STATE: PublicCfpFormActionState = { status: "idle" };
const INITIAL_DRAFT_STATE: SaveCfpDraftActionState = { status: "idle" };

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

export function PublicCfpForm({
  publicId,
  definition,
  submissionKey,
  draftPolicy,
  draftToken,
  draftError,
  formVersionChanged,
  initialAnswers,
  initialParticipants,
}: PublicCfpFormProps) {
  const action = submitPublicCfpForm.bind(null, publicId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const draftSaveAction = saveCfpDraft.bind(null, publicId);
  const [draftState, draftFormAction, draftPending] = useActionState(draftSaveAction, INITIAL_DRAFT_STATE);
  const [answers, setAnswers] = useState<Readonly<Record<string, ClientAnswer>>>(
    () => (initialAnswers as Readonly<Record<string, ClientAnswer>> | undefined) ?? {},
  );
  const [currentDraftToken, setCurrentDraftToken] = useState<string | undefined>(draftToken);
  const visibleIds = useMemo(() => visibleCfpQuestionIds(definition, answers), [answers, definition]);
  const draftsEnabled = draftPolicy !== "DISABLED";

  useEffect(() => {
    if (draftState.status === "success" && draftState.token) {
      setCurrentDraftToken(draftState.token);
    }
  }, [draftState]);

  function setAnswer(questionId: string, value: ClientAnswer): void {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function submitForm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const isDraftSave = submitter?.value === "save-draft";
    startTransition(() => (isDraftSave ? draftFormAction(formData) : formAction(formData)));
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

    if (question.type === "long_text") {
      const answer = answers[question.id];
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
    if (question.type === "select" || question.type === "multi_select") {
      const multiple = question.type === "multi_select";
      const answer = answers[question.id];
      let value: string | readonly string[] = "";
      if (multiple && Array.isArray(answer)) value = answer;
      else if (!multiple && typeof answer === "string") value = answer;
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
          value={value}
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
    const answer = answers[question.id];
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
        value={typeof answer === "string" ? answer : ""}
      />
    );
  }

  if (state.status === "success") {
    return (
      <Alert>
        <AlertTitle>
          <h2>Proposal submitted</h2>
        </AlertTitle>
        <AlertDescription>
          Your proposal is now ready for review. Keep this reference: {state.submissionId}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" onSubmit={submitForm}>
      <input name="submissionKey" type="hidden" value={submissionKey} />
      <input name="draftToken" readOnly type="hidden" value={currentDraftToken ?? ""} />

      {draftError ? (
        <Alert>
          <AlertTitle>Draft link unavailable</AlertTitle>
          <AlertDescription>{draftError}</AlertDescription>
        </Alert>
      ) : null}

      {formVersionChanged ? (
        <Alert>
          <AlertTitle>This form has changed</AlertTitle>
          <AlertDescription>
            The form was updated since you last saved. Review your responses before submitting — some questions may have
            changed.
          </AlertDescription>
        </Alert>
      ) : null}

      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertTitle>We could not submit your proposal</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {draftState.status === "error" && draftState.message ? (
        <Alert variant="destructive">
          <AlertTitle>We could not save your draft</AlertTitle>
          <AlertDescription>{draftState.message}</AlertDescription>
        </Alert>
      ) : null}

      {draftState.status === "success" && draftState.token ? (
        <Alert>
          <AlertTitle>Draft saved</AlertTitle>
          <AlertDescription>
            Resume this response later with this link:{" "}
            <a className="underline" href={publicCfpStartHref(publicId, draftState.token)}>
              {publicCfpStartHref(publicId, draftState.token)}
            </a>
          </AlertDescription>
        </Alert>
      ) : null}

      <PublicCfpSpeakers definition={definition} initialParticipants={initialParticipants} state={state} />

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
                          <FieldError errors={errorsFor(state, question.id)} id={`answer.${question.id}-error`} />
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
                      <FieldError errors={errorsFor(state, question.id)} id={`answer.${question.id}-error`} />
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
              <Checkbox
                aria-describedby={state.errors?.consent ? "consent-error" : undefined}
                aria-invalid={state.errors?.consent ? true : undefined}
                id="consent"
                name="consent"
                required
              />
              <FieldLabel htmlFor="consent">I agree to the terms and consent to this submission.</FieldLabel>
            </Field>
            <FieldError errors={errorsFor(state, "consent")} id="consent-error" />
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button className="self-start" disabled={pending || draftPending} size="lg" type="submit">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? "Submitting proposal…" : "Submit proposal"}
        </Button>
        {draftsEnabled ? (
          <Button
            className="self-start"
            disabled={pending || draftPending}
            formNoValidate
            size="lg"
            type="submit"
            value="save-draft"
            variant="outline"
          >
            {draftPending ? <Spinner data-icon="inline-start" /> : null}
            {draftPending ? "Saving draft…" : "Save draft for later"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
