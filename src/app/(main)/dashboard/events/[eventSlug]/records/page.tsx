import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getDatabaseClient } from "@/server/database/client";
import { ProgramSessionRepository } from "@/server/sessions/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { BulkEditWorkspace } from "./_components/bulk-edit-workspace";

export default async function RecordsPage({ params }: { readonly params: Promise<{ eventSlug: string }> }) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const [contacts, contactCount, groups, groupCount, sessionPage, tracks, audits] = await Promise.all([
    client.contact.findMany({
      where: { eventId: event.id, archivedAt: null },
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      take: 100,
    }),
    client.contact.count({ where: { eventId: event.id, archivedAt: null } }),
    client.contactGroup.findMany({
      where: { eventId: event.id, archivedAt: null },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      take: 100,
    }),
    client.contactGroup.count({ where: { eventId: event.id, archivedAt: null } }),
    new ProgramSessionRepository(client).listPage(event.id, { limit: 100 }),
    client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    client.bulkEditOperation.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const truncated = contactCount > contacts.length || groupCount > groups.length || sessionPage.hasMore;

  return (
    <div className="flex flex-col gap-6">
      {truncated ? (
        <Alert>
          <AlertTitle>Showing the first 100 records per type</AlertTitle>
          <AlertDescription>Narrow bulk edits to the records shown on this page.</AlertDescription>
        </Alert>
      ) : null}
      <BulkEditWorkspace
        event={{ name: event.name, slug: event.slug }}
        contacts={contacts.map((contact) => ({
          id: contact.id,
          name: `${contact.givenName} ${contact.familyName}`,
          detail: contact.email,
          values: [contact.organization, contact.jobTitle, contact.phone].filter(Boolean).join(" · ") || "No details",
        }))}
        groups={groups.map((group) => ({
          id: group.id,
          name: group.name,
          detail: group.kind === "SPONSOR" ? "Sponsor" : "Exhibitor",
          values: group.slug,
        }))}
        sessions={sessionPage.items.map((session) => ({
          id: session.id,
          name: session.version.title,
          detail: `${session.version.durationMinutes} minutes`,
          values: tracks.find(({ id }) => id === session.version.trackId)?.name ?? "No track",
        }))}
        tracks={tracks.map(({ id, name }) => ({ id, name }))}
        audits={audits.map((audit) => ({
          id: audit.id,
          entityType: audit.entityType,
          field: audit.field,
          requestedCount: audit.requestedCount,
          succeededCount: audit.succeededCount,
          performedBy: audit.performedBy,
          createdAt: audit.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
