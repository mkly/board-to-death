import { format } from "date-fns";
import { KeyRound, RadioTower } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { DisableWebhookButton, RetryDueWebhooksButton, RevokeTokenButton } from "./developer-access-buttons";
import { ApiTokenForm, WebhookEndpointForm } from "./developer-access-forms";

interface TokenView {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

interface EndpointView {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly disabledAt: string | null;
}

interface DeliveryView {
  readonly id: string;
  readonly endpointId: string;
  readonly eventType: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly responseStatus: number | null;
  readonly error: string | null;
  readonly nextAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly createdAt: string;
}

interface DeveloperAccessWorkspaceProps {
  readonly event: { readonly id: string; readonly name: string; readonly slug: string };
  readonly tokens: readonly TokenView[];
  readonly endpoints: readonly EndpointView[];
  readonly deliveries: readonly DeliveryView[];
}

function timestamp(value: string | null): string {
  return value ? format(new Date(value), "MMM d, yyyy HH:mm") : "Never";
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "DELIVERED") return "default";
  if (status === "FAILED") return "destructive";
  if (status === "RETRY_SCHEDULED") return "secondary";
  return "outline";
}

export function DeveloperAccessWorkspace({ event, tokens, endpoints, deliveries }: DeveloperAccessWorkspaceProps) {
  const endpointNames = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.name]));
  const apiBase = `/api/v1/private/events/${event.id}`;

  return (
    <section className="flex flex-col gap-6">
      <header>
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-semibold text-2xl tracking-tight">Developer access</h1>
        <p className="text-muted-foreground text-sm">
          Issue event-scoped read credentials and send signed lifecycle events to external systems.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Issue an API token</CardTitle>
            <CardDescription>
              Use Bearer authentication with {apiBase}/sessions, /speakers, or /submissions. Token secrets are stored
              only as SHA-256 hashes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApiTokenForm eventSlug={event.slug} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Register a webhook</CardTitle>
            <CardDescription>
              Payloads include a stable delivery ID and an HMAC-SHA256 signature in the x-gatherpulse-signature header.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WebhookEndpointForm eventSlug={event.slug} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API tokens</CardTitle>
          <CardDescription>Secrets cannot be recovered. Revoke credentials that are no longer in use.</CardDescription>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRound />
                </EmptyMedia>
                <EmptyTitle>No API tokens</EmptyTitle>
                <EmptyDescription>Issue a scoped token to start reading this event through the API.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Scopes</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.map((token) => (
                    <TableRow key={token.id}>
                      <TableCell className="font-medium">{token.name}</TableCell>
                      <TableCell>
                        <code>btd_{token.prefix}_…</code>
                      </TableCell>
                      <TableCell>{token.scopes.join(", ")}</TableCell>
                      <TableCell>{timestamp(token.lastUsedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={token.revokedAt ? "outline" : "default"}>
                          {token.revokedAt ? "Revoked" : "Active"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {token.revokedAt ? null : <RevokeTokenButton eventSlug={event.slug} tokenId={token.id} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook endpoints</CardTitle>
          <CardDescription>Disabled endpoints keep their delivery history but receive no new events.</CardDescription>
        </CardHeader>
        <CardContent>
          {endpoints.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RadioTower />
                </EmptyMedia>
                <EmptyTitle>No webhook endpoints</EmptyTitle>
                <EmptyDescription>Register an endpoint to receive signed event notifications.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Events</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((endpoint) => (
                    <TableRow key={endpoint.id}>
                      <TableCell className="font-medium">{endpoint.name}</TableCell>
                      <TableCell className="max-w-72 truncate">{endpoint.url}</TableCell>
                      <TableCell>{endpoint.events.join(", ")}</TableCell>
                      <TableCell>
                        <Badge variant={endpoint.disabledAt ? "outline" : "default"}>
                          {endpoint.disabledAt ? "Disabled" : "Active"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {endpoint.disabledAt ? null : (
                          <DisableWebhookButton endpointId={endpoint.id} eventSlug={event.slug} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook delivery log</CardTitle>
          <CardDescription>The latest 25 attempts, including scheduled retries and terminal failures.</CardDescription>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RadioTower />
                </EmptyMedia>
                <EmptyTitle>No deliveries yet</EmptyTitle>
                <EmptyDescription>Delivery attempts appear here after subscribed events occur.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell>{timestamp(delivery.createdAt)}</TableCell>
                      <TableCell>{endpointNames.get(delivery.endpointId) ?? "Deleted endpoint"}</TableCell>
                      <TableCell>{delivery.eventType}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(delivery.status)}>{delivery.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell>{delivery.attemptCount}</TableCell>
                      <TableCell>
                        {delivery.responseStatus ?? delivery.error ?? timestamp(delivery.nextAttemptAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <RetryDueWebhooksButton eventSlug={event.slug} />
        </CardFooter>
      </Card>
    </section>
  );
}
