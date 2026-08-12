import { notFound } from "next/navigation";

import { getDashboardShellData } from "@/app/(main)/dashboard/_lib/dashboard-data";
import { findAuthorizedEvent } from "@/app/(main)/dashboard/_lib/dashboard-shell";
import { Separator } from "@/components/ui/separator";
import { getDatabaseClient } from "@/server/database/client";
import { EvaluationPlanRepository } from "@/server/evaluations";
import { EvaluationRubricRepository } from "@/server/evaluations/rubrics";

import { EvaluationPlanWorkspace } from "./_components/evaluation-plan-workspace";
import { EvaluationRubricWorkspace } from "./_components/evaluation-rubric-workspace";

interface EvaluationRubricPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function EvaluationRubricPage({ params }: EvaluationRubricPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();

  const client = getDatabaseClient();
  const [plans, rubricPlans] = await Promise.all([
    new EvaluationPlanRepository(client).list(event.id),
    new EvaluationRubricRepository(client).list(event.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Evaluations</h1>
          <p className="text-muted-foreground text-sm">
            Administer plan versions, ordered review rounds, lifecycle history, reviewer visibility, and scoring
            rubrics.
          </p>
        </div>
      </header>
      <EvaluationPlanWorkspace eventSlug={event.slug} plans={plans} />
      <Separator />
      <EvaluationRubricWorkspace event={{ slug: event.slug }} plans={rubricPlans} />
    </div>
  );
}
