import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { publicCfpHref } from "@/lib/cfp";
import { CfpPublicAccessRepository } from "@/server/cfp/public-access";
import { getDatabaseClient } from "@/server/database/client";

import { PublicCfpForm } from "./_components/public-cfp-form";
import { randomUUID } from "node:crypto";

interface PublicCfpStartPageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

export default async function PublicCfpStartPage({ params }: PublicCfpStartPageProps) {
  const { publicId } = await params;
  const lookup = await new CfpPublicAccessRepository(getDatabaseClient()).findByPublicId(publicId);
  if (lookup.status === "unknown") notFound();
  if (lookup.status !== "open") redirect(publicCfpHref(publicId));

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

        <PublicCfpForm definition={lookup.form.definition} publicId={publicId} submissionKey={randomUUID()} />

        <Button asChild className="self-start" variant="ghost">
          <Link href={publicCfpHref(publicId)}>Back to CFP details</Link>
        </Button>
      </div>
    </main>
  );
}
