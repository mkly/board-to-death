"use client";

import { useActionState } from "react";

import { CircleCheckIcon, SendIcon, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { requestSpeakerSignInLink, type SpeakerSignInActionState } from "../actions";

const INITIAL_STATE: SpeakerSignInActionState = { status: "idle" };

export function SpeakerSignInForm({ eventSlug }: { readonly eventSlug: string }) {
  const [state, formAction, pending] = useActionState(requestSpeakerSignInLink.bind(null, eventSlug), INITIAL_STATE);
  const invalid = state.status === "error";

  return (
    <form noValidate action={formAction}>
      <CardContent>
        <FieldGroup>
          {state.status === "success" ? (
            <Alert>
              <CircleCheckIcon aria-hidden="true" />
              <AlertTitle>Check your inbox</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          {invalid ? (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Link not requested</AlertTitle>
              <AlertDescription>Enter a valid email address and try again.</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="speaker-sign-in-email">Email address</FieldLabel>
            <Input
              aria-invalid={invalid || undefined}
              autoComplete="email"
              id="speaker-sign-in-email"
              name="email"
              placeholder="you@example.com"
              required
              type="email"
            />
            <FieldDescription>Use the address your event organizer has on your speaker profile.</FieldDescription>
            <FieldError>{invalid ? state.message : null}</FieldError>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button disabled={pending} type="submit">
          {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          {pending ? "Sending..." : "Email me a sign-in link"}
        </Button>
      </CardFooter>
    </form>
  );
}
