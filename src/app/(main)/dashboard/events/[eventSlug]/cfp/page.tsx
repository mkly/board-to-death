import { notFound, redirect } from "next/navigation";

import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { CfpFormsIndex } from "./_components/cfp-forms-index";

export default async function CfpFormsPage({ params }: { readonly params: Promise<{ eventSlug: string }> }) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, "cfp") : "/dashboard");
  }

  const forms = await new CfpFormRepository(getDatabaseClient()).list(event.id);

  return <CfpFormsIndex event={event} forms={forms} />;
}
