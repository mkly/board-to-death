"use client";

import { useTransition } from "react";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { actionResultToast } from "@/hooks/use-action-toast";

import { createCfpFormDraft } from "../actions";

export function CreateFormButton({
  eventSlug,
  label = "Create form",
}: {
  readonly eventSlug: string;
  readonly label?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      disabled={pending}
      type="button"
      onClick={() =>
        startTransition(async () => {
          // On success the action redirects to the new form's setup page instead of resolving.
          const result = await createCfpFormDraft(eventSlug);
          if (result) actionResultToast(result);
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
      {pending ? "Creating…" : label}
    </Button>
  );
}
