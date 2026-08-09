import type { PrismaClient } from "../../generated/prisma/client.ts";
import type {
  EventFileEntry,
  FileRequestAssignmentRecord,
  FileRequestStore,
  RecordFileInput,
  RecordFileResult,
  StoredFileRecord,
} from "./request-files.ts";

function targetLabel(assignment: {
  readonly contact: { readonly givenName: string; readonly familyName: string; readonly email: string } | null;
  readonly group: { readonly name: string } | null;
  readonly submissionId: string | null;
}): string {
  if (assignment.contact) {
    const name = `${assignment.contact.givenName} ${assignment.contact.familyName}`.trim();
    return name === "" ? assignment.contact.email : name;
  }
  if (assignment.group) {
    return assignment.group.name;
  }
  return assignment.submissionId ? `Submission ${assignment.submissionId.slice(0, 8)}` : "Unassigned";
}

/**
 * Maps the file-request tables onto the store port the service depends on. Assignments are
 * always read through the `[eventId, id]` compound key, which is what keeps an assignment id
 * from one event from resolving against another event's row.
 */
export function createPrismaFileRequestStore(client: PrismaClient): FileRequestStore {
  return {
    async findAssignment(eventId: string, assignmentId: string): Promise<FileRequestAssignmentRecord | undefined> {
      const assignment = await client.fileRequestAssignment.findUnique({
        where: { eventId_id: { eventId, id: assignmentId } },
        include: {
          request: { select: { key: true, archivedAt: true } },
          requestVersion: {
            select: { title: true, allowedContentTypes: true, maxBytes: true, replacementPolicy: true },
          },
        },
      });
      if (!assignment) return undefined;
      return {
        id: assignment.id,
        eventId: assignment.eventId,
        requestId: assignment.requestId,
        requestKey: assignment.request.key,
        requestTitle: assignment.requestVersion.title,
        status: assignment.status,
        requestArchived: assignment.request.archivedAt !== null,
        policy: {
          allowedContentTypes: assignment.requestVersion.allowedContentTypes,
          maxBytes: assignment.requestVersion.maxBytes,
          replacementPolicy: assignment.requestVersion.replacementPolicy,
        },
        contactId: assignment.contactId,
        groupId: assignment.groupId,
        submissionId: assignment.submissionId,
      };
    },

    async listAssignmentFiles(assignmentId: string, includeSuperseded: boolean): Promise<readonly StoredFileRecord[]> {
      return await client.fileRequestFile.findMany({
        where: { assignmentId, ...(includeSuperseded ? {} : { supersededAt: null }) },
        orderBy: { uploadedAt: "desc" },
      });
    },

    async recordFile(input: RecordFileInput): Promise<RecordFileResult> {
      // One transaction covers superseding the previous files, inserting the new row, and
      // marking the assignment fulfilled: a partial apply would leave an assignment whose
      // stored objects and row state disagree.
      return await client.$transaction(async (transaction) => {
        const superseded = input.supersedeExisting
          ? await transaction.fileRequestFile.findMany({
              where: { assignmentId: input.assignmentId, supersededAt: null },
              select: { id: true, objectKey: true },
            })
          : [];
        if (superseded.length > 0) {
          await transaction.fileRequestFile.updateMany({
            where: { id: { in: superseded.map((file) => file.id) } },
            data: { supersededAt: new Date() },
          });
        }
        const file = await transaction.fileRequestFile.create({
          data: {
            assignmentId: input.assignmentId,
            objectKey: input.objectKey,
            fileName: input.fileName,
            contentType: input.contentType,
            size: input.size,
          },
        });
        await transaction.fileRequestAssignment.update({
          where: { id: input.assignmentId },
          data: { status: "FULFILLED", fulfilledAt: new Date() },
        });
        return { file, supersededKeys: superseded.map((entry) => entry.objectKey) };
      });
    },

    async isGroupMember(eventId: string, groupId: string, contactId: string): Promise<boolean> {
      const membership = await client.contactGroupMember.findFirst({
        where: { eventId, groupId, contactId, contact: { archivedAt: null }, group: { archivedAt: null } },
        select: { contactId: true },
      });
      return membership !== null;
    },

    async isSubmissionSpeaker(eventId: string, submissionId: string, speakerId: string): Promise<boolean> {
      const participant = await client.cfpSubmissionParticipant.findFirst({
        where: { eventId, submissionId, speakerId },
        select: { speakerId: true },
      });
      return participant !== null;
    },

    async listEventFiles(eventId: string): Promise<readonly EventFileEntry[]> {
      const files = await client.fileRequestFile.findMany({
        where: { supersededAt: null, assignment: { eventId } },
        include: {
          assignment: {
            include: {
              request: { select: { key: true } },
              requestVersion: { select: { title: true } },
              contact: { select: { givenName: true, familyName: true, email: true } },
              group: { select: { name: true } },
            },
          },
        },
        orderBy: { uploadedAt: "asc" },
      });
      return files.map(({ assignment, ...file }) => ({
        requestKey: assignment.request.key,
        requestTitle: assignment.requestVersion.title,
        targetLabel: targetLabel(assignment),
        file,
      }));
    },
  };
}
