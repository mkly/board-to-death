import { headers } from "next/headers";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import type { Prisma } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { createFileStorage, SpeakerFileService } from "@/server/infrastructure";

interface AdminTaskFileRouteContext {
  readonly params: Promise<{
    readonly assignmentId: string;
    readonly attemptNumber: string;
    readonly eventSlug: string;
    readonly workspace: string;
  }>;
}
function objectValue(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: AdminTaskFileRouteContext): Promise<Response> {
  const { assignmentId, attemptNumber: inputAttemptNumber, eventSlug, workspace } = await context.params;
  const session = await auth.api.getSession({ headers: await headers() });
  const attemptNumber = Number(inputAttemptNumber);
  if (!isAuthorizedAdminSession(session) || workspace !== "onboarding") return notFound();
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) return notFound();

  const assignment = await getDatabaseClient().speakerTaskAssignment.findFirst({
    where: { id: assignmentId, event: { slug: eventSlug } },
    select: {
      eventId: true,
      submissions: { where: { attemptNumber }, select: { response: true }, take: 1 },
    },
  });
  const response = objectValue(assignment?.submissions[0]?.response ?? null);
  if (!assignment || typeof response?.objectKey !== "string") return notFound();

  const files = new SpeakerFileService({
    storage: createFileStorage({ driver: "local", rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH }),
  });
  const stored = await files.read(response.objectKey, { role: "admin", eventId: assignment.eventId });
  if (!stored.ok) return notFound();

  const body = new ArrayBuffer(stored.value.bytes.byteLength);
  new Uint8Array(body).set(stored.value.bytes);
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": stored.value.reference.contentDisposition,
      "Content-Type": stored.value.reference.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
