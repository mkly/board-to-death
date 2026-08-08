import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CfpSubmissionRepository } from "@/server/cfp/submissions";
import { getDatabaseClient } from "@/server/database/client";

import { SubmissionDetail } from "./_components/submission-detail";

interface SubmissionDetailPageProps {
  readonly params: Promise<{ eventSlug: string; submissionId: string }>;
}

export default async function SubmissionDetailPage({ params }: SubmissionDetailPageProps) {
  const [{ eventSlug, submissionId }, session] = await Promise.all([
    params,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!session || !isAllowedAdminEmail(session.user.email)) notFound();

  const submission = await new CfpSubmissionRepository(getDatabaseClient()).getDetailByEventSlug(
    eventSlug,
    submissionId,
  );
  if (!submission) notFound();

  return <SubmissionDetail submission={submission} />;
}
