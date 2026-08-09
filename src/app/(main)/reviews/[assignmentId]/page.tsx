import { notFound } from "next/navigation";

import { getDatabaseClient } from "@/server/database/client";
import { getReviewerSession } from "@/server/evaluations/reviewer-session";
import { ReviewerWorkspaceRepository } from "@/server/evaluations/reviewer-workspace";

import { ReviewerAssignmentDetailView } from "./_components/reviewer-assignment-detail";

interface ReviewerAssignmentPageProps {
  readonly params: Promise<{ assignmentId: string }>;
}

export default async function ReviewerAssignmentPage({ params }: ReviewerAssignmentPageProps) {
  const [{ assignmentId }, { user }] = await Promise.all([params, getReviewerSession()]);
  const assignment = await new ReviewerWorkspaceRepository(getDatabaseClient()).get(user.id, assignmentId);
  if (!assignment) notFound();
  return <ReviewerAssignmentDetailView assignment={assignment} />;
}
