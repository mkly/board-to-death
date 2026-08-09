import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ArrowLeft, ClipboardPen } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { CfpPolicyRepository } from "@/server/cfp/policies";
import { CfpFormRepository } from "@/server/cfp/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../../../_lib/dashboard-shell";
import { CfpPolicySettings } from "./_components/cfp-policy-settings";

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

  const database = getDatabaseClient();
  const form = await new CfpFormRepository(database).get(event.id, formId);
  if (!form) notFound();
  const policy = await new CfpPolicyRepository(database).getByKey(event.id, form.key);
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

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Button variant="ghost" size="sm" className="w-fit" asChild>
        <Link href={dashboardEventHref(event.slug, "cfp")}>
          <ArrowLeft data-icon="inline-start" />
          Back to forms
        </Link>
      </Button>
      <header className="flex flex-col gap-1">
        <p className="font-medium text-muted-foreground text-sm">Draft setup</p>
        <h1 className="font-medium text-2xl leading-tight tracking-tight sm:text-3xl sm:leading-none">
          {form.definition.title}
        </h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardPen className="size-4" />
            Draft created
          </CardTitle>
          <CardDescription>
            This form is ready for its welcome message, questions, and submission settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Continue through the CFP setup steps to prepare this draft for publication.
          </p>
        </CardContent>
      </Card>
      <CfpPolicySettings
        eventSlug={event.slug}
        formId={form.formId}
        timezone={event.timezone}
        initialSettings={initialSettings}
      />
    </div>
  );
}
