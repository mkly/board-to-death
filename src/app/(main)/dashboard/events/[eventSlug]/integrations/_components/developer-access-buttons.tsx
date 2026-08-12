"use client";

import { useTransition } from "react";

import { Ban, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { actionResultToast } from "@/hooks/use-action-toast";

import { disableWebhook, retryDueWebhooks, revokeApiToken } from "../actions";

export function RevokeTokenButton({ eventSlug, tokenId }: { readonly eventSlug: string; readonly tokenId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          actionResultToast(await revokeApiToken(eventSlug, tokenId));
        });
      }}
    >
      {pending ? <Spinner data-icon="inline-start" /> : <Ban data-icon="inline-start" />}
      {pending ? "Revoking…" : "Revoke"}
    </Button>
  );
}

export function DisableWebhookButton({
  endpointId,
  eventSlug,
}: {
  readonly endpointId: string;
  readonly eventSlug: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          actionResultToast(await disableWebhook(eventSlug, endpointId));
        });
      }}
    >
      {pending ? <Spinner data-icon="inline-start" /> : <Ban data-icon="inline-start" />}
      {pending ? "Disabling…" : "Disable"}
    </Button>
  );
}

export function RetryDueWebhooksButton({ eventSlug }: { readonly eventSlug: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          actionResultToast(await retryDueWebhooks(eventSlug));
        });
      }}
    >
      {pending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      {pending ? "Retrying…" : "Retry due deliveries"}
    </Button>
  );
}
