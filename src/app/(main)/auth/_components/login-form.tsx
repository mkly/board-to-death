"use client";

import { useActionState, useEffect } from "react";

import Link from "next/link";

import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { requestSignInLink, type SignInActionState } from "../actions";

const INITIAL_STATE: SignInActionState = { status: "idle" };

export function LoginForm({ callbackURL = "/dashboard" }: { readonly callbackURL?: string }) {
  const [state, formAction, isPending] = useActionState(requestSignInLink, INITIAL_STATE);

  useEffect(() => {
    if (state.status === "sent") {
      toast.success("Check your inbox", {
        description: "A single-use sign-in link is on its way. It expires in 10 minutes.",
      });
    } else if (state.status === "unknown-account") {
      toast.error("We couldn't find that account", {
        description: `No GatherPulse account is registered to ${state.email}. Check the email address for typos, or create a workspace to get started.`,
      });
    } else if (state.status === "error" && state.message) {
      toast.error(state.message);
    }
  }, [state]);

  const fieldError = state.status === "error" && state.field === "email" ? state.message : undefined;
  const formError = state.status === "error" && !state.field ? state.message : undefined;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="callbackURL" value={callbackURL} />
      {state.status === "unknown-account" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-destructive text-sm">
            <TriangleAlertIcon aria-hidden="true" className="inline-block size-4" />
            <span className="ml-2">No GatherPulse account is registered to {state.email}. Create one to continue.</span>
          </p>
          <Button asChild size="sm" variant="outline">
            <Link prefetch={false} href={`/auth/v1/register?email=${encodeURIComponent(state.email)}`}>
              Create your workspace
            </Link>
          </Button>
        </div>
      ) : null}
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
