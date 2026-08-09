import { notFound, redirect } from "next/navigation";

import type { CustomFieldInputDefinition } from "@/components/custom-fields/custom-field-inputs";
import { CustomFieldEntityType } from "@/generated/prisma/client";
import { listContacts, searchDirectoryPeople } from "@/server/contacts/repositories";
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
  readonly searchParams: Promise<{ q?: string; notice?: string; error?: string }>;
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
  const [contacts, people, definitions] = await Promise.all([
    listContacts(client, event.id),
    searchDirectoryPeople(client, query.q ?? ""),
    customFields.listDefinitions(event.id, CustomFieldEntityType.CONTACT),
  ]);
  const values = await client.customFieldValue.findMany({
    where: { eventId: event.id, contactId: { in: contacts.map(({ id }) => id) } },
    select: { contactId: true, definitionId: true, value: true },
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
          .map(({ definitionId, value }) => ({ definitionId, value })),
      }))}
      customFieldDefinitions={definitions.map(inputDefinition)}
      error={query.error}
      event={event}
      notice={query.notice}
      people={people}
      query={query.q ?? ""}
    />
  );
}
