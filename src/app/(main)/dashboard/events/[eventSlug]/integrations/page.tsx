import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { loadAcceleventsSyncHistory, loadSessionPreview, SpeakerMappingRepository } from "@/server/integrations";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { DeveloperAccessWorkspace } from "./_components/developer-access-workspace";
import { ProgramPushCard } from "./_components/program-push-card";
import { SessionMappingPreview } from "./_components/session-mapping-preview";
import { SpeakerMappingWorkspace } from "./_components/speaker-mapping-workspace";
import { SyncStatusWorkspace } from "./_components/sync-status-workspace";

interface IntegrationsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ page?: string }>;
}

export default async function IntegrationsPage({ params, searchParams }: IntegrationsPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  const client = getDatabaseClient();
  const page = Number.parseInt(query.page ?? "1", 10);
  const [speakerPreview, sessions, syncRuns, tokens, webhookEndpoints, webhookDeliveries] = await Promise.all([
    new SpeakerMappingRepository(client).previewOffline(event.id, page, 10),
    loadSessionPreview(client, event.id),
    loadAcceleventsSyncHistory(client, event.id),
    client.apiToken.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "desc" } }),
    client.webhookEndpoint.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "desc" } }),
    client.webhookDelivery.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        endpointId: true,
        eventType: true,
        status: true,
        attemptCount: true,
        responseStatus: true,
        error: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <DeveloperAccessWorkspace
        event={{ id: event.id, name: event.name, slug: event.slug }}
        tokens={tokens.map((token) => ({
          id: token.id,
          name: token.name,
          prefix: token.prefix,
          scopes: Array.isArray(token.scopes)
            ? token.scopes.filter((scope): scope is string => typeof scope === "string")
            : [],
          createdAt: token.createdAt.toISOString(),
          lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
          revokedAt: token.revokedAt?.toISOString() ?? null,
        }))}
        endpoints={webhookEndpoints.map((endpoint) => ({
          id: endpoint.id,
          name: endpoint.name,
          url: endpoint.url,
          events: Array.isArray(endpoint.events)
            ? endpoint.events.filter((eventType): eventType is string => typeof eventType === "string")
            : [],
          disabledAt: endpoint.disabledAt?.toISOString() ?? null,
        }))}
        deliveries={webhookDeliveries.map((delivery) => ({
          ...delivery,
          createdAt: delivery.createdAt.toISOString(),
          nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
          deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
        }))}
      />
      <SpeakerMappingWorkspace event={{ name: event.name, slug: event.slug }} preview={speakerPreview} />
      <SessionMappingPreview
        event={{ name: event.name, slug: event.slug }}
        connected={Boolean(sessions.configuration)}
        remoteEventId={sessions.configuration?.remoteEventId ?? null}
        mapping={sessions.mapping}
        mappingVersion={sessions.mappingVersion}
        publishedVersion={sessions.publishedVersion}
        preview={sessions.preview}
      />
      <ProgramPushCard
        eventSlug={event.slug}
        connected={Boolean(sessions.configuration)}
        // sessions.publishedVersion is the latest version whether or not it is still published, so the
        // push offer follows sessions.preview instead: it exists only while a published snapshot does.
        publishedVersion={sessions.preview ? sessions.publishedVersion : null}
      />
      <SyncStatusWorkspace event={{ name: event.name, slug: event.slug }} runs={syncRuns} />
    </div>
  );
}
