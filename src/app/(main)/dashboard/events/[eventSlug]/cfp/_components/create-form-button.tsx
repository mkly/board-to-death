"use client";

import { Plus } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { createCfpFormDraft } from "../actions";

function SubmitButton({ label }: { readonly label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
      {pending ? "Creating…" : label}
    </Button>
  );
}

export function CreateFormButton({
  eventSlug,
  label = "Create form",
}: {
  readonly eventSlug: string;
  readonly label?: string;
}) {
  const createDraft = createCfpFormDraft.bind(null, eventSlug);

  return (
    <form action={createDraft}>
      <SubmitButton label={label} />
    </form>
  );
}
