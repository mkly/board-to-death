import { headers } from "next/headers";

import { getRuntimeConfig } from "@/config/runtime-env.server";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { createPrismaFileRequestStore } from "@/server/files/prisma-store";
import { FileRequestFileService } from "@/server/files/request-files";
import { createFileStorage } from "@/server/infrastructure";

interface FileRequestDownloadContext {
  readonly params: Promise<{
    readonly eventSlug: string;
    readonly assignmentId: string;
    readonly fileId: string;
  }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Administrators download a collected file through the service rather than the storage driver, so
 * the event check that refuses another event's assignment id runs on this path too.
 */
export async function GET(_request: Request, context: FileRequestDownloadContext): Promise<Response> {
  const [{ eventSlug, assignmentId, fileId }, session] = await Promise.all([
    context.params,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!isAuthorizedAdminSession(session)) return notFound();

  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true } });
  if (!event) return notFound();

  const files = new FileRequestFileService({
    storage: createFileStorage({ driver: "local", rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH }),
    store: createPrismaFileRequestStore(client),
  });
  const stored = await files.download({ role: "admin", eventId: event.id }, assignmentId, fileId);
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
