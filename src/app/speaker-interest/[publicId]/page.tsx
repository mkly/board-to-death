import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { SpeakerSourcingRepository } from "@/server/speaker-sourcing/repositories";

import { SpeakerInterestForm } from "./_components/speaker-interest-form";

export const dynamic = "force-dynamic";

export default async function SpeakerInterestPage({ params }: { readonly params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const form = await new SpeakerSourcingRepository(getDatabaseClient()).findPublishedInterestForm(publicId);
  if (!form) notFound();

  return (
    <main className="flex min-h-screen justify-center bg-muted/30 p-4 sm:p-8">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="font-medium text-muted-foreground text-sm">{form.event.name}</p>
          <h1 className="font-medium text-3xl leading-tight tracking-tight">{form.title}</h1>
          {form.description ? <p className="text-muted-foreground">{form.description}</p> : null}
        </header>
        <SpeakerInterestForm publicId={form.publicId} />
      </div>
    </main>
  );
}
