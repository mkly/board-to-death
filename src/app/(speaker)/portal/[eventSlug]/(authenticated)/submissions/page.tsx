import { notFound } from "next/navigation";

import { FileTextIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { getPortalViewer } from "../../_lib/portal-session";
import { PortalSectionHeading, SubmissionList } from "../_components/portal-content";

interface SpeakerSubmissionsPageProps {
  readonly params: Promise<{ readonly eventSlug: string }>;
}

export default async function SpeakerSubmissionsPage({ params }: SpeakerSubmissionsPageProps) {
  const { eventSlug } = await params;
  const viewer = await getPortalViewer(eventSlug);
  const dashboard = await new SpeakerPortalRepository(getDatabaseClient()).getDashboard(viewer);
  if (!dashboard) notFound();

  return (
    <>
      <PortalSectionHeading
        icon={FileTextIcon}
        title="My submissions"
        description="Review every proposal you are attached to and its current decision state."
      />
      <Card>
        <CardHeader>
          <CardTitle>Submissions ({dashboard.submissions.length})</CardTitle>
          <CardDescription>Only proposals linked to your speaker identity are available here.</CardDescription>
        </CardHeader>
        <CardContent>
          <SubmissionList eventSlug={eventSlug} submissions={dashboard.submissions} />
        </CardContent>
      </Card>
    </>
  );
}
