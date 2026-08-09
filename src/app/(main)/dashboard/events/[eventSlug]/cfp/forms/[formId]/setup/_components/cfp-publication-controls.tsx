"use client";

import { useActionState, useEffect, useState } from "react";

import { Check, Clipboard, ExternalLink, Eye, LockKeyhole, LockKeyholeOpen, Send } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { CfpPolicyStatus } from "@/generated/prisma/client";
import { type CfpFormDefinition, publicCfpHref } from "@/lib/cfp";

import { type UpdateCfpPublicationState, updateCfpPublication } from "../actions";
import { CfpFormPreview } from "./cfp-form-preview";

const INITIAL_STATE: UpdateCfpPublicationState = { status: "idle" };

function statusLabel(status: CfpPolicyStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function SubmitPublicationAction({
  icon: Icon,
  intent,
  label,
  pendingLabel,
  variant = "default",
}: {
  readonly icon: typeof Send;
  readonly intent: "publish" | "close" | "reopen";
  readonly label: string;
  readonly pendingLabel: string;
  readonly variant?: "default" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="intent" value={intent} variant={variant} disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function CfpPublicationControls({
  definition,
  eventName,
  eventSlug,
  formId,
  policy,
  versionNumber,
}: {
  readonly definition: CfpFormDefinition;
  readonly eventName: string;
  readonly eventSlug: string;
  readonly formId: string;
  readonly policy: { readonly publicId: string; readonly status: CfpPolicyStatus } | null;
  readonly versionNumber: number;
}) {
  const [copyMessage, setCopyMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(
    updateCfpPublication.bind(null, eventSlug, formId, versionNumber),
    INITIAL_STATE,
  );
  const publicPath = policy ? publicCfpHref(policy.publicId) : null;

  useEffect(() => {
    if (state.status === "success") setConfirming(false);
  }, [state]);

  const copyLink = async () => {
    if (!publicPath) return;
    try {
      await navigator.clipboard.writeText(new URL(publicPath, window.location.origin).toString());
      setCopyMessage("Public form link copied to clipboard.");
    } catch {
      setCopyMessage("The link could not be copied. Open the public form and copy it from the address bar.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview and publication</CardTitle>
        <CardDescription>
          Review the saved version applicants will receive, then manage its public state.
        </CardDescription>
        <CardAction>
          <Badge variant={policy?.status === "PUBLISHED" ? "default" : "secondary"}>
            {policy ? statusLabel(policy.status) : "Not configured"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.status !== "idle" ? (
          <Alert variant={state.status === "error" ? "destructive" : "default"}>
            {state.status === "success" ? <Check /> : null}
            <AlertTitle>
              {state.status === "error" ? "Publication could not be updated" : "Publication updated"}
            </AlertTitle>
            <AlertDescription>
              <p>{state.message}</p>
              {state.errors ? (
                <ul className="mt-2 list-disc pl-4">
                  {state.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {publicPath && policy?.status !== "DRAFT" ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-sm">Stable public URL</p>
            <code className="break-all rounded-md bg-muted px-3 py-2 text-sm">{publicPath}</code>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                <Clipboard data-icon="inline-start" />
                Copy link
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={publicPath} target="_blank" rel="noreferrer">
                  <ExternalLink data-icon="inline-start" />
                  Open public form
                </a>
              </Button>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {copyMessage}
            </p>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              <Eye data-icon="inline-start" />
              Preview saved form
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Saved form preview</DialogTitle>
              <DialogDescription>Version {versionNumber}. Unsaved field changes are not included.</DialogDescription>
            </DialogHeader>
            <div className="no-scrollbar -mx-4 max-h-[70vh] overflow-y-auto px-4">
              <CfpFormPreview definition={definition} eventName={eventName} />
            </div>
          </DialogContent>
        </Dialog>

        {policy?.status === "DRAFT" ? (
          <form action={formAction}>
            <SubmitPublicationAction icon={Send} intent="publish" label="Publish form" pendingLabel="Publishing…" />
          </form>
        ) : null}

        {policy?.status === "PUBLISHED" || policy?.status === "CLOSED" ? (
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger asChild>
              <Button variant={policy.status === "PUBLISHED" ? "destructive" : "default"}>
                {policy.status === "PUBLISHED" ? (
                  <LockKeyhole data-icon="inline-start" />
                ) : (
                  <LockKeyholeOpen data-icon="inline-start" />
                )}
                {policy.status === "PUBLISHED" ? "Close form" : "Reopen form"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {policy.status === "PUBLISHED" ? "Close this CFP form?" : "Reopen this CFP form?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {policy.status === "PUBLISHED"
                    ? "New responses will stop. The stable public URL can be reopened later."
                    : "The same published definition and public URL will accept responses again."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <form action={formAction}>
                  <SubmitPublicationAction
                    icon={policy.status === "PUBLISHED" ? LockKeyhole : LockKeyholeOpen}
                    intent={policy.status === "PUBLISHED" ? "close" : "reopen"}
                    label={policy.status === "PUBLISHED" ? "Close form" : "Reopen form"}
                    pendingLabel={policy.status === "PUBLISHED" ? "Closing…" : "Reopening…"}
                    variant={policy.status === "PUBLISHED" ? "destructive" : "default"}
                  />
                </form>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </CardFooter>
    </Card>
  );
}
