import type { FileRequestTargetKind } from "@/generated/prisma/client";
import { SUPPORTED_REQUEST_CONTENT_TYPES } from "@/server/files/request-policy";

/**
 * The stored allowlist is content-type strings; an administrator picks from labels. The order
 * follows `SUPPORTED_REQUEST_CONTENT_TYPES` so a type added to the policy shows up here too.
 */
const CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint (.pptx)",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel (.xlsx)",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word (.docx)",
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/webp": "WebP image",
  "text/plain": "Plain text",
};

export interface ContentTypeOption {
  readonly value: string;
  readonly label: string;
}

export const CONTENT_TYPE_OPTIONS: readonly ContentTypeOption[] = SUPPORTED_REQUEST_CONTENT_TYPES.map((value) => ({
  value,
  label: CONTENT_TYPE_LABELS[value] ?? value,
}));

export function contentTypeLabel(value: string): string {
  return CONTENT_TYPE_LABELS[value] ?? value;
}

export const TARGET_KIND_LABELS: Readonly<Record<FileRequestTargetKind, string>> = {
  CONTACT: "Contacts",
  GROUP: "Groups",
  SUBMISSION: "Submissions",
};

export const TARGET_KIND_DESCRIPTIONS: Readonly<Record<FileRequestTargetKind, string>> = {
  CONTACT: "Assign to individual contacts.",
  GROUP: "Assign to an exhibitor or sponsor group.",
  SUBMISSION: "Assign to a submission and its speakers.",
};

export function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes} MB` : `${megabytes.toFixed(1)} MB`;
}
