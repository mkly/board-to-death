import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { SpreadsheetImportWorkspace } from "./_components/spreadsheet-import-workspace";

interface ImportsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function ImportsPage({ params }: ImportsPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  const imports = await getDatabaseClient().spreadsheetImport.findMany({
    where: { eventId: event.id },
    include: { changes: { select: { action: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return (
    <SpreadsheetImportWorkspace
      event={{ name: event.name, slug: event.slug }}
      recentImports={imports.map((entry) => ({
        id: entry.id,
        entityType: entry.entityType,
        fileName: entry.fileName,
        actorId: entry.actorId,
        createdAt: entry.createdAt.toISOString(),
        created: entry.changes.filter(({ action }) => action === "CREATED").length,
        updated: entry.changes.filter(({ action }) => action === "UPDATED").length,
      }))}
    />
  );
}
