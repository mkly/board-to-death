import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DEFAULT_REMINDER_DAYS, DEFAULT_REMINDER_SEND_AT_MINUTE, reminderTimeFromMinute } from "@/lib/cfp/messages";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { CfpPolicyRepository } from "@/server/cfp/policies";
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

  const client = getDatabaseClient();
  const [form, eventDetails] = await Promise.all([
    new CfpFormRepository(client).get(event.id, formId),
    client.event.findUnique({ where: { id: event.id }, select: { location: true } }),
  ]);
  if (!form) notFound();
  const policy = await new CfpPolicyRepository(client).getByKey(event.id, form.key);
  const reminder = policy?.definition.messages.reminder;

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
      <CfpSetupWorkspace
        definition={form.definition}
        event={{
          name: event.name,
          slug: event.slug,
          startsAt: event.startsAt.toLocaleDateString("en-US", { dateStyle: "long", timeZone: event.timezone }),
          location: eventDetails?.location ?? null,
        }}
        eventSlug={event.slug}
        formId={form.formId}
        initialMessageSettings={{
          remindersEnabled: reminder?.enabled ?? false,
          reminderDaysBeforeClose: reminder?.daysBeforeClose ?? DEFAULT_REMINDER_DAYS,
          reminderSendAt: reminderTimeFromMinute(reminder?.sendAtMinute ?? DEFAULT_REMINDER_SEND_AT_MINUTE),
          submissionConfirmation:
            policy?.definition.messages.submissionConfirmation ??
            "We received your proposal for **{{event.name}}**. A confirmation was sent to {{recipient.email}}.",
          thankYou:
            policy?.definition.messages.thankYou ??
            "Thank you, {{recipient.name}}, for sharing your proposal with **{{event.name}}**.",
        }}
      />
    </div>
  );
}
