"use client";

import { useActionState } from "react";

import { CheckCircle2Icon, SendIcon, UploadIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { SpeakerTaskResponseKind } from "@/server/speakers";

import type { TaskSubmissionState } from "../actions";

const initialTaskSubmissionState: TaskSubmissionState = { message: "", status: "idle" };

interface TaskResponseFormProps {
  readonly action: (state: TaskSubmissionState, formData: FormData) => Promise<TaskSubmissionState>;
  readonly defaultText?: string;
  readonly kind: SpeakerTaskResponseKind;
}

export function TaskResponseForm({ action, defaultText, kind }: TaskResponseFormProps) {
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
