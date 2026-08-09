import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { SpeakerMappingRepository } from "@/server/integrations";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { SpeakerMappingWorkspace } from "./_components/speaker-mapping-workspace";

interface IntegrationsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ page?: string; notice?: string; error?: string }>;
}

export default async function IntegrationsPage({ params, searchParams }: IntegrationsPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  const page = Number.parseInt(query.page ?? "1", 10);
  const preview = await new SpeakerMappingRepository(getDatabaseClient()).previewOffline(event.id, page, 10);

  return (
    <SpeakerMappingWorkspace
      event={{ name: event.name, slug: event.slug }}
      preview={preview}
      notice={query.notice}
      error={query.error}
    />
  );
}
