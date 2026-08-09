export type FilePurpose = "headshot" | "agreement" | "slides" | "supportingDocument";

export interface FileValidationResult {
  readonly ok: boolean;
  readonly message?: string;
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function isJpeg(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
}

function isPng(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function isPdf(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46]);
}

function isZipContainer(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
}

function isPlainText(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
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
