import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { loadSessionPreview, SpeakerMappingRepository } from "@/server/integrations";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { SessionMappingPreview } from "./_components/session-mapping-preview";
import { SpeakerMappingWorkspace } from "./_components/speaker-mapping-workspace";

interface IntegrationsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ page?: string; notice?: string; error?: string }>;
}

export default async function IntegrationsPage({ params, searchParams }: IntegrationsPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  const client = getDatabaseClient();
  const page = Number.parseInt(query.page ?? "1", 10);
  const [speakerPreview, sessions] = await Promise.all([
    new SpeakerMappingRepository(client).previewOffline(event.id, page, 10),
    loadSessionPreview(client, event.id),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <SpeakerMappingWorkspace
        event={{ name: event.name, slug: event.slug }}
        preview={speakerPreview}
        notice={query.notice}
        error={query.error}
      />
      <SessionMappingPreview
        event={{ name: event.name, slug: event.slug }}
        connected={Boolean(sessions.configuration)}
        remoteEventId={sessions.configuration?.remoteEventId ?? null}
        mapping={sessions.mapping}
        mappingVersion={sessions.mappingVersion}
        publishedVersion={sessions.publishedVersion}
        preview={sessions.preview}
      />
    </div>
  );
}
