import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  type CustomFieldEntityType,
  CustomFieldEntityType as CustomFieldEntityTypeValue,
} from "@/generated/prisma/client";
import { CustomFieldRepository } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { ProgramSessionRepository } from "@/server/sessions/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { BulkEditWorkspace } from "./_components/bulk-edit-workspace";

type RecordEntityType = "CONTACT" | "SESSION" | "GROUP";

function recordEntityType(entityType: CustomFieldEntityType): RecordEntityType | null {
  if (entityType === CustomFieldEntityTypeValue.CONTACT) return "CONTACT";
  if (entityType === CustomFieldEntityTypeValue.PROGRAM_SESSION) return "SESSION";
  if (entityType === CustomFieldEntityTypeValue.CONTACT_GROUP) return "GROUP";
  return null;
}

export default async function RecordsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ customField?: string; customValue?: string }>;
}) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const customFields = new CustomFieldRepository(client);
  const customFieldDefinitions = (await customFields.listDefinitions(event.id)).filter(
    (definition) => recordEntityType(definition.entityType) !== null,
  );
  const selectedDefinition = customFieldDefinitions.find(({ id }) => id === query.customField);
  const customFieldQuery = query.customValue?.trim() ?? "";
  const filterEntityType = selectedDefinition ? recordEntityType(selectedDefinition.entityType) : null;
  const matchingIds =
    selectedDefinition && filterEntityType && customFieldQuery
      ? await customFields.matchingTargetIds(event.id, {
          definitionId: selectedDefinition.id,
          query: customFieldQuery,
        })
      : null;
  const contactWhere = {
    eventId: event.id,
    archivedAt: null,
    ...(filterEntityType === "CONTACT" ? { id: { in: [...(matchingIds ?? [])] } } : {}),
  };
  const groupWhere = {
    eventId: event.id,
    archivedAt: null,
    ...(filterEntityType === "GROUP" ? { id: { in: [...(matchingIds ?? [])] } } : {}),
  };
  const [contacts, contactCount, groups, groupCount, sessionPage, tracks, audits] = await Promise.all([
    client.contact.findMany({
      where: contactWhere,
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      take: 100,
    }),
    client.contact.count({ where: contactWhere }),
    client.contactGroup.findMany({
      where: groupWhere,
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      take: 100,
    }),
    client.contactGroup.count({ where: groupWhere }),
    new ProgramSessionRepository(client).listPage(event.id, {
      limit: 100,
      ...(filterEntityType === "SESSION" ? { ids: matchingIds ?? [] } : {}),
    }),
    client.track.findMany({ where: { eventId: event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    client.bulkEditOperation.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const customFieldValues = await client.customFieldValue.findMany({
    where: {
      eventId: event.id,
      OR: [
        { contactId: { in: contacts.map(({ id }) => id) } },
        { groupId: { in: groups.map(({ id }) => id) } },
        { sessionId: { in: sessionPage.items.map(({ id }) => id) } },
      ],
    },
    select: { contactId: true, groupId: true, sessionId: true, definitionId: true, value: true },
  });
  const truncated = contactCount > contacts.length || groupCount > groups.length || sessionPage.hasMore;

  const valuesFor = (entityType: RecordEntityType, recordId: string) =>
    customFieldDefinitions
      .filter((definition) => recordEntityType(definition.entityType) === entityType)
      .map((definition) => ({
        definitionId: definition.id,
        label: definition.label,
        value: customFieldValues.find((value) => {
          if (value.definitionId !== definition.id) return false;
          if (entityType === "CONTACT") return value.contactId === recordId;
          if (entityType === "GROUP") return value.groupId === recordId;
          return value.sessionId === recordId;
        })?.value,
      }));

  return (
    <div className="flex flex-col gap-6">
      {truncated ? (
        <Alert>
          <AlertTitle>Showing the first 100 records per type</AlertTitle>
          <AlertDescription>Narrow bulk edits to the records shown on this page.</AlertDescription>
        </Alert>
      ) : null}
      <BulkEditWorkspace
        key={`${selectedDefinition?.id ?? "all"}:${customFieldQuery}`}
        event={{ name: event.name, slug: event.slug }}
        contacts={contacts.map((contact) => ({
          id: contact.id,
          name: `${contact.givenName} ${contact.familyName}`,
          detail: contact.email,
          values: [contact.organization, contact.jobTitle, contact.phone].filter(Boolean).join(" · ") || "No details",
          customFields: valuesFor("CONTACT", contact.id),
        }))}
        groups={groups.map((group) => ({
          id: group.id,
          name: group.name,
          detail: group.kind === "SPONSOR" ? "Sponsor" : "Exhibitor",
          values: group.slug,
          customFields: valuesFor("GROUP", group.id),
        }))}
        sessions={sessionPage.items.map((session) => ({
          id: session.id,
          name: session.version.title,
          detail: `${session.version.durationMinutes} minutes`,
          values: tracks.find(({ id }) => id === session.version.trackId)?.name ?? "No track",
          customFields: valuesFor("SESSION", session.id),
        }))}
        customFieldDefinitions={customFieldDefinitions.map((definition) => ({
          id: definition.id,
          label: definition.label,
          entityType: recordEntityType(definition.entityType) as RecordEntityType,
        }))}
        customFieldFilter={
          selectedDefinition && filterEntityType && customFieldQuery
            ? { definitionId: selectedDefinition.id, entityType: filterEntityType, query: customFieldQuery }
            : null
        }
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
