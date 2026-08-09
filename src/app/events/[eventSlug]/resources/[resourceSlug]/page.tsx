import { notFound } from "next/navigation";

import { SanitizedMarkdown } from "@/components/content/sanitized-markdown";
import { Badge } from "@/components/ui/badge";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerResourceRepository } from "@/server/program/repositories";

export default async function PublishedResourcePage({
  params,
}: {
  readonly params: Promise<{ eventSlug: string; resourceSlug: string }>;
}) {
  const { eventSlug, resourceSlug } = await params;
  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true, name: true } });
  if (!event) notFound();
  const resource = await new SpeakerResourceRepository(client).findPublished(event.id, resourceSlug);
  if (!resource) notFound();
  const { version } = resource;
  const allowedEmbedUrls = Array.isArray(version.allowedEmbedUrls)
    ? version.allowedEmbedUrls.filter((url): url is string => typeof url === "string")
    : undefined;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 lg:py-16">
      <header className="flex flex-col gap-3 border-b pb-6">
        <Badge variant="secondary" className="w-fit">
          {event.name}
        </Badge>
        <h1 className="font-heading font-semibold text-3xl tracking-tight sm:text-4xl">{version.title}</h1>
        {version.summary ? <p className="text-base text-muted-foreground">{version.summary}</p> : null}
      </header>
      <SanitizedMarkdown content={version.bodyMarkdown} allowedEmbedUrls={allowedEmbedUrls} className="text-base" />
    </main>
  );
}
