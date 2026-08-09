import { notFound } from "next/navigation";

import { CfpSubmissionStatus, SpeakerTaskAssignmentStatus } from "@/generated/prisma/client";
import { RecipientAudienceRepository, type RecipientAudienceSelection } from "@/server/communications/audiences";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../_lib/dashboard-shell";
import { RecipientAudienceWorkspace } from "./_components/recipient-audience-workspace";

interface RecipientAudiencePageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ACCEPTANCE_STATUSES = new Set<string>(Object.values(CfpSubmissionStatus));
const ONBOARDING_STATUSES = new Set<string>(Object.values(SpeakerTaskAssignmentStatus));

function values(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function selectionFrom(searchParams: Record<string, string | string[] | undefined>): RecipientAudienceSelection {
  return {
    speakerIds: values(searchParams.speaker),
    sessionIds: values(searchParams.session),
    categoryIds: values(searchParams.category),
    acceptanceStatuses: values(searchParams.acceptance).filter((value) => ACCEPTANCE_STATUSES.has(value)) as
      | CfpSubmissionStatus[]
      | undefined,
    onboardingStatuses: values(searchParams.onboarding).filter((value) => ONBOARDING_STATUSES.has(value)) as
      | SpeakerTaskAssignmentStatus[]
      | undefined,
  };
}

function hasSelection(selection: RecipientAudienceSelection): boolean {
  return [
    selection.speakerIds,
    selection.sessionIds,
    selection.categoryIds,
    selection.acceptanceStatuses,
    selection.onboardingStatuses,
  ].some((criteria) => (criteria?.length ?? 0) > 0);
}

export default async function RecipientAudiencePage({ params, searchParams }: RecipientAudiencePageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const authorizedEvent = findAuthorizedEvent(shell.events, eventSlug);
  if (!authorizedEvent || shell.activeEvent?.id !== authorizedEvent.id) notFound();

  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { id: authorizedEvent.id },
    select: { id: true, name: true, slug: true },
  });
  if (!event) notFound();

  const selection = selectionFrom(query);
  const repository = new RecipientAudienceRepository(client);
  const [options, preview] = await Promise.all([
    repository.listOptions(event.id),
    hasSelection(selection) ? repository.preview(event.id, selection) : Promise.resolve(null),
  ]);

  return <RecipientAudienceWorkspace event={event} options={options} preview={preview} selection={selection} />;
}
