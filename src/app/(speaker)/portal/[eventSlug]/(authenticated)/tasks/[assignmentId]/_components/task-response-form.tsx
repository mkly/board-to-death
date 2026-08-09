"use client";

import { useActionState } from "react";

import { CheckCircle2Icon, SaveIcon, SendIcon, UploadIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { PortalFormAnswers, PortalFormDefinition } from "@/lib/portal-forms";
import type { SpeakerTaskResponseKind } from "@/server/speakers";

import type { TaskFormState, TaskSubmissionState } from "../actions";

const initialTaskSubmissionState: TaskSubmissionState = { message: "", status: "idle" };
const initialTaskFormState: TaskFormState = { ok: false, message: "" };

interface TaskResponseFormProps {
  readonly action: (state: TaskSubmissionState, formData: FormData) => Promise<TaskSubmissionState>;
  readonly defaultText?: string;
  readonly kind: SpeakerTaskResponseKind;
  readonly formAction?: (state: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  readonly formDefinition?: PortalFormDefinition;
  readonly formAnswers?: PortalFormAnswers;
}

export function TaskResponseForm({
  action,
  defaultText,
  kind,
  formAction,
  formDefinition,
  formAnswers,
}: TaskResponseFormProps) {
  if (kind === "FORM" && formAction && formDefinition) {
    return <PortalFormResponse action={formAction} definition={formDefinition} initialAnswers={formAnswers ?? {}} />;
  }
  return <PlainTaskResponseForm action={action} defaultText={defaultText} kind={kind} />;
}

interface PlainTaskResponseFormProps {
  readonly action: (state: TaskSubmissionState, formData: FormData) => Promise<TaskSubmissionState>;
  readonly defaultText?: string;
  readonly kind: SpeakerTaskResponseKind;
}

function PlainTaskResponseForm({ action, defaultText, kind }: PlainTaskResponseFormProps) {
  const [state, formAction, pending] = useActionState(action, initialTaskSubmissionState);
  let submitIcon = <SendIcon data-icon="inline-start" />;
  if (pending) submitIcon = <Spinner data-icon="inline-start" />;
  else if (kind === "FILE") submitIcon = <UploadIcon data-icon="inline-start" />;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FieldGroup>
        {kind === "TEXT" ? (
          <Field data-invalid={state.status === "error"}>
            <FieldLabel htmlFor="task-response">Your response</FieldLabel>
            <Textarea
              id="task-response"
              name="response"
              defaultValue={defaultText}
              rows={6}
              maxLength={10_000}
              required
              aria-invalid={state.status === "error"}
            />
            <FieldDescription>Provide the information requested by the event team.</FieldDescription>
          </Field>
        ) : null}
        {kind === "FILE" ? (
          <Field data-invalid={state.status === "error"}>
            <FieldLabel htmlFor="task-file">Response file</FieldLabel>
            <Input
              id="task-file"
              name="file"
              type="file"
              accept=".pdf,.txt,.jpg,.jpeg,.png,.webp"
              required
              aria-invalid={state.status === "error"}
            />
            <FieldDescription>PDF, text, JPEG, PNG, or WebP; 5 MB maximum.</FieldDescription>
          </Field>
        ) : null}
        {kind === "CONFIRMATION" ? (
          <Field orientation="horizontal" data-invalid={state.status === "error"}>
            <Checkbox id="task-approved" name="approved" required aria-invalid={state.status === "error"} />
            <FieldLabel htmlFor="task-approved" className="font-normal">
              I have reviewed the instructions and confirm this task is complete.
            </FieldLabel>
          </Field>
        ) : null}
        {state.status === "error" ? <FieldError>{state.message}</FieldError> : null}
      </FieldGroup>

      {state.status === "success" ? (
        <Alert>
          <CheckCircle2Icon aria-hidden="true" />
          <AlertTitle>Submitted</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="w-fit">
        {submitIcon}
        {pending ? "Submitting…" : "Submit task"}
      </Button>
    </form>
  );
}

interface PortalFormResponseProps {
  readonly action: (state: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  readonly definition: PortalFormDefinition;
  readonly initialAnswers: PortalFormAnswers;
}

function PortalFormResponse({ action, definition, initialAnswers }: PortalFormResponseProps) {
  const [state, formAction, pending] = useActionState(action, initialTaskFormState);
  const submitted = state.submitted === true;
  let alertTitle = "Check your response";
  if (state.ok) alertTitle = submitted ? definition.confirmation.subject : "Saved";

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.message ? (
        <Alert variant={state.ok ? "default" : "destructive"}>
          {state.ok ? <CheckCircle2Icon aria-hidden="true" /> : null}
          <AlertTitle>{alertTitle}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {definition.sections.map((section) => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            {section.instructions ? <CardDescription>{section.instructions}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {section.fields.map((field) => {
                const error = state.errors?.[field.id];
                const answer = initialAnswers[field.id];
                if (field.type === "checkbox") {
                  return (
                    <Field key={field.id} orientation="horizontal" data-invalid={Boolean(error)}>
                      <Checkbox
                        id={field.id}
                        name={field.id}
                        defaultChecked={answer === true}
                        aria-invalid={Boolean(error)}
                        disabled={submitted}
                      />
                      <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor={field.id}>{field.label}</FieldLabel>
                        {field.reusableKey ? <FieldDescription>Reused across assigned forms.</FieldDescription> : null}
                        <FieldError>{error}</FieldError>
                      </div>
                    </Field>
                  );
                }
                const Control = field.type === "textarea" ? Textarea : Input;
                return (
                  <Field key={field.id} data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor={field.id}>{field.label}</FieldLabel>
                    <Control
                      id={field.id}
                      name={field.id}
                      type={field.type === "email" ? "email" : undefined}
                      defaultValue={typeof answer === "string" ? answer : ""}
                      required={field.required}
                      aria-invalid={Boolean(error)}
                      disabled={submitted}
                    />
                    {field.reusableKey ? <FieldDescription>Reused across assigned forms.</FieldDescription> : null}
                    <FieldError>{error}</FieldError>
                  </Field>
                );
              })}
            </FieldGroup>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardFooter className="justify-end gap-2">
          <Button
            type="submit"
            name="intent"
            value="draft"
            variant="outline"
            formNoValidate
            disabled={pending || submitted}
          >
            {pending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            Save draft
          </Button>
          <Button type="submit" name="intent" value="submit" disabled={pending || submitted}>
            <SendIcon data-icon="inline-start" />
            Submit response
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
