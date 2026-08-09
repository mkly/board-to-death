import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../../../_lib/dashboard-shell";
import { CfpSetupWorkspace } from "./_components/cfp-setup-workspace";

export default async function CfpFormSetupPage({
  params,
}: {
  readonly params: Promise<{ eventSlug: string; formId: string }>;
}) {
  const [{ eventSlug, formId }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, "cfp") : "/dashboard");
  }

  const form = await new CfpFormRepository(getDatabaseClient()).get(event.id, formId);
  if (!form) notFound();

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Button variant="ghost" size="sm" className="w-fit" asChild>
        <Link href={dashboardEventHref(event.slug, "cfp")}>
          <ArrowLeft data-icon="inline-start" />
          Back to forms
        </Link>
      </Button>
      <header className="flex flex-col gap-2">
        <p className="font-medium text-muted-foreground text-sm">{event.name} · Draft setup</p>
        <h1 className="font-medium text-2xl leading-tight tracking-tight sm:text-3xl sm:leading-none">
          {form.definition.title}
        </h1>
        <p className="max-w-2xl text-muted-foreground text-sm">
          Configure the applicant-facing setup, welcome message, and consent terms. Each save creates a new draft
          version.
        </p>
      </header>
      <CfpSetupWorkspace definition={form.definition} eventSlug={event.slug} formId={form.formId} />
    </div>
  );
}
