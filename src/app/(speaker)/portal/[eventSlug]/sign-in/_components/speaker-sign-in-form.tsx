"use client";

import { useActionState, useEffect } from "react";

import { SendIcon } from "lucide-react";
import { toast } from "sonner";

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
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
    } else if (state.status === "error") {
      toast.error(state.message);
    }
  }, [state]);

  return (
    <form noValidate action={formAction}>
      <CardContent>
        <FieldGroup>
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
