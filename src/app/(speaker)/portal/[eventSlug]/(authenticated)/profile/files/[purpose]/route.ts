import { getDatabaseClient } from "@/server/database/client";
import { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";
import { createSpeakerFileService } from "@/server/speakers/speaker-file-storage";

import { getPortalViewer } from "../../../../_lib/portal-session";

type ProfileFilePurpose = "headshot" | "agreement";

interface RouteContext {
  readonly params: Promise<{ readonly eventSlug: string; readonly purpose: string }>;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function isProfileFilePurpose(value: string): value is ProfileFilePurpose {
  return value === "headshot" || value === "agreement";
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { eventSlug, purpose } = await context.params;
  if (!isProfileFilePurpose(purpose)) return notFound();

  const viewer = await getPortalViewer(eventSlug);
  const database = getDatabaseClient();
  const profile = await new SpeakerPortalRepository(database).getProfile(viewer);
  const key = purpose === "headshot" ? profile?.photoObjectKey : profile?.agreementObjectKey;
  if (!key) return notFound();

  const downloaded = await createSpeakerFileService().read(key, { role: "speaker", ...viewer });
  if (!downloaded.ok) return notFound();

  const { reference, bytes } = downloaded.value;
  const etag = `"${reference.etag}"`;
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": reference.contentDisposition,
    "Content-Type": reference.contentType,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, { headers });
}
