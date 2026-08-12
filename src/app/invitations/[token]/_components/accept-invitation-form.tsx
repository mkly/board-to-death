"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";

import { acceptEventInvitation, type InvitationActionState } from "../actions";

const INITIAL_STATE: InvitationActionState = { status: "idle" };

export function AcceptInvitationForm({ token }: { readonly token: string }) {
  const [state, formAction, pending] = useActionState(acceptEventInvitation.bind(null, token), INITIAL_STATE);
  useActionToast(state);

  return (
    <form action={formAction}>
      <Button disabled={pending} type="submit">
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? "Accepting…" : "Accept invitation"}
      </Button>
    </form>
  );
}
