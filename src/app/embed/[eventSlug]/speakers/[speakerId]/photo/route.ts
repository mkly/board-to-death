import { getRuntimeConfig } from "@/config/runtime-env.server";
import { getDatabaseClient } from "@/server/database/client";
import { createFileStorage } from "@/server/infrastructure";
import { PublishedProgramRepository } from "@/server/published-program";

interface RouteContext {
  readonly params: Promise<{ readonly eventSlug: string; readonly speakerId: string }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { eventSlug, speakerId } = await context.params;
  const publication = await new PublishedProgramRepository(getDatabaseClient()).findPublic(eventSlug);
  if (publication.status !== "published") return notFound();

  const speaker = publication.version.snapshot.speakers.find((candidate) => candidate.id === speakerId);
  if (!speaker?.photoObjectKey) return notFound();

  const storage = createFileStorage({
    driver: "local",
    rootDirectory: getRuntimeConfig().server.FILE_STORAGE_PATH,
  });
  const stored = await storage.get(speaker.photoObjectKey);
  if (!stored.ok || !stored.value.metadata.contentType.startsWith("image/")) return notFound();

  const etag = `"${stored.value.metadata.etag}"`;
  const headers = {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    // Headshots are attendee-supplied bytes served from the application origin, and image/svg+xml
    // is a document format: navigating straight to this URL would otherwise run the file's script
    // against the dashboard's own origin. Neutralize the document case; <img> loads are unaffected.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "Content-Type": stored.value.metadata.contentType,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const body = new ArrayBuffer(stored.value.bytes.byteLength);
  new Uint8Array(body).set(stored.value.bytes);
  return new Response(body, { headers });
}
