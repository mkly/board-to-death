import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CfpDraftPolicy } from "@/generated/prisma/client";
import { publicCfpHref } from "@/lib/cfp";
import { CfpDraftRepository } from "@/server/cfp/drafts";
import { CfpPublicAccessRepository } from "@/server/cfp/public-access";
import { getDatabaseClient } from "@/server/database/client";

import { PublicCfpForm } from "./_components/public-cfp-form";
import { randomUUID } from "node:crypto";

interface PublicCfpStartPageProps {
  readonly params: Promise<{ readonly publicId: string }>;
  readonly searchParams: Promise<{ readonly draft?: string }>;
}

// This route has a dynamic segment but no generateStaticParams and no dynamic
// API, so Next would render it once on demand and then serve it from the full
// route cache. That would freeze both the published form definition and the
// per-render submissionKey below, and a frozen key is silent data loss: the
// second applicant's answers would be swallowed by createFinalized's replay
// path and they would be shown the first applicant's submission id. Every
// request has to render its own key.
export const dynamic = "force-dynamic";

export default async function PublicCfpStartPage({ params, searchParams }: PublicCfpStartPageProps) {
  const { publicId } = await params;
  const { draft: draftToken } = await searchParams;
  const client = getDatabaseClient();
  const lookup = await new CfpPublicAccessRepository(client).findByPublicId(publicId);
  if (lookup.status === "unknown") notFound();
  if (lookup.status !== "open") redirect(publicCfpHref(publicId));

  let initialAnswers: Record<string, unknown> | undefined;
  let initialParticipants: readonly Record<string, string>[] | undefined;
  let formVersionChanged = false;
  let draftError: string | null = null;

  if (draftToken && lookup.draftPolicy !== CfpDraftPolicy.DISABLED) {
    try {
      const draft = await new CfpDraftRepository({ database: client }).resume({
        eventId: lookup.event.id,
        policyId: lookup.policyId,
        draftPolicy: lookup.draftPolicy,
        token: draftToken,
        currentFormVersionId: lookup.form.versionId,
      });
      initialAnswers = draft.answers;
      initialParticipants = draft.participants as readonly Record<string, string>[];
      formVersionChanged = draft.formVersionChanged;
    } catch {
      draftError = "This draft link is invalid or has expired. Starting a new response.";
    }
  }

  return (
    <main className="flex min-h-screen justify-center bg-muted/30 p-4 sm:p-8">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex flex-col gap-2">
          <p className="font-medium text-muted-foreground text-sm">{lookup.event.name}</p>
          <h1 className="font-medium text-3xl leading-tight tracking-tight">{lookup.form.definition.title}</h1>
          {lookup.form.definition.description ? (
            <p className="text-muted-foreground">{lookup.form.definition.description}</p>
          ) : null}
          <p className="text-muted-foreground text-sm">
            Required questions are marked with <span className="text-destructive">*</span>.
          </p>
        </header>

        <PublicCfpForm
          definition={lookup.form.definition}
          draftError={draftError}
          draftPolicy={lookup.draftPolicy}
          draftToken={draftToken && !draftError ? draftToken : undefined}
          formVersionChanged={formVersionChanged}
          initialAnswers={initialAnswers}
          initialParticipants={initialParticipants}
          publicId={publicId}
          submissionKey={randomUUID()}
        />

        <Button asChild className="self-start" variant="ghost">
          <Link href={publicCfpHref(publicId)}>Back to CFP details</Link>
        </Button>
      </div>
    </main>
  );
}
