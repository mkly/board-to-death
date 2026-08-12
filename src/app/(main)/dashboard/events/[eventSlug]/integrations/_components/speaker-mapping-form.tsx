"use client";

import { useActionState } from "react";

import { FormSelect, type FormSelectOption } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";

import { type SpeakerMappingActionState, saveSpeakerMapping } from "../actions";

const INITIAL_STATE: SpeakerMappingActionState = { status: "idle" };

const mappingFields = ["email", "firstName", "lastName"] as const;

const fieldLabels: Record<(typeof mappingFields)[number], string> = {
  email: "Remote email",
  firstName: "Remote first name",
  lastName: "Remote last name",
};

export function SpeakerMappingForm({
  eventSlug,
  mapping,
  versionNumber,
  sourceOptions,
}: {
  readonly eventSlug: string;
  readonly mapping: Readonly<Record<(typeof mappingFields)[number], string>>;
  readonly versionNumber: number;
  readonly sourceOptions: readonly FormSelectOption[];
}) {
  const [state, formAction, pending] = useActionState(saveSpeakerMapping.bind(null, eventSlug), INITIAL_STATE);
  useActionToast(state);

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Public speaker field mapping</CardTitle>
          <CardDescription>
            Mapping version {versionNumber}. Saving creates a new immutable version and refreshes the preview.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 md:grid-cols-3">
            {mappingFields.map((field) => (
              <Field key={field}>
                <FieldLabel htmlFor={`speaker-mapping-${field}`}>{fieldLabels[field]}</FieldLabel>
                <FormSelect
                  id={`speaker-mapping-${field}`}
                  name={field}
                  defaultValue={mapping[field]}
                  required
                  options={sourceOptions}
                />
                <FieldDescription>Required by the Accelevents speaker contract.</FieldDescription>
              </Field>
            ))}
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button disabled={pending} type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Saving…" : "Save mapping and refresh preview"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
