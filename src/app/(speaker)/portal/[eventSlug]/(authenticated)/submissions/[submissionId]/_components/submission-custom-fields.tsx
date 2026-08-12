"use client";

import { useActionState } from "react";

import {
  type CustomFieldInputDefinition,
  CustomFieldInputs,
  type CustomFieldInputValue,
} from "@/components/custom-fields/custom-field-inputs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";

import { type SubmissionCustomFieldActionState, saveSubmissionCustomFields } from "../actions";

const INITIAL_STATE: SubmissionCustomFieldActionState = { status: "idle" };

export function SubmissionCustomFields({
  eventSlug,
  submissionId,
  definitions,
  values,
}: {
  readonly eventSlug: string;
  readonly submissionId: string;
  readonly definitions: readonly CustomFieldInputDefinition[];
  readonly values: readonly CustomFieldInputValue[];
}) {
  const action = saveSubmissionCustomFields.bind(null, eventSlug, submissionId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  useActionToast(state);
  if (definitions.length === 0) return null;

  return (
    <Card>
      <form action={formAction}>
        <CardHeader>
          <CardTitle>Additional information</CardTitle>
          <CardDescription>Event-specific details shared with the organizers.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CustomFieldInputs definitions={definitions} errors={state.errors} idPrefix="portal-" values={values} />
        </CardContent>
        <CardFooter>
          <Button disabled={pending} type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Saving…" : "Save additional information"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
