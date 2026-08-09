import { notFound, redirect } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { listFileRequests } from "@/server/files/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { FileRequestsIndex } from "./_components/file-requests-index";

export default async function FileRequestsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ tab?: string; notice?: string; error?: string }>;
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

  const requests = await listFileRequests(getDatabaseClient(), event.id, { includeArchived: true });

  return (
    <FileRequestsIndex
      activeTab={messages.tab ?? "all"}
      error={messages.error}
      event={event}
      notice={messages.notice}
      requests={requests}
    />
  );
}
