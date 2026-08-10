"use client";

import { useActionState } from "react";

import { SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { type ResendSpeakerLinkActionState, resendSpeakerPortalLink } from "../actions";

const INITIAL_STATE: ResendSpeakerLinkActionState = { status: "idle" };

export function ResendSpeakerLinkForm({
  eventSlug,
  speakerId,
}: {
  readonly eventSlug: string;
  readonly speakerId: string;
}) {
  const [state, formAction, pending] = useActionState(
    resendSpeakerPortalLink.bind(null, eventSlug, speakerId),
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <Button disabled={pending} type="submit" variant="outline">
        {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
        {pending ? "Sending..." : "Send sign-in link"}
      </Button>
      <p
        aria-live="polite"
        className={cn("text-sm", state.status === "error" ? "text-destructive" : "text-muted-foreground")}
      >
        {state.message}
      </p>
    </form>
  );
}
