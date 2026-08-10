import type { Prisma } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";
import { SpeakerFileService } from "@/server/infrastructure";
import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { requirePortalContent } from "../../../../../_lib/portal-session";

interface TaskFileRouteContext {
  readonly params: Promise<{
    readonly assignmentId: string;
    readonly attemptNumber: string;
    readonly eventSlug: string;
  }>;
}
function objectValue(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: TaskFileRouteContext): Promise<Response> {
  const { assignmentId, attemptNumber: inputAttemptNumber, eventSlug } = await context.params;
  const attemptNumber = Number(inputAttemptNumber);
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) return notFound();

  const { viewer, portal } = await requirePortalContent(eventSlug, "tasks");
  if (!portal.contentVisibility.files) return new Response("Not found", { status: 404 });
  const task = await new SpeakerPortalRepository(getDatabaseClient()).getTask(viewer, assignmentId);
  const response = objectValue(
    task?.submissions.find((submission) => submission.attemptNumber === attemptNumber)?.response ?? null,
  );
  if (typeof response?.objectKey !== "string") return notFound();

  const files = new SpeakerFileService({
    storage: getConfiguredFileStorage(),
  });
  const stored = await files.read(response.objectKey, { role: "speaker", ...viewer });
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
