import { isJpeg, isPng, isWebp } from "@/server/files/content-signatures";
import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";
import { contentDisposition, safeFileName } from "@/server/infrastructure/file-names";

import { randomUUID } from "node:crypto";

const BRANDING_IMAGE_SIGNATURES: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = {
  "image/jpeg": isJpeg,
  "image/png": isPng,
  "image/webp": isWebp,
};

export interface BrandingUpload {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName?: string;
}

export type BrandingUploadRead = { readonly upload: BrandingUpload | null } | { readonly error: string };

export async function readBrandingUpload(
  formData: FormData,
  field: string,
  maxMegabytes: number,
): Promise<BrandingUploadRead> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return { upload: null };
  if (file.size > maxMegabytes * 1024 * 1024) {
    return { error: `The image exceeds the ${maxMegabytes} MB limit.` };
  }
  const matchesSignature = BRANDING_IMAGE_SIGNATURES[file.type];
  if (!matchesSignature) return { error: "Upload a PNG, JPEG, or WebP image." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesSignature(bytes)) return { error: "The image's contents do not match its declared type." };
  return { upload: { bytes, contentType: file.type, fileName: safeFileName(file.name) } };
}

export async function storeBrandingUpload(
  eventId: string,
  purpose: "logo" | "background" | "portal-logo" | "portal-background",
  upload: BrandingUpload,
): Promise<string | null> {
  const key = `events/${eventId}/branding/${purpose}-${randomUUID()}`;
  const stored = await getConfiguredFileStorage().put({
    key,
    bytes: upload.bytes,
    contentType: upload.contentType,
    contentDisposition: upload.fileName ? contentDisposition(upload.fileName) : undefined,
  });
  return stored.ok ? key : null;
}

export async function getBrandingImageResponse(key: string): Promise<Response | null> {
  const stored = await getConfiguredFileStorage().get(key);
  if (!stored.ok || !stored.value.metadata.contentType.startsWith("image/")) return null;

  const body = new ArrayBuffer(stored.value.bytes.byteLength);
  new Uint8Array(body).set(stored.value.bytes);
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Type": stored.value.metadata.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
