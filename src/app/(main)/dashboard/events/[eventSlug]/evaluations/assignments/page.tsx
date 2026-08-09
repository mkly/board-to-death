import { notFound, redirect } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { EvaluationAssignmentRepository } from "@/server/evaluations/assignments";

import { getDashboardShellData } from "../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../_lib/dashboard-shell";
import { EvaluationAssignments } from "./_components/evaluation-assignments";

interface EvaluationAssignmentsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ round?: string | string[] }>;
}

export default async function EvaluationAssignmentsPage({ params, searchParams }: EvaluationAssignmentsPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(
      shell.activeEvent
        ? `/dashboard/events/${encodeURIComponent(shell.activeEvent.slug)}/evaluations/assignments`
        : "/dashboard",
    );
  }

  const requestedRound = typeof query.round === "string" ? query.round : undefined;
  try {
    const workspace = await new EvaluationAssignmentRepository(getDatabaseClient()).getWorkspace(
      event.id,
      requestedRound,
    );
    return <EvaluationAssignments event={{ id: event.id, name: event.name, slug: event.slug }} workspace={workspace} />;
  } catch (error) {
    if (error instanceof Error && error.name === "RepositoryError") notFound();
    throw error;
  }
}
