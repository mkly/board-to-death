"use client";

import { useActionState } from "react";

import { KeyRound, RadioTower } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiTokenScopes, webhookEventTypes } from "@/server/developer-api/contracts";

import { createWebhookEndpoint, type DeveloperAccessActionState, issueApiToken } from "../actions";

const initialState: DeveloperAccessActionState = { status: "idle" };

function ResultAlert({ state }: { readonly state: DeveloperAccessActionState }) {
  if (state.status === "idle") return null;
  return (
    <Alert variant={state.status === "error" ? "destructive" : "default"}>
      {state.status === "error" ? <RadioTower /> : <KeyRound />}
      <AlertTitle>{state.status === "error" ? "Could not save" : "Secret created"}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{state.message}</span>
        {state.secret ? (
          <code className="break-all rounded-md bg-muted p-3 text-foreground">{state.secret}</code>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function ApiTokenForm({ eventSlug }: { readonly eventSlug: string }) {
  const [state, action, pending] = useActionState(issueApiToken, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="api-token-name">Token name</FieldLabel>
          <Input id="api-token-name" name="name" placeholder="Conference website" required />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Read scopes</FieldLegend>
          <FieldGroup className="grid gap-3 sm:grid-cols-3">
            {apiTokenScopes.map((scope) => (
              <Field key={scope} orientation="horizontal">
                <Checkbox id={`scope-${scope}`} name="scopes" value={scope} defaultChecked />
                <FieldLabel htmlFor={`scope-${scope}`} className="font-normal">
                  {scope}
                </FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
      <ResultAlert state={state} />
      <Button type="submit" disabled={pending}>
        <KeyRound data-icon="inline-start" />
        {pending ? "Issuing…" : "Issue token"}
      </Button>
    </form>
  );
}

export function WebhookEndpointForm({ eventSlug }: { readonly eventSlug: string }) {
  const [state, action, pending] = useActionState(createWebhookEndpoint, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="webhook-name">Endpoint name</FieldLabel>
          <Input id="webhook-name" name="name" placeholder="Automation service" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="webhook-url">Endpoint URL</FieldLabel>
          <Input id="webhook-url" name="url" type="url" placeholder="https://example.com/webhooks" required />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Events</FieldLegend>
          <FieldGroup className="grid gap-3">
            {webhookEventTypes.map((eventType) => (
              <Field key={eventType} orientation="horizontal">
                <Checkbox id={`event-${eventType}`} name="events" value={eventType} defaultChecked />
                <FieldLabel htmlFor={`event-${eventType}`} className="font-normal">
                  {eventType}
                </FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
      <ResultAlert state={state} />
      <Button type="submit" disabled={pending}>
        <RadioTower data-icon="inline-start" />
        {pending ? "Registering…" : "Register endpoint"}
      </Button>
    </form>
  );
}
