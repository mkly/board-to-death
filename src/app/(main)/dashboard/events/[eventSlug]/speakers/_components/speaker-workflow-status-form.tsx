"use client";

import { useActionState } from "react";

import { FormSelect } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { SpeakerWorkflowStatus } from "@/generated/prisma/client";

import { type UpdateSpeakerWorkflowStatusActionState, updateSpeakerWorkflowStatus } from "../actions";

interface SpeakerWorkflowStatusFormProps {
  readonly eventSlug: string;
  readonly speakerId: string;
  readonly workflowStatus: SpeakerWorkflowStatus;
}

const initialState: UpdateSpeakerWorkflowStatusActionState = { status: "idle" };

const options: readonly { readonly value: SpeakerWorkflowStatus; readonly label: string }[] = [
  { value: "NOT_CONTACTED", label: "Not contacted" },
  { value: "INVITED", label: "Invited" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "DECLINED", label: "Declined" },
];

export function SpeakerWorkflowStatusForm({ eventSlug, speakerId, workflowStatus }: SpeakerWorkflowStatusFormProps) {
  const [state, formAction, pending] = useActionState(
    updateSpeakerWorkflowStatus.bind(null, eventSlug, speakerId),
    initialState,
  );
  const fieldId = `speaker-workflow-status-${speakerId}`;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Field data-invalid={state.status === "error" || undefined}>
        <FieldLabel htmlFor={fieldId} className="sr-only">
          Workflow status
        </FieldLabel>
        <FormSelect
          id={fieldId}
          name="workflowStatus"
          defaultValue={workflowStatus}
          disabled={pending}
          aria-invalid={state.status === "error" || undefined}
          className="w-full sm:w-40"
          options={options}
        />
        {state.status === "error" ? <FieldError>{state.message}</FieldError> : null}
      </Field>
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-fit">
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Save status
      </Button>
      <p aria-live="polite" className="sr-only">
        {state.message}
      </p>
    </form>
  );
}
