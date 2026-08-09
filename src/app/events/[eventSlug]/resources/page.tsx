import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowRight, BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerResourceRepository } from "@/server/program/repositories";

export default async function PublishedResourcesPage({ params }: { readonly params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, name: true, slug: true },
  });
  if (!event) notFound();
  const resources = await new SpeakerResourceRepository(client).listPublished(event.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 lg:py-16">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-3xl tracking-tight sm:text-4xl">Speaker resources</h1>
        <p className="text-muted-foreground">Guides and information published by the event team.</p>
      </header>
      {resources.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen />
            </EmptyMedia>
            <EmptyTitle>No published resources</EmptyTitle>
            <EmptyDescription>The event team has not published any speaker resources yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {resources.map(({ pageId, version }) => (
            <Card key={pageId} size="sm">
              <CardHeader>
                <CardTitle>{version.title}</CardTitle>
                <CardDescription>{version.summary ?? "Open this resource for details."}</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/events/${event.slug}/resources/${version.slug}`}>
                      Open
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
