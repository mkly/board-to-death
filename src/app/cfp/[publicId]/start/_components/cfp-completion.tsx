"use client";

import { useEffect, useState } from "react";

import { ArrowRight, CircleCheck } from "lucide-react";

import { SanitizedMarkdown } from "@/components/content/sanitized-markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface CfpCompletionProps {
  readonly confirmationMarkdown?: string;
  readonly confirmationEmail?: string;
  readonly submissionId?: string;
  readonly portalHref?: string;
  readonly autoRedirectDelaySeconds?: number;
}

export function CfpCompletion({
  confirmationMarkdown,
  confirmationEmail,
  submissionId,
  portalHref,
  autoRedirectDelaySeconds,
}: CfpCompletionProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(autoRedirectDelaySeconds);
  const [redirectCancelled, setRedirectCancelled] = useState(false);

  useEffect(() => {
    if (!portalHref || remainingSeconds === undefined || redirectCancelled) return;
    if (remainingSeconds <= 0) {
      window.location.replace(portalHref);
      return;
    }
    const timer = window.setTimeout(() => setRemainingSeconds((current) => (current ?? 1) - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [portalHref, redirectCancelled, remainingSeconds]);

  return (
    <Alert>
      <CircleCheck />
      <AlertTitle>
        <h2>Proposal submitted</h2>
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-4">
        {confirmationMarkdown ? <SanitizedMarkdown content={confirmationMarkdown} /> : null}
        {confirmationEmail ? <p>A confirmation email has been sent to {confirmationEmail}.</p> : null}
        <p>Keep this reference: {submissionId}</p>
        {portalHref ? (
          <div className="flex flex-col items-start gap-2">
            <Button asChild>
              <a href={portalHref}>
                Continue to speaker portal
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
            {remainingSeconds !== undefined && !redirectCancelled ? (
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
                <p aria-live="polite">Opening the speaker portal in {remainingSeconds} seconds.</p>
                <Button onClick={() => setRedirectCancelled(true)} size="xs" type="button" variant="ghost">
                  Cancel automatic redirect
                </Button>
              </div>
            ) : null}
            {redirectCancelled ? <p className="text-muted-foreground text-sm">Automatic redirect cancelled.</p> : null}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
