import { notFound, redirect } from "next/navigation";

import { CfpSubmissionRepository } from "@/server/cfp/submissions";
import { listContactGroups, listContacts } from "@/server/contacts/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { createPrismaFileRequestStore } from "@/server/files/prisma-store";
import { getCurrentVersion, listFileRequests, listRequestAssignments } from "@/server/files/repositories";

import { getDashboardShellData } from "../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../_lib/dashboard-shell";
import type { AssignableTarget } from "../_components/file-request-detail";
import { FileRequestDetail } from "../_components/file-request-detail";

/**
 * Assignment targets are read for the request's own kind only: a contact request cannot be
 * pointed at a group, and loading all three lists would query tables the screen never renders.
 */
async function loadTargets(
  eventId: string,
  targetKind: "CONTACT" | "GROUP" | "SUBMISSION",
): Promise<AssignableTarget[]> {
  const client = getDatabaseClient();

  if (targetKind === "CONTACT") {
    const contacts = await listContacts(client, eventId);
    return contacts.map((contact) => ({
      id: contact.id,
      label: `${contact.givenName} ${contact.familyName}`.trim(),
      description: contact.organization ?? contact.email,
    }));
  }

  if (targetKind === "GROUP") {
    const groups = await listContactGroups(client, eventId);
    return groups.map((group) => ({ id: group.id, label: group.name, description: group.kind }));
  }

  const submissions = await new CfpSubmissionRepository(client).listForEvent(eventId, { all: true });
  return submissions.items.map((submission) => ({
    id: submission.id,
    label: submission.formTitle,
    description: submission.applicants.map((applicant) => applicant.name).join(", ") || submission.status,
  }));
}

export default async function FileRequestDetailPage({
  params,
}: {
  readonly params: Promise<{ eventSlug: string; requestId: string }>;
}) {
  const [{ eventSlug, requestId }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(
      shell.activeEvent
        ? `/dashboard/events/${encodeURIComponent(shell.activeEvent.slug)}/file-requests`
        : "/dashboard",
    );
  }

  const client = getDatabaseClient();
  const requests = await listFileRequests(client, event.id, { includeArchived: true });
  const request = requests.find((candidate) => candidate.id === requestId);

  if (!request) notFound();

  const [version, assignments, targets] = await Promise.all([
    getCurrentVersion(client, event.id, request.id),
    listRequestAssignments(client, event.id, request.id),
    loadTargets(event.id, request.targetKind),
  ]);
  const store = createPrismaFileRequestStore(client);
  const files = await Promise.all(
    assignments.map(async (assignment) => ({
      assignmentId: assignment.id,
      files: await store.listAssignmentFiles(assignment.id, true),
    })),
  );
  const assigned = new Set(assignments.map((assignment) => assignment.target.id));

  return (
    <FileRequestDetail
      assignments={assignments}
      event={event}
      files={files}
      request={request}
      targets={targets.filter((target) => !assigned.has(target.id))}
      version={version}
    />
  );
}
