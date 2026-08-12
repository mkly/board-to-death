"use client";

import { useActionState } from "react";

import { CheckCircle2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";

import { type SpeakerInterestActionState, submitSpeakerInterest } from "../actions";

const INITIAL_STATE: SpeakerInterestActionState = { status: "idle" };

function fieldError(state: SpeakerInterestActionState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

export function SpeakerInterestForm({ publicId }: { readonly publicId: string }) {
  const [state, action, pending] = useActionState(submitSpeakerInterest.bind(null, publicId), INITIAL_STATE);
  useActionToast(state);

  if (state.status === "success") {
    return (
      <Empty className="min-h-72 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCircle2 />
          </EmptyMedia>
          <EmptyTitle>Interest received</EmptyTitle>
          <EmptyDescription>Thanks for your interest. The event team can now follow up with you.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tell us about yourself</CardTitle>
        <CardDescription>Required fields help the program team identify and contact you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate action={action}>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(fieldError(state, "givenName")) || undefined}>
                <FieldLabel htmlFor="interest-given-name">First name</FieldLabel>
                <Input
                  aria-invalid={Boolean(fieldError(state, "givenName")) || undefined}
                  id="interest-given-name"
                  name="givenName"
                  required
                />
                <FieldError>{fieldError(state, "givenName")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(fieldError(state, "familyName")) || undefined}>
                <FieldLabel htmlFor="interest-family-name">Last name</FieldLabel>
                <Input
                  aria-invalid={Boolean(fieldError(state, "familyName")) || undefined}
                  id="interest-family-name"
                  name="familyName"
                  required
                />
                <FieldError>{fieldError(state, "familyName")}</FieldError>
              </Field>
            </div>
            <Field data-invalid={Boolean(fieldError(state, "email")) || undefined}>
              <FieldLabel htmlFor="interest-email">Email</FieldLabel>
              <Input
                aria-invalid={Boolean(fieldError(state, "email")) || undefined}
                id="interest-email"
                name="email"
                required
                type="email"
              />
              <FieldError>{fieldError(state, "email")}</FieldError>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="interest-organization">Organization</FieldLabel>
                <Input id="interest-organization" maxLength={200} name="organization" />
              </Field>
              <Field>
                <FieldLabel htmlFor="interest-job-title">Job title</FieldLabel>
                <Input id="interest-job-title" maxLength={200} name="jobTitle" />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="interest-phone">Phone</FieldLabel>
              <Input id="interest-phone" maxLength={100} name="phone" type="tel" />
            </Field>
            <Button className="self-start" disabled={pending} type="submit">
              {pending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
              {pending ? "Submitting..." : "Share my interest"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
