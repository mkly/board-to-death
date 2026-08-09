"use client";

import { useActionState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { type PartnerIntakeActionState, submitPartnerIntake } from "../actions";

const INITIAL_STATE: PartnerIntakeActionState = { status: "idle" };

function fieldErrors(state: PartnerIntakeActionState, field: string) {
  return state.errors?.[field]?.map((message) => ({ message }));
}

export function PublicPartnerIntakeForm({ publicId }: { readonly publicId: string }) {
  const [state, action, pending] = useActionState(submitPartnerIntake.bind(null, publicId), INITIAL_STATE);

  if (state.status === "success") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Thanks for your interest</h2>
          </CardTitle>
          <CardDescription>{state.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Organization and primary contact</h2>
        </CardTitle>
        <CardDescription>
          Your organization will not appear in the event workspace until an admin accepts it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} noValidate>
          <FieldGroup>
            {state.status === "error" && state.message ? (
              <Alert variant="destructive">
                <AlertTitle>We could not submit this form</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={Boolean(state.errors?.organizationName)}>
              <FieldLabel htmlFor="organizationName">Organization name</FieldLabel>
              <Input
                aria-invalid={Boolean(state.errors?.organizationName)}
                autoComplete="organization"
                id="organizationName"
                name="organizationName"
                required
              />
              <FieldError errors={fieldErrors(state, "organizationName")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(state.errors?.contactGivenName)}>
                <FieldLabel htmlFor="contactGivenName">First name</FieldLabel>
                <Input
                  aria-invalid={Boolean(state.errors?.contactGivenName)}
                  autoComplete="given-name"
                  id="contactGivenName"
                  name="contactGivenName"
                  required
                />
                <FieldError errors={fieldErrors(state, "contactGivenName")} />
              </Field>
              <Field data-invalid={Boolean(state.errors?.contactFamilyName)}>
                <FieldLabel htmlFor="contactFamilyName">Last name</FieldLabel>
                <Input
                  aria-invalid={Boolean(state.errors?.contactFamilyName)}
                  autoComplete="family-name"
                  id="contactFamilyName"
                  name="contactFamilyName"
                  required
                />
                <FieldError errors={fieldErrors(state, "contactFamilyName")} />
              </Field>
            </div>
            <Field data-invalid={Boolean(state.errors?.contactEmail)}>
              <FieldLabel htmlFor="contactEmail">Email</FieldLabel>
              <Input
                aria-invalid={Boolean(state.errors?.contactEmail)}
                autoComplete="email"
                id="contactEmail"
                name="contactEmail"
                required
                type="email"
              />
              <FieldDescription>This address becomes the event contact for your organization.</FieldDescription>
              <FieldError errors={fieldErrors(state, "contactEmail")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="contactJobTitle">Job title</FieldLabel>
                <Input autoComplete="organization-title" id="contactJobTitle" name="contactJobTitle" />
              </Field>
              <Field>
                <FieldLabel htmlFor="contactPhone">Phone</FieldLabel>
                <Input autoComplete="tel" id="contactPhone" name="contactPhone" type="tel" />
              </Field>
            </div>
            <Button disabled={pending} type="submit">
              {pending ? "Submitting…" : "Submit for review"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
