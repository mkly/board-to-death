"use client";

import { type FormEvent, useState } from "react";

import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const formSchema = z.object({
  email: z.email({ message: "Enter a valid email address." }),
  organizationName: z
    .string()
    .trim()
    .min(2, "Enter your organization name.")
    .max(120, "Keep the name under 120 characters."),
});

type FieldErrors = Partial<Record<keyof z.infer<typeof formSchema>, string>>;

export function RegisterForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [isPending, setIsPending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(undefined);

    const formData = new FormData(event.currentTarget);
    const parsed = formSchema.safeParse({
      email: formData.get("email"),
      organizationName: formData.get("organizationName"),
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({ email: fieldErrors.email?.[0], organizationName: fieldErrors.organizationName?.[0] });
      return;
    }

    setIsPending(true);
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    }).catch(() => null);
    setIsPending(false);

    if (!response?.ok) {
      setFormError("We could not send a signup link. Please try again.");
      return;
    }
    setIsSent(true);
  }

  if (isSent) {
    return (
      <div className="flex flex-col gap-2 text-center" role="status">
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted-foreground text-sm">
          A single-use link to finish creating your organization is on its way. It expires in 10 minutes.
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Field className="gap-1.5" data-invalid={Boolean(errors.organizationName)}>
          <FieldLabel htmlFor="register-organization">Organization name</FieldLabel>
          <Input
            id="register-organization"
            name="organizationName"
            placeholder="MeepleCon"
            autoComplete="organization"
            aria-invalid={Boolean(errors.organizationName)}
            disabled={isPending}
            required
          />
          <FieldDescription>This will be the private workspace for your team and events.</FieldDescription>
          {errors.organizationName && <FieldError>{errors.organizationName}</FieldError>}
        </Field>
        <Field className="gap-1.5" data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="register-email">Email address</FieldLabel>
          <Input
            id="register-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            disabled={isPending}
            required
          />
          <FieldDescription>You will become this organization&apos;s owner.</FieldDescription>
          {errors.email && <FieldError>{errors.email}</FieldError>}
        </Field>
      </FieldGroup>
      {formError && (
        <p className="text-destructive text-sm" role="alert">
          {formError}
        </p>
      )}
      <Button className="w-full" type="submit" disabled={isPending}>
        {isPending && <Spinner data-icon="inline-start" />}
        Email me a signup link
      </Button>
    </form>
  );
}
