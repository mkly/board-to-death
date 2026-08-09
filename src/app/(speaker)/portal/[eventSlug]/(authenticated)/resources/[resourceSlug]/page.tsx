import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { requirePortalContent } from "../../../_lib/portal-session";
import { SpeakerResource } from "../_components/speaker-resource";

interface SpeakerResourcePageProps {
  readonly params: Promise<{ readonly eventSlug: string; readonly resourceSlug: string }>;
}

export default async function SpeakerResourcePage({ params }: SpeakerResourcePageProps) {
  const { eventSlug, resourceSlug } = await params;
  const { viewer } = await requirePortalContent(eventSlug, "resources");
  const resource = await new SpeakerPortalRepository(getDatabaseClient()).getResource(viewer, resourceSlug);
  if (!resource) notFound();

  return <SpeakerResource eventSlug={eventSlug} result={resource} />;
}
