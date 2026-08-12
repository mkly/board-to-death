"use client";

import { startTransition, useActionState, useState } from "react";

import Link from "next/link";

import { CalendarPlusIcon, CircleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";

import { promoteSubmissionToSession, type SubmissionPromotionActionState } from "../../actions";

interface SubmissionPromotionControlProps {
  readonly eventSlug: string;
  readonly submissionId: string;
  readonly promotedSessionId?: string | null;
}

const initialState: SubmissionPromotionActionState = { status: "idle" };

export function SubmissionPromotionControl({
  eventSlug,
  submissionId,
  promotedSessionId,
}: SubmissionPromotionControlProps) {
  const [state, formAction, pending] = useActionState(promoteSubmissionToSession, initialState);
  useActionToast(state);
  const [confirming, setConfirming] = useState(false);
  const sessionId = state.status === "success" ? state.sessionId : promotedSessionId;
  const sessionHref = sessionId
    ? `/dashboard/events/${encodeURIComponent(eventSlug)}/sessions?sessionId=${encodeURIComponent(sessionId)}`
    : null;
  const promote = () => {
    const formData = new FormData();
    formData.set("eventSlug", eventSlug);
    formData.set("submissionId", submissionId);
    startTransition(() => formAction(formData));
    setConfirming(false);
  };

  if (sessionHref) {
    return (
      <Alert>
        <CalendarPlusIcon />
        <AlertTitle>Program session ready</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>The accepted proposal is available in Sessions with its title, abstract, category, and speakers.</span>
          <Button asChild size="sm" variant="outline">
            <Link href={sessionHref}>View session</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Button disabled={pending} onClick={() => setConfirming(true)} type="button">
        {pending ? <Spinner data-icon="inline-start" /> : <CalendarPlusIcon data-icon="inline-start" />}
        {pending ? "Promoting..." : "Promote to Session"}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <CircleAlertIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Promote this proposal to a session?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a program session from the accepted proposal's title, abstract, category, and speakers. You
              can edit and schedule it from Sessions afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={promote} type="button">
              Promote to Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
