import { notFound } from "next/navigation";

import { CheckCircle2Icon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { requirePortalContent } from "../../_lib/portal-session";
import { SpeakerProfileForm } from "./_components/speaker-profile-form";

interface SpeakerProfilePageProps {
  readonly params: Promise<{ readonly eventSlug: string }>;
  readonly searchParams: Promise<{ readonly updated?: string }>;
}

export default async function SpeakerProfilePage({ params, searchParams }: SpeakerProfilePageProps) {
  const { eventSlug } = await params;
  const { updated } = await searchParams;
  const { viewer, portal } = await requirePortalContent(eventSlug, "profile");
  const profile = await new SpeakerPortalRepository(getDatabaseClient()).getProfile(viewer);
  if (!profile) notFound();

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">Speaker portal</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight sm:text-3xl">
          {portal.sectionTitles.profile}
        </h1>
        <p className="max-w-2xl text-muted-foreground text-sm">
          Update the contact, biography, and accessibility details the event team is permitted to collect.
        </p>
      </div>
      {updated === String(profile.versionNumber) ? (
        <Alert>
          <CheckCircle2Icon aria-hidden="true" />
          <AlertTitle>Profile saved</AlertTitle>
          <AlertDescription>Your profile was updated.</AlertDescription>
        </Alert>
      ) : null}
      <SpeakerProfileForm
        eventSlug={eventSlug}
        profile={profile}
        fieldVisibility={portal.profileFieldVisibility}
        filesVisible={portal.contentVisibility.files}
      />
    </>
  );
}
