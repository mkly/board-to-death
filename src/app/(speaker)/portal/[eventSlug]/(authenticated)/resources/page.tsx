import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { requirePortalContent } from "../../_lib/portal-session";
import { SpeakerResources } from "./_components/speaker-resources";

interface SpeakerResourcesPageProps {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

export default async function SpeakerResourcesPage({ params }: SpeakerResourcesPageProps) {
  const { eventSlug } = await params;
  const { viewer } = await requirePortalContent(eventSlug, "resources");
  const resources = await new SpeakerPortalRepository(getDatabaseClient()).getResources(viewer);

  return <SpeakerResources eventSlug={eventSlug} resources={resources} />;
}
