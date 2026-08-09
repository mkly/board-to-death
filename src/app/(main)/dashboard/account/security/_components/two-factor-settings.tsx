"use client";

import { type FormEvent, useState } from "react";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CheckCircle2, Copy, KeyRound, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

interface EnrollmentDetails {
  readonly totpURI: string;
  readonly secret: string;
  readonly backupCodes: readonly string[];
}

type ManagementAction = "disable" | "regenerate";
const OTP_SLOTS = [
  { id: "digit-1", index: 0 },
  { id: "digit-2", index: 1 },
  { id: "digit-3", index: 2 },
  { id: "digit-4", index: 3 },
  { id: "digit-5", index: 4 },
  { id: "digit-6", index: 5 },
] as const;

function authError(status: number | undefined): string {
  if (status === 429) return "Too many attempts. Wait before trying another code.";
  return "The authenticator code was not accepted. Enter the current code and try again.";
}

function TotpCodeField({
  code,
  error,
  id,
  disabled,
  onChange,
}: {
  readonly code: string;
  readonly error?: string;
  readonly id: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>Authenticator code</FieldLabel>
      <InputOTP
        id={id}
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        value={code}
        onChange={onChange}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        autoComplete="one-time-code"
      >
        <InputOTPGroup>
          {OTP_SLOTS.map((slot) => (
            <InputOTPSlot key={slot.id} index={slot.index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <FieldDescription>Use the current six-digit code. Re-verification expires after five minutes.</FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

function RecoveryCodes({ codes }: { readonly codes: readonly string[] }) {
  async function copyCodes() {
    await navigator.clipboard.writeText(codes.join("\n"));
    toast.success("Recovery codes copied.");
  }

  return (
    <Alert>
      <KeyRound />
      <AlertTitle>Save these single-use recovery codes now</AlertTitle>
      <AlertDescription>
        <p>Store them in a password manager. Regenerating codes invalidates every previous code.</p>
        <ul className="grid gap-1 font-mono sm:grid-cols-2" aria-label="Recovery codes">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={() => void copyCodes()}>
          <Copy data-icon="inline-start" />
          Copy codes
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function TwoFactorSettings({ initiallyEnabled }: { readonly initiallyEnabled: boolean }) {
  const [isEnabled, setIsEnabled] = useState(initiallyEnabled);
  const [enrollment, setEnrollment] = useState<EnrollmentDetails>();
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [isPending, setIsPending] = useState(false);
  const [managementAction, setManagementAction] = useState<ManagementAction>();

  async function beginEnrollment() {
    setError(undefined);
    setIsPending(true);
    const result = await authClient.twoFactor.enable({});
    setIsPending(false);

    if (result.error || !result.data) {
      setError("Two-factor enrollment could not be started. Refresh the page and try again.");
      return;
    }

    const secret = new URL(result.data.totpURI).searchParams.get("secret");
    if (!secret) {
      setError("The authenticator setup key could not be generated.");
      return;
    }

    setEnrollment({ totpURI: result.data.totpURI, secret, backupCodes: result.data.backupCodes });
    setCode("");
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment || code.length !== 6) {
      setError("Enter the six-digit code from your authenticator.");
      return;
    }

    setError(undefined);
    setIsPending(true);
    const result = await authClient.twoFactor.verifyTotp({ code });
    setIsPending(false);
    if (result.error) {
      setError(authError(result.error.status));
      return;
    }

    setIsEnabled(true);
    setRecoveryCodes(enrollment.backupCodes);
    setEnrollment(undefined);
    setCode("");
    toast.success("Two-factor authentication enabled.");
  }

  async function manageTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!managementAction || code.length !== 6) {
      setError("Enter the current six-digit code before continuing.");
      return;
    }

    setError(undefined);
    setIsPending(true);
    const verified = await authClient.twoFactor.verifyTotp({ code });
    if (verified.error) {
      setIsPending(false);
      setError(authError(verified.error.status));
      return;
    }

    if (managementAction === "disable") {
      const result = await authClient.twoFactor.disable({});
      setIsPending(false);
      if (result.error) {
        setError("Two-factor authentication could not be disabled. Verify again and retry.");
        return;
      }
      setIsEnabled(false);
      setRecoveryCodes(undefined);
      setManagementAction(undefined);
      setCode("");
      toast.success("Two-factor authentication disabled.");
      return;
    }

    const result = await authClient.twoFactor.generateBackupCodes({});
    setIsPending(false);
    if (result.error || !result.data) {
      setError("New recovery codes could not be generated. Verify again and retry.");
      return;
    }
    setRecoveryCodes(result.data.backupCodes);
    setManagementAction(undefined);
    setCode("");
    toast.success("Recovery codes regenerated.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authenticator app</CardTitle>
        <CardDescription>
          Require a rotating code after every magic-link sign-in. Recovery codes provide one-time access if the
          authenticator is unavailable.
        </CardDescription>
        <CardAction>
          <Badge variant={isEnabled ? "default" : "secondary"}>{isEnabled ? "Enabled" : "Not enabled"}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <ShieldOff />
            <AlertTitle>Security change failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!isEnabled && !enrollment && (
          <Alert>
            <ShieldCheck />
            <AlertTitle>Add a second sign-in factor</AlertTitle>
            <AlertDescription>
              Enrollment creates a QR code for any standards-compatible authenticator and ten recovery codes.
            </AlertDescription>
          </Alert>
        )}

        {!isEnabled && enrollment && (
          <form noValidate onSubmit={confirmEnrollment} className="flex flex-col gap-5">
            <div className="grid gap-5 md:grid-cols-[auto_1fr] md:items-center">
              <div
                className="rounded-lg bg-background p-3 ring-1 ring-foreground/10"
                role="img"
                aria-label="Authenticator enrollment QR code"
              >
                <QRCodeSVG value={enrollment.totpURI} size={184} aria-hidden="true" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <p className="font-medium">Scan the QR code</p>
                <p className="text-muted-foreground text-sm">
                  If scanning is unavailable, enter this setup key manually in your authenticator:
                </p>
                <code className="break-all rounded-md bg-muted p-2 text-sm">{enrollment.secret}</code>
              </div>
            </div>
            <Separator />
            <FieldGroup>
              <TotpCodeField id="enrollment-code" code={code} error={error} disabled={isPending} onChange={setCode} />
            </FieldGroup>
            <Button type="submit" disabled={isPending}>
              {isPending && <Spinner data-icon="inline-start" />}
              Confirm and enable
            </Button>
          </form>
        )}

        {isEnabled && managementAction && (
          <form noValidate onSubmit={manageTwoFactor} className="flex flex-col gap-4">
            <FieldGroup>
              <TotpCodeField id="management-code" code={code} error={error} disabled={isPending} onChange={setCode} />
            </FieldGroup>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant={managementAction === "disable" ? "destructive" : "default"}
                disabled={isPending}
              >
                {isPending && <Spinner data-icon="inline-start" />}
                {managementAction === "disable" ? "Verify and disable" : "Verify and regenerate"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setManagementAction(undefined)}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {recoveryCodes && <RecoveryCodes codes={recoveryCodes} />}
        {isEnabled && !managementAction && !recoveryCodes && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Your next magic-link sign-in will require an authenticator or recovery code.
          </div>
        )}
      </CardContent>
      {!enrollment && !managementAction && (
        <CardFooter className="flex flex-wrap gap-2">
          {!isEnabled ? (
            <Button type="button" onClick={() => void beginEnrollment()} disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" />}
              Enable two-factor authentication
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setManagementAction("regenerate")}>
                <RefreshCw data-icon="inline-start" />
                Regenerate recovery codes
              </Button>
              <Button type="button" variant="destructive" onClick={() => setManagementAction("disable")}>
                <ShieldOff data-icon="inline-start" />
                Disable two-factor authentication
              </Button>
            </>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
