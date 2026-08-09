import {
  type ContentSignatureCheck,
  isJpeg,
  isPdf,
  isPlainText,
  isPng,
  isWebp,
  isZipContainer,
} from "./content-signatures.ts";

export interface FileValidationResult {
  readonly ok: boolean;
  readonly message?: string;
}

/**
 * A file request stores its allowlist as plain content-type strings, so the strings an
 * administrator can choose have to map onto a signature check we can actually perform.
 * A type absent from this map is one we cannot verify, and is refused rather than trusted.
 */
const SIGNATURES: Readonly<Record<string, ContentSignatureCheck>> = {
  "image/jpeg": isJpeg,
  "image/png": isPng,
  "image/webp": isWebp,
  "application/pdf": isPdf,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": isZipContainer,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZipContainer,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZipContainer,
  "text/plain": isPlainText,
};

export const SUPPORTED_REQUEST_CONTENT_TYPES: readonly string[] = Object.keys(SIGNATURES);

export const MAX_REQUEST_FILE_BYTES = 100 * 1024 * 1024;

export function isSupportedRequestContentType(contentType: string): boolean {
  return Object.hasOwn(SIGNATURES, contentType);
}

export interface RequestFilePolicy {
  readonly allowedContentTypes: readonly string[];
  readonly maxBytes: number;
}

function describeLimit(maxBytes: number): string {
  const megabytes = maxBytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes} MB` : `${megabytes.toFixed(1)} MB`;
}

/**
 * Validates an upload against the policy captured on the file request version the
 * assignment points at, not against the request's current version — a respondent who
 * started under the old rules is judged by the rules they were shown.
 */
export function validateRequestUpload(
  policy: RequestFilePolicy,
  contentType: string,
  bytes: Uint8Array,
): FileValidationResult {
  if (bytes.length === 0) {
    return { ok: false, message: "The file is empty." };
  }
  if (bytes.length > policy.maxBytes) {
    return { ok: false, message: `The file exceeds the ${describeLimit(policy.maxBytes)} limit.` };
  }
  if (!policy.allowedContentTypes.includes(contentType)) {
    return { ok: false, message: "This file type is not accepted for this request." };
  }
  const signatureCheck = SIGNATURES[contentType];
  if (!signatureCheck) {
    // The allowlist named a type we have no signature for. Refusing is the safe
    // direction: accepting would mean storing bytes we never actually verified.
    return { ok: false, message: "This file type cannot be verified and is not accepted." };
  }
  if (!signatureCheck(bytes)) {
    return { ok: false, message: "The file's contents do not match its declared type." };
  }
  return { ok: true };
}
