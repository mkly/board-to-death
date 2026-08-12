import { notFound, redirect } from "next/navigation";

import { getDashboardShellData } from "@/app/(main)/dashboard/_lib/dashboard-data";
import { findAuthorizedEvent } from "@/app/(main)/dashboard/_lib/dashboard-shell";
import { getDatabaseClient } from "@/server/database/client";
import { EvaluationResultsRepository } from "@/server/evaluations/results";

import { EvaluationResults } from "./_components/evaluation-results";

interface EvaluationResultsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ round?: string | string[] }>;
}

export default async function EvaluationResultsPage({ params, searchParams }: EvaluationResultsPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(
      shell.activeEvent
        ? `/dashboard/events/${encodeURIComponent(shell.activeEvent.slug)}/evaluations/results`
        : "/dashboard",
    );
  }

  const requestedRound = typeof query.round === "string" ? query.round : undefined;
  try {
    const workspace = await new EvaluationResultsRepository(getDatabaseClient()).getWorkspace(event.id, requestedRound);
    return <EvaluationResults event={{ name: event.name, slug: event.slug }} workspace={workspace} />;
  } catch (error) {
    if (error instanceof Error && error.name === "RepositoryError") notFound();
    throw error;
  }
}
