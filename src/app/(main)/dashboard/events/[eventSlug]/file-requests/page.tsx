import { notFound, redirect } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { createPrismaFileRequestStore } from "@/server/files/prisma-store";
import { listFileRequests } from "@/server/files/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { FileRequestsIndex } from "./_components/file-requests-index";

export default async function FileRequestsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ tab?: string }>;
}) {
  const [{ eventSlug }, messages, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(
      shell.activeEvent
        ? `/dashboard/events/${encodeURIComponent(shell.activeEvent.slug)}/file-requests`
        : "/dashboard",
    );
  }

  const client = getDatabaseClient();
  const [requests, files] = await Promise.all([
    listFileRequests(client, event.id, { includeArchived: true }),
    createPrismaFileRequestStore(client).listEventFileLibrary(event.id),
  ]);

  return <FileRequestsIndex activeTab={messages.tab ?? "all"} event={event} files={files} requests={requests} />;
}
