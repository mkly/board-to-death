import { getDatabaseClient } from "@/server/database/client";
import { getReviewerSession } from "@/server/evaluations/reviewer-session";
import { ReviewerWorkspaceRepository } from "@/server/evaluations/reviewer-workspace";

import { ReviewerAssignmentList } from "./_components/reviewer-assignment-list";

export default async function ReviewsPage() {
  const { user } = await getReviewerSession();
  const assignments = await new ReviewerWorkspaceRepository(getDatabaseClient()).list(user.id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">Reviewer workspace</p>
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Your assigned reviews</h1>
          <p className="text-muted-foreground text-sm">
            Review only the proposals assigned to you in currently open rounds.
          </p>
        </div>
      </header>
      <ReviewerAssignmentList assignments={assignments} />
    </div>
  );
}
