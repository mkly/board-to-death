import { isJpeg, isPdf, isPlainText, isPng, isWebp, isZipContainer } from "../files/content-signatures.ts";

export type FilePurpose = "headshot" | "agreement" | "slides" | "supportingDocument";

export interface FileValidationResult {
  readonly ok: boolean;
  readonly message?: string;
}

interface FilePolicy {
  readonly maxBytes: number;
  readonly signatures: Readonly<Record<string, (bytes: Uint8Array) => boolean>>;
}

const FILE_POLICIES: Readonly<Record<FilePurpose, FilePolicy>> = {
  headshot: {
    maxBytes: 5 * 1024 * 1024,
    signatures: { "image/jpeg": isJpeg, "image/png": isPng, "image/webp": isWebp },
  },
  agreement: {
    maxBytes: 10 * 1024 * 1024,
    signatures: { "application/pdf": isPdf },
  },
  slides: {
    maxBytes: 50 * 1024 * 1024,
    signatures: {
      "application/pdf": isPdf,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": isZipContainer,
    },
  },
  supportingDocument: {
    maxBytes: 20 * 1024 * 1024,
    signatures: {
      "application/pdf": isPdf,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZipContainer,
      "text/plain": isPlainText,
    },
  },
};

export function allowedContentTypes(purpose: FilePurpose): readonly string[] {
  return Object.keys(FILE_POLICIES[purpose].signatures);
}

export function validateFileUpload(purpose: FilePurpose, contentType: string, bytes: Uint8Array): FileValidationResult {
  const policy = FILE_POLICIES[purpose];
  if (bytes.length === 0) {
    return { ok: false, message: "The file is empty." };
  }
  if (bytes.length > policy.maxBytes) {
    return { ok: false, message: `The file exceeds the ${Math.floor(policy.maxBytes / (1024 * 1024))} MB limit.` };
  }
  const signatureCheck = policy.signatures[contentType];
  if (!signatureCheck) {
    return { ok: false, message: "This file type is not accepted for this upload." };
  }
  if (!signatureCheck(bytes)) {
    return { ok: false, message: "The file's contents do not match its declared type." };
  }
  return { ok: true };
}
