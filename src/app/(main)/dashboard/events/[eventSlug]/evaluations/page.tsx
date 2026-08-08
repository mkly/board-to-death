import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { EvaluationRubricRepository } from "@/server/evaluations/rubrics";

import { EvaluationRubricWorkspace } from "./_components/evaluation-rubric-workspace";

interface EvaluationRubricPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<{ notice?: string; error?: string }>;
}

export default async function EvaluationRubricPage({ params, searchParams }: EvaluationRubricPageProps) {
  const [{ eventSlug }, query] = await Promise.all([params, searchParams]);
  const client = getDatabaseClient();
  const event = await client.event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, name: true, slug: true },
  });
  if (!event) notFound();

  const plans = await new EvaluationRubricRepository(client).list(event.id);
  return <EvaluationRubricWorkspace event={event} plans={plans} notice={query.notice} error={query.error} />;
}
