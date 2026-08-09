import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { SpeakerResourceRepository } from "@/server/program/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { ResourcePageWorkspace } from "./_components/resource-page-workspace";

export default async function PublishingPage({ params }: { readonly params: Promise<{ eventSlug: string }> }) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const pages = await new SpeakerResourceRepository(client).list(event.id);
  return <ResourcePageWorkspace event={{ name: event.name, slug: event.slug }} pages={pages} />;
}
