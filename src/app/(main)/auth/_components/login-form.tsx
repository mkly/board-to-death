"use client";

import { type FormEvent, useState } from "react";

import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

const emailSchema = z.email({ message: "Enter a valid email address." });

export function LoginForm({ callbackURL = "/dashboard" }: { readonly callbackURL?: string }) {
  const [error, setError] = useState<string>();
  const [isPending, setIsPending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    const formData = new FormData(event.currentTarget);
    const parsedEmail = emailSchema.safeParse(formData.get("email"));
    if (!parsedEmail.success) {
      setError(parsedEmail.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }

    setIsPending(true);
    const result = await authClient.signIn.magicLink({
      email: parsedEmail.data,
      callbackURL,
      errorCallbackURL: "/auth/v1/login?error=invalid-link",
    });
    setIsPending(false);

    if (result.error) {
      setError("We could not send a sign-in link. Please try again.");
      return;
    }

    setIsSent(true);
  }

  if (isSent) {
    return (
      <div className="flex flex-col gap-2 text-center" role="status">
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted-foreground text-sm">
          If that address is linked to an account, a single-use sign-in link is on its way. It expires in 10 minutes.
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Field className="gap-1.5" data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="login-email">Email address</FieldLabel>
          <Input
            id="login-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={Boolean(error)}
            disabled={isPending}
            required
          />
          <FieldDescription>Use the email address linked to your organization or event membership.</FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>
      <Button className="w-full" type="submit" disabled={isPending}>
        {isPending && <Spinner data-icon="inline-start" />}
        Email me a sign-in link
      </Button>
    </form>
  );
}
