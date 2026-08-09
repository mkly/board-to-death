import { notFound, redirect } from "next/navigation";

import { listContacts, searchDirectoryPeople } from "@/server/contacts/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { ContactsWorkspace } from "./_components/contacts-workspace";

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
  const [contacts, people] = await Promise.all([
    listContacts(client, event.id),
    searchDirectoryPeople(client, query.q ?? ""),
  ]);

  return (
    <ContactsWorkspace
      contacts={contacts}
      error={query.error}
      event={event}
      notice={query.notice}
      people={people}
      query={query.q ?? ""}
    />
  );
}
