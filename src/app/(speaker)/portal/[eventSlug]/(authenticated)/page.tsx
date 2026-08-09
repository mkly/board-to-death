import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { getPortalViewer } from "../_lib/portal-session";
import { PortalDashboard } from "./_components/portal-content";

interface SpeakerPortalPageProps {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

export default async function SpeakerPortalPage({ params }: SpeakerPortalPageProps) {
  const { eventSlug } = await params;
  const viewer = await getPortalViewer(eventSlug);
  const dashboard = await new SpeakerPortalRepository(getDatabaseClient()).getDashboard(viewer);
  if (!dashboard) notFound();

  return <PortalDashboard dashboard={dashboard} />;
}
