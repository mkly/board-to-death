"use client";

import { type FormEvent, useState } from "react";

import { useRouter } from "next/navigation";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { KeyRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

type ChallengeMethod = "totp" | "backup";
const OTP_SLOTS = [
  { id: "digit-1", index: 0 },
  { id: "digit-2", index: 1 },
  { id: "digit-3", index: 2 },
  { id: "digit-4", index: 3 },
  { id: "digit-5", index: 4 },
  { id: "digit-6", index: 5 },
] as const;

function errorMessage(status: number | undefined): string {
  if (status === 429) return "Too many attempts. Wait 15 minutes before trying again.";
  return "That code is invalid or expired. Request a new sign-in link if the problem continues.";
}

export function TwoFactorChallengeForm({ callbackURL }: { readonly callbackURL: string }) {
  const router = useRouter();
  const [method, setMethod] = useState<ChallengeMethod>("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [isPending, setIsPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    const normalizedCode = code.trim();
    if ((method === "totp" && normalizedCode.length !== 6) || (method === "backup" && !normalizedCode)) {
      setError(method === "totp" ? "Enter the six-digit code from your authenticator." : "Enter a recovery code.");
      return;
    }

    setIsPending(true);
    const result =
      method === "totp"
        ? await authClient.twoFactor.verifyTotp({ code: normalizedCode })
        : await authClient.twoFactor.verifyBackupCode({ code: normalizedCode });
    setIsPending(false);

    if (result.error) {
      setError(errorMessage(result.error.status));
      return;
    }

    router.replace(callbackURL);
    router.refresh();
  }

  function changeMethod(nextMethod: ChallengeMethod) {
    setMethod(nextMethod);
    setCode("");
    setError(undefined);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="two-factor-code">
            {method === "totp" ? "Authenticator code" : "Recovery code"}
          </FieldLabel>
          {method === "totp" ? (
            <InputOTP
              id="two-factor-code"
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              value={code}
              onChange={setCode}
              disabled={isPending}
              aria-invalid={Boolean(error)}
              autoComplete="one-time-code"
              autoFocus
            >
              <InputOTPGroup>
                {OTP_SLOTS.map((slot) => (
                  <InputOTPSlot key={slot.id} index={slot.index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          ) : (
            <Input
              id="two-factor-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={isPending}
              aria-invalid={Boolean(error)}
              autoComplete="one-time-code"
              autoFocus
            />
          )}
          <FieldDescription>
            {method === "totp"
              ? "Open your authenticator app and enter its current code."
              : "Each recovery code works once and is removed after use."}
          </FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={isPending}>
        {isPending && <Spinner data-icon="inline-start" />}
        Verify and continue
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => changeMethod(method === "totp" ? "backup" : "totp")}
        disabled={isPending}
      >
        <KeyRound data-icon="inline-start" />
        {method === "totp" ? "Use a recovery code" : "Use an authenticator code"}
      </Button>
      <Alert>
        <KeyRound />
        <AlertTitle>Lost access to both methods?</AlertTitle>
        <AlertDescription>Contact another administrator to recover access to your account.</AlertDescription>
      </Alert>
    </form>
  );
}
