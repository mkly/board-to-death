import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CustomFieldEntityType } from "@/generated/prisma/client";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CfpSubmissionRepository } from "@/server/cfp/submissions";
import { CustomFieldRepository } from "@/server/custom-fields/repositories";
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

  const client = getDatabaseClient();
  const submission = await new CfpSubmissionRepository(client).getDetailByEventSlug(eventSlug, submissionId);
  if (!submission) notFound();
  const customFields = new CustomFieldRepository(client);
  const [definitions, values] = await Promise.all([
    customFields.listDefinitions(submission.event.id, CustomFieldEntityType.CFP_SUBMISSION),
    customFields.listValues(submission.event.id, { entityType: "CFP_SUBMISSION", submissionId }),
  ]);

  return (
    <SubmissionDetail
      customFields={definitions.map((definition) => ({
        id: definition.id,
        label: definition.label,
        value: values.find(({ definitionId }) => definitionId === definition.id)?.value,
      }))}
      submission={submission}
    />
  );
}
