import Link from "next/link";

import { ArrowRight, ClipboardList, Eye, EyeOff, Fingerprint } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import type { ReviewerAssignmentSummary, ReviewerProgressState } from "@/server/evaluations/reviewer-workspace";

interface ReviewerAssignmentListProps {
  readonly assignments: readonly ReviewerAssignmentSummary[];
}

const progressLabels: Readonly<Record<ReviewerProgressState, string>> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

const visibilityDetails = {
  IDENTIFIED: { label: "Identified", icon: Eye },
  BLIND: { label: "Blind", icon: EyeOff },
  ANONYMIZED: { label: "Anonymized", icon: Fingerprint },
} as const;

export function ReviewerAssignmentList({ assignments }: ReviewerAssignmentListProps) {
  if (assignments.length === 0) {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardList />
          </EmptyMedia>
          <EmptyTitle>No active assignments</EmptyTitle>
          <EmptyDescription>
            You are all caught up. Assignments appear here only while their review round is open.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {assignments.map((assignment) => {
        const visibility = visibilityDetails[assignment.visibility];
        const VisibilityIcon = visibility.icon;
        const progressValue =
          assignment.progress.totalCriteria === 0
            ? 0
            : Math.round((assignment.progress.completedCriteria / assignment.progress.totalCriteria) * 100);
        return (
          <Card key={assignment.id}>
            <CardHeader>
              <CardTitle>{assignment.formTitle}</CardTitle>
              <CardDescription>
                {assignment.event.name} · {assignment.round.title}
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge variant="secondary">{progressLabels[assignment.progress.state]}</Badge>
                <Badge variant="outline">
                  <VisibilityIcon data-icon="inline-start" />
                  {visibility.label}
                </Badge>
                {assignment.categories.map((category) => (
                  <Badge key={category} variant="outline">
                    {category}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Rubric progress</span>
                <span className="tabular-nums">
                  {assignment.progress.completedCriteria}/{assignment.progress.totalCriteria}
                </span>
              </div>
              <Progress
                value={progressValue}
                aria-label={`${progressLabels[assignment.progress.state]}: ${assignment.progress.completedCriteria} of ${assignment.progress.totalCriteria} criteria scored`}
              />
            </CardContent>
            <CardFooter className="justify-between gap-3">
              <p className="text-muted-foreground text-xs">{assignment.round.planTitle}</p>
              <Button size="sm" asChild>
                <Link href={`/reviews/${assignment.id}`}>
                  Open review
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
