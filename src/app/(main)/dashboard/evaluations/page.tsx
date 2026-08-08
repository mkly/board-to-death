import { ClipboardCheck } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getDatabaseClient } from "@/server/database";
import { EvaluationPlanRepository } from "@/server/evaluations";

import { EvaluationWorkspace } from "./_components/evaluation-workspace";

interface PageProps {
  readonly searchParams: Promise<{ event?: string; notice?: string; error?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const database = getDatabaseClient();
  const eventOptions = await database.event.findMany({
    orderBy: { startsAt: "asc" },
    select: { id: true, name: true },
  });
  const eventId = eventOptions.some(({ id }) => id === params.event) ? params.event : eventOptions[0]?.id;

  if (!eventId) {
    return (
      <Empty className="min-h-96 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardCheck />
          </EmptyMedia>
          <EmptyTitle>No events yet</EmptyTitle>
          <EmptyDescription>Create an event before configuring its evaluation plan.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const plan = await new EvaluationPlanRepository(database).get(eventId);
  return (
    <EvaluationWorkspace
      eventId={eventId}
      eventOptions={eventOptions}
      plan={plan}
      notice={params.notice}
      error={params.error}
    />
  );
}
