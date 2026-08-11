"use client";

import { useActionState } from "react";

import Link from "next/link";

import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { requestSignInLink, type SignInActionState } from "../actions";

const INITIAL_STATE: SignInActionState = { status: "idle" };

export function LoginForm({ callbackURL = "/dashboard" }: { readonly callbackURL?: string }) {
  const [state, formAction, isPending] = useActionState(requestSignInLink, INITIAL_STATE);

  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-2 text-center" role="status">
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted-foreground text-sm">
          A single-use sign-in link is on its way. It expires in 10 minutes.
        </p>
      </div>
    );
  }

  const fieldError = state.status === "error" && state.field === "email" ? state.message : undefined;
  const formError = state.status === "error" && !state.field ? state.message : undefined;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="callbackURL" value={callbackURL} />
      {state.status === "unknown-account" && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>We couldn&apos;t find that account</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              No GatherPulse account is registered to {state.email}. Check the address for typos, or create a workspace
              to get started.
            </span>
            <Button asChild size="sm" variant="outline">
              <Link prefetch={false} href={`/auth/v1/register?email=${encodeURIComponent(state.email)}`}>
                Create your workspace
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <FieldGroup className="gap-4">
        <Field className="gap-1.5" data-invalid={Boolean(fieldError)}>
          <FieldLabel htmlFor="login-email">Email address</FieldLabel>
          <Input
            id="login-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            defaultValue={state.status === "unknown-account" ? state.email : undefined}
            aria-invalid={Boolean(fieldError)}
            disabled={isPending}
            required
          />
          <FieldDescription>Use the email address linked to your workspace or event membership.</FieldDescription>
          {fieldError && <FieldError>{fieldError}</FieldError>}
        </Field>
      </FieldGroup>
      {formError && (
        <p className="text-destructive text-sm" role="alert">
          {formError}
        </p>
      )}
      <Button className="w-full" type="submit" disabled={isPending}>
        {isPending && <Spinner data-icon="inline-start" />}
        Email me a sign-in link
      </Button>
    </form>
  );
}
