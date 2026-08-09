import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ArrowLeft } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { Button } from "@/components/ui/button";
import { DEFAULT_REMINDER_DAYS, DEFAULT_REMINDER_SEND_AT_MINUTE, reminderTimeFromMinute } from "@/lib/cfp/messages";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { CfpAdministratorRepository, CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../../../_lib/dashboard-shell";
import { CfpPolicySettings } from "./_components/cfp-policy-settings";
import { CfpSetupWorkspace } from "./_components/cfp-setup-workspace";

function localDateTime(value: Date, timezone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime())
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

function defaultLocalDateTime(value: Date, timezone: string, daysBefore: number): string {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime())
    .toZonedDateTimeISO(timezone)
    .subtract({ days: daysBefore })
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

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
  const [eligibleAdministrators, policy] = await Promise.all([
    new CfpAdministratorRepository(client).list(event.id),
    new CfpPolicyRepository(client).getByKey(event.id, form.key),
  ]);
  const reminder = policy?.definition.messages.reminder;
  const initialSettings = policy
    ? {
        submissionOpensAt: localDateTime(policy.definition.submissionOpensAt, event.timezone),
        submissionClosesAt: localDateTime(policy.definition.submissionClosesAt, event.timezone),
        draftPolicy: policy.definition.draftPolicy,
        maxSubmissionsPerSpeaker: policy.definition.submissionLimits.maxSubmissionsPerSpeaker,
        maxParticipantsPerSubmission: policy.definition.submissionLimits.maxParticipantsPerSubmission,
      }
    : {
        submissionOpensAt: defaultLocalDateTime(event.startsAt, event.timezone, 120),
        submissionClosesAt: defaultLocalDateTime(event.startsAt, event.timezone, 60),
        draftPolicy: "ALLOWED" as const,
        maxSubmissionsPerSpeaker: 3,
        maxParticipantsPerSubmission: 4,
      };
  const assignments = new Map(
    policy?.definition.adminAssignments.map((assignment) => [assignment.administratorId, assignment]) ?? [],
  );
  const currentAdministrator = eligibleAdministrators.find(
    ({ externalId }) => externalId.toLowerCase() === shell.user.email.toLowerCase(),
  );
  const canManageAdministrators = assignments.get(currentAdministrator?.id ?? "")?.role === "OWNER";
  const administrators = eligibleAdministrators.map(({ displayName, externalId, id }) => {
    const assignment = assignments.get(id);
    return {
      id,
      displayName,
      externalId,
      role: assignment?.role ?? null,
      notifyOnNewSubmission: assignment?.notifyOnNewSubmission ?? false,
      notifyOnSubmissionUpdate: assignment?.notifyOnSubmissionUpdate ?? false,
    };
  });

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
          Configure applicant access, speaker requirements, welcome content, consent terms, administrators, and alerts.
          Each save creates a new draft version.
        </p>
      </header>
      <CfpSetupWorkspace
        administrators={administrators}
        canManageAdministrators={canManageAdministrators}
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
      <CfpPolicySettings
        eventSlug={event.slug}
        formId={form.formId}
        timezone={event.timezone}
        initialSettings={initialSettings}
      />
    </div>
  );
}
