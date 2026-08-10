import { notFound, redirect } from "next/navigation";

import type { CustomFieldInputDefinition } from "@/components/custom-fields/custom-field-inputs";
import { CustomFieldEntityType } from "@/generated/prisma/client";
import { DirectorySegmentRepository } from "@/server/contacts/directory-segments";
import { listContacts, listDirectoryDuplicateMatches, searchDirectoryPeople } from "@/server/contacts/repositories";
import { CustomFieldRepository } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { ContactsWorkspace } from "./_components/contacts-workspace";

function inputDefinition(
  field: Awaited<ReturnType<CustomFieldRepository["listDefinitions"]>>[number],
): CustomFieldInputDefinition {
  return {
    id: field.id,
    label: field.label,
    description: field.description,
    type: field.type,
    required: field.required,
    characterLimit: field.characterLimit,
    options:
      Array.isArray(field.options) && field.options.every((option) => typeof option === "string") ? field.options : [],
  };
}

export default async function ContactsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{
    q?: string;
    organization?: string;
    jobTitle?: string;
    participatedEventId?: string;
    segment?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(
      shell.activeEvent ? `/dashboard/events/${encodeURIComponent(shell.activeEvent.slug)}/contacts` : "/dashboard",
    );
  }

  const client = getDatabaseClient();
  const customFields = new CustomFieldRepository(client);
  const directorySegments = new DirectorySegmentRepository(client);
  const [contacts, duplicateMatches, definitions, segments] = await Promise.all([
    listContacts(client, event.id),
    listDirectoryDuplicateMatches(client, event.id),
    customFields.listDefinitions(event.id, CustomFieldEntityType.CONTACT),
    directorySegments.listForEvent(event.id),
  ]);
  const selectedSegment = segments.find(({ id }) => id === query.segment);
  const filters = selectedSegment?.filters ?? {
    query: query.q,
    organization: query.organization,
    jobTitle: query.jobTitle,
    eventId: query.participatedEventId,
  };
  const people = await searchDirectoryPeople(client, event.id, filters);
  const values = await client.customFieldValue.findMany({
    where: { eventId: event.id, contactId: { in: contacts.map(({ id }) => id) } },
    select: { id: true, contactId: true, definitionId: true, value: true },
  });

  return (
    <ContactsWorkspace
      contacts={contacts.map((contact) => ({
        id: contact.id,
        personId: contact.personId,
        email: contact.email,
        givenName: contact.givenName,
        familyName: contact.familyName,
        organization: contact.organization,
        jobTitle: contact.jobTitle,
        phone: contact.phone,
        customFieldValues: values
          .filter(({ contactId }) => contactId === contact.id)
          .map(({ id, definitionId, value }) => ({ id, definitionId, value })),
      }))}
      customFieldDefinitions={definitions.map(inputDefinition)}
      duplicateMatches={duplicateMatches}
      error={query.error}
      event={event}
      events={shell.events.map(({ id, name }) => ({ id, name }))}
      filters={filters}
      notice={query.notice}
      people={people}
      segments={segments}
      selectedSegmentId={selectedSegment?.id}
    />
  );
}
