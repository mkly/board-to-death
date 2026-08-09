import Link from "next/link";
import { notFound } from "next/navigation";

import { CalendarClockIcon, ClockIcon, KeyRoundIcon, LockIcon } from "lucide-react";

import { SanitizedMarkdown } from "@/components/content/sanitized-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { publicCfpHref } from "@/lib/cfp";
import { CfpPublicAccessRepository } from "@/server/cfp/public-access";
import { getDatabaseClient } from "@/server/database/client";

interface PublicCfpFormPageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

function formatDateTime(value: Date, timezone: string): string {
  // dateStyle/timeStyle cannot be combined with timeZoneName per the Intl
  // spec, so the date is spelled out with explicit components instead.
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(value);
}

function UnavailableCard({
  icon: Icon,
  title,
  description,
}: {
  readonly icon: typeof LockIcon;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
            <Icon aria-hidden="true" />
          </div>
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

export default async function PublicCfpFormPage({ params }: PublicCfpFormPageProps) {
  const { publicId } = await params;
  const lookup = await new CfpPublicAccessRepository(getDatabaseClient()).findByPublicId(publicId);

  if (lookup.status === "unknown") {
    notFound();
    return null;
  }

  if (lookup.status === "closed") {
    return (
      <UnavailableCard
        description={`The call for proposals for ${lookup.event.name} is no longer accepting submissions.`}
        icon={LockIcon}
        title="Submissions closed"
      />
    );
  }

  if (lookup.status === "not-yet-open") {
    return (
      <UnavailableCard
        description={`Submissions for ${lookup.event.name} have not opened yet. Check back soon.`}
        icon={ClockIcon}
        title="Not open yet"
      />
    );
  }

  if (lookup.status === "expired") {
    return (
      <UnavailableCard
        description={`The submission deadline for ${lookup.event.name} has passed.`}
        icon={CalendarClockIcon}
        title="Submission window closed"
      />
    );
  }

  if (lookup.status === "restricted") {
    return (
      <UnavailableCard
        description={`This call for proposals for ${lookup.event.name} requires a private access link from the organizer.`}
        icon={KeyRoundIcon}
        title="Private access required"
      />
    );
  }

  const { event, form, opensAt, closesAt } = lookup;

  return (
    <main className="flex min-h-screen justify-center bg-muted/30 p-4 sm:p-8">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex flex-col gap-2">
          <p className="font-medium text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-medium text-3xl leading-tight tracking-tight">{form.welcomeTitle ?? form.title}</h1>
          {form.welcomeContent ? <SanitizedMarkdown content={form.welcomeContent} /> : null}
        </header>

        {opensAt || closesAt ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>
                <h2>Dates and deadlines</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {opensAt ? (
                <p>
                  <span className="font-medium">Opens:</span> {formatDateTime(opensAt, event.timezone)}
                </p>
              ) : null}
              {closesAt ? (
                <p>
                  <span className="font-medium">Closes:</span> {formatDateTime(closesAt, event.timezone)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {form.instructions ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>
                <h2>Before you begin</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SanitizedMarkdown content={form.instructions} />
            </CardContent>
          </Card>
        ) : null}

        {form.termsContent ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>
                <h2>Terms and consent</h2>
              </CardTitle>
              <CardDescription>
                {form.consentRequired ? "Applicants must agree before submitting." : "Review before submitting."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SanitizedMarkdown content={form.termsContent} />
            </CardContent>
          </Card>
        ) : null}

        <Button asChild className="self-start" size="lg">
          <Link href={`${publicCfpHref(lookup.publicId)}/start`}>Start your submission</Link>
        </Button>
      </div>
    </main>
  );
}
