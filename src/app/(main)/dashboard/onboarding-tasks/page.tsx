import { ClipboardCheck } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getDatabaseClient } from "@/server/database";
import { SpeakerOnboardingRepository } from "@/server/speakers";

import { OnboardingTasksWorkspace } from "./_components/onboarding-tasks-workspace";
import { taskDefinitionView } from "./model";

interface PageProps {
  readonly searchParams: Promise<{ event?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const database = getDatabaseClient();
  const eventOptions = await database.event.findMany({
    orderBy: { startsAt: "asc" },
    select: { id: true, name: true },
  });
  const requestedEventId = (await searchParams).event;
  const eventId = eventOptions.some(({ id }) => id === requestedEventId) ? requestedEventId : eventOptions[0]?.id;

  if (!eventId) {
    return (
      <Empty className="min-h-96 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardCheck />
          </EmptyMedia>
          <EmptyTitle>No events yet</EmptyTitle>
          <EmptyDescription>Create an event before configuring reusable speaker onboarding tasks.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const definitions = await new SpeakerOnboardingRepository(database).listDefinitions(eventId, {
    includeArchived: true,
  });
  return (
    <OnboardingTasksWorkspace
      key={eventId}
      eventOptions={eventOptions}
      initialSnapshot={{ eventId, definitions: definitions.map(taskDefinitionView) }}
    />
  );
}
