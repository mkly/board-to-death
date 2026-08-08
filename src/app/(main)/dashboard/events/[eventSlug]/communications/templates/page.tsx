import { notFound } from "next/navigation";

import { EmailTemplateRepository } from "@/server/communications/templates";
import { getDatabaseClient } from "@/server/database/client";

import { EmailTemplateWorkspace } from "./_components/email-template-workspace";

interface EmailTemplatesPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function EmailTemplatesPage({ params }: EmailTemplatesPageProps) {
  const { eventSlug } = await params;
  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, name: true, slug: true, startsAt: true, location: true },
  });
  if (!event) notFound();

  const templates = await new EmailTemplateRepository(client).list(event.id);
  const startsAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(event.startsAt);

  return (
    <EmailTemplateWorkspace
      event={{ name: event.name, slug: event.slug, startsAt, location: event.location }}
      templates={templates}
    />
  );
}
