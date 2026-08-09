import { notFound, redirect } from "next/navigation";

import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";

import { getDashboardShellData } from "../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../_lib/dashboard-shell";
import { EmbedBuilder } from "./_components/embed-builder";

export default async function EmbedBuilderPage({ params }: { readonly params: Promise<{ eventSlug: string }> }) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(shell.activeEvent ? `${dashboardEventHref(shell.activeEvent.slug, "publishing")}/embeds` : "/dashboard");
  }

  return <EmbedBuilder event={{ name: event.name, slug: event.slug }} />;
}
