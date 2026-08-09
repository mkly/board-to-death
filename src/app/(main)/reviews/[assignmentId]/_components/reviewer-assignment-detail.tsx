import Link from "next/link";

import { ArrowLeft, CheckCircle2, Eye, EyeOff, Fingerprint, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import type { ReviewerAssignmentDetail } from "@/server/evaluations/reviewer-workspace";

interface ReviewerAssignmentDetailProps {
  readonly assignment: ReviewerAssignmentDetail;
}

const visibilityDetails = {
  IDENTIFIED: {
    label: "Identified review",
    description: "Applicant identity is visible for this round.",
    icon: Eye,
  },
  BLIND: {
    label: "Blind review",
    description: "Applicant and speaker identity fields are hidden for this round.",
    icon: EyeOff,
  },
  ANONYMIZED: {
    label: "Anonymized review",
    description: "Applicant identity is replaced with a stable submission reference.",
    icon: Fingerprint,
  },
} as const;

export function ReviewerAssignmentDetailView({ assignment }: ReviewerAssignmentDetailProps) {
  const visibility = visibilityDetails[assignment.visibility];
  const VisibilityIcon = visibility.icon;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reviews">
            <ArrowLeft data-icon="inline-start" />
            All reviews
          </Link>
        </Button>
      </div>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-sm">
              {assignment.event.name} · {assignment.round.title}
            </p>
            <h1 className="font-semibold text-2xl tracking-tight">{assignment.submission.reference}</h1>
          </div>
          <Badge variant="outline">
            <VisibilityIcon data-icon="inline-start" />
            {visibility.label}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">{visibility.description}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Proposal</CardTitle>
              <CardDescription>
                {assignment.formTitle} · {assignment.submission.kind.toLowerCase().replaceAll("_", " ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {assignment.submission.answers.length === 0 ? (
                <Empty className="min-h-48 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <EyeOff />
                    </EmptyMedia>
                    <EmptyTitle>No reviewable answers</EmptyTitle>
                    <EmptyDescription>
                      This proposal has no non-identity answers available in the configured review view.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                assignment.submission.answers.map((answer, index) => (
                  <div key={answer.questionId} className="flex flex-col gap-2">
                    {index > 0 ? <Separator /> : null}
                    <h2 className="font-medium text-sm">{answer.label}</h2>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {answer.value || "No answer provided"}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {assignment.submission.applicants.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Applicants</CardTitle>
                <CardDescription>Identity is visible because this round is configured as identified.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {assignment.submission.applicants.map((applicant) => (
                  <div key={applicant.email} className="flex items-center gap-3 rounded-lg border p-3">
                    <UserRound aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{applicant.name}</p>
                      <p className="truncate text-muted-foreground text-xs">{applicant.email}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Review rubric">
          <div>
            <h2 className="font-semibold text-lg">Rubric guidance</h2>
            <p className="text-muted-foreground text-sm">{assignment.round.planTitle}</p>
          </div>
          {assignment.criteria.map((criterion) => (
            <Card key={criterion.id} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {criterion.label}
                  {criterion.required ? <Badge variant="secondary">Required</Badge> : null}
                </CardTitle>
                <CardDescription>{criterion.description ?? "No additional guidance."}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs">
                  Score {criterion.minimum}–{criterion.maximum} · Weight {criterion.weight}
                </p>
                {criterion.score === null ? (
                  <Badge variant="outline">Not scored</Badge>
                ) : (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 aria-hidden="true" />
                    <span className="font-medium text-sm">Score {criterion.score}</span>
                  </div>
                )}
                {criterion.note ? <p className="text-muted-foreground text-sm">{criterion.note}</p> : null}
              </CardContent>
            </Card>
          ))}
        </aside>
      </div>
    </div>
  );
}
