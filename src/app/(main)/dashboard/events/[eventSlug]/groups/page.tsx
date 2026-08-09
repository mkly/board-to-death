import { notFound, redirect } from "next/navigation";

import type { ContactGroupKind } from "@/generated/prisma/client";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { listContactGroupIntakeForms, listContactGroupIntakeSubmissions } from "@/server/contacts/group-intake";
import { listContactGroups, listContactGroupTiers, listContacts } from "@/server/contacts/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { GroupIntakeWorkspace } from "./_components/group-intake-workspace";
import { GroupWorkspace } from "./_components/group-workspace";

export default async function GroupsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ kind?: string; tier?: string; sort?: string; notice?: string; error?: string }>;
}) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const authorizedEvent = findAuthorizedEvent(shell.events, eventSlug);
  if (!authorizedEvent) notFound();
  if (shell.activeEvent?.id !== authorizedEvent.id) {
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, "groups") : "/dashboard");
  }

  const kind: ContactGroupKind | undefined =
    query.kind === "SPONSOR" || query.kind === "EXHIBITOR" ? query.kind : undefined;
  const sortBy = query.sort === "tier" ? "tier" : "name";
  const client = getDatabaseClient();
  const [event, tiers, contacts, intakeForms, intakeSubmissions] = await Promise.all([
    client.event.findUnique({
      where: { id: authorizedEvent.id },
      select: { name: true, slug: true, sponsorsEnabled: true, exhibitorsEnabled: true },
    }),
    listContactGroupTiers(client, authorizedEvent.id),
    listContacts(client, authorizedEvent.id),
    listContactGroupIntakeForms(client, authorizedEvent.id),
    listContactGroupIntakeSubmissions(client, authorizedEvent.id),
  ]);
  if (!event) notFound();
  const tierId = tiers.some(({ id }) => id === query.tier) ? query.tier : undefined;
  const groups = await listContactGroups(client, authorizedEvent.id, {
    kind,
    sortBy,
    ...(tierId ? { tierIds: [tierId] } : {}),
  });

  return (
    <div className="flex flex-col gap-6">
      <GroupWorkspace
        contacts={contacts.map((contact) => ({
          id: contact.id,
          name: `${contact.givenName} ${contact.familyName}`,
          email: contact.email,
        }))}
        error={query.error}
        event={event}
        filters={{ kind, tierId, sortBy }}
        groups={groups}
        notice={query.notice}
        tiers={tiers}
      />
      <GroupIntakeWorkspace event={event} forms={intakeForms} submissions={intakeSubmissions} />
    </div>
  );
}
