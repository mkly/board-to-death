import { notFound } from "next/navigation";

import { CustomFieldEntityType } from "@/generated/prisma/client";
import { listContactGroups, listContacts } from "@/server/contacts/repositories";
import { CustomFieldRepository } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { ContactRecordsWorkspace } from "./_components/contact-records-workspace";

interface ContactsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function ContactsPage({ params }: ContactsPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const customFields = new CustomFieldRepository(client);
  const [contacts, groups, contactDefinitions, groupDefinitions] = await Promise.all([
    listContacts(client, event.id),
    listContactGroups(client, event.id),
    customFields.listDefinitions(event.id, CustomFieldEntityType.CONTACT),
    customFields.listDefinitions(event.id, CustomFieldEntityType.CONTACT_GROUP),
  ]);
  const [contactValues, groupValues] = await Promise.all([
    client.customFieldValue.findMany({
      where: { eventId: event.id, contactId: { in: contacts.map(({ id }) => id) } },
      select: { contactId: true, definitionId: true, value: true },
    }),
    client.customFieldValue.findMany({
      where: { eventId: event.id, groupId: { in: groups.map(({ id }) => id) } },
      select: { groupId: true, definitionId: true, value: true },
    }),
  ]);
  const definition = (field: (typeof contactDefinitions)[number]) => ({
    id: field.id,
    label: field.label,
    description: field.description,
    type: field.type,
    required: field.required,
    characterLimit: field.characterLimit,
    options:
      Array.isArray(field.options) && field.options.every((option) => typeof option === "string") ? field.options : [],
  });

  return (
    <ContactRecordsWorkspace
      event={{ name: event.name, slug: event.slug }}
      contactDefinitions={contactDefinitions.map(definition)}
      groupDefinitions={groupDefinitions.map(definition)}
      contacts={contacts.map((contact) => ({
        id: contact.id,
        email: contact.email,
        givenName: contact.givenName,
        familyName: contact.familyName,
        organization: contact.organization,
        jobTitle: contact.jobTitle,
        phone: contact.phone,
        customFieldValues: contactValues
          .filter(({ contactId }) => contactId === contact.id)
          .map(({ definitionId, value }) => ({ definitionId, value })),
      }))}
      groups={groups.map((group) => ({
        id: group.id,
        kind: group.kind,
        name: group.name,
        slug: group.slug,
        customFieldValues: groupValues
          .filter(({ groupId }) => groupId === group.id)
          .map(({ definitionId, value }) => ({ definitionId, value })),
      }))}
    />
  );
}
