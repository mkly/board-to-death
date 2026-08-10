import type { PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";

export type SpeakerTaskFileCommentActor =
  | { readonly role: "ORGANIZER"; readonly userId: string }
  | { readonly role: "SPEAKER"; readonly speakerId: string };

function commentBody(value: string): string {
  const body = value.trim();
  if (body.length === 0) throw new RepositoryError("invalid-input", "Comment text is required.");
  if (body.length > 2000) throw new RepositoryError("invalid-input", "Comments must be 2,000 characters or fewer.");
  return body;
}

export async function addSpeakerTaskFileComment(
  client: PrismaClient,
  eventId: string,
  submissionId: string,
  actor: SpeakerTaskFileCommentActor,
  value: string,
) {
  const submission = await client.speakerTaskSubmission.findFirst({
    where: {
      id: submissionId,
      assignment: {
        eventId,
        ...(actor.role === "SPEAKER" ? { speakerId: actor.speakerId } : {}),
      },
    },
    select: { id: true, response: true },
  });
  if (!submission) throw new RepositoryError("not-found", "The uploaded speaker file was not found.");
  const response = submission.response;
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    typeof response.objectKey !== "string"
  ) {
    throw new RepositoryError("invalid-input", "Comments can only be added to uploaded files.");
  }

  if (actor.role === "ORGANIZER") {
    const user = await client.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } });
    if (!user) throw new RepositoryError("not-found", "The comment author was not found.");
    return client.speakerTaskFileComment.create({
      data: {
        submissionId,
        authorRole: actor.role,
        authorLabel: user.name.trim() || user.email,
        authorUserId: actor.userId,
        body: commentBody(value),
      },
    });
  }

  const speaker = await client.speaker.findFirst({
    where: { id: actor.speakerId, eventId },
    select: {
      profileVersions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { preferredName: true, givenName: true, familyName: true },
      },
    },
  });
  const profile = speaker?.profileVersions[0];
  if (!profile) throw new RepositoryError("not-found", "The comment author was not found.");
  return client.speakerTaskFileComment.create({
    data: {
      submissionId,
      authorRole: actor.role,
      authorLabel: `${profile.preferredName ?? profile.givenName} ${profile.familyName}`.trim(),
      authorSpeakerId: actor.speakerId,
      body: commentBody(value),
    },
  });
}
