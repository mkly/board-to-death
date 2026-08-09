import { describe, expect, test } from "vitest";

import { allowedContentTypes, type FilePurpose, validateFileUpload } from "./file-policy";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function padded(signature: Uint8Array, size: number): Uint8Array {
  const buffer = new Uint8Array(size);
  buffer.set(signature);
  return buffer;
}

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const OOXML = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const TEXT = new TextEncoder().encode("A supporting note about the session.");

// Executable payloads a speaker might try to pass off as an allowed document.
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00);
const WINDOWS_PE = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00);
const SHELL_SCRIPT = new TextEncoder().encode("#!/bin/sh\nrm -rf /\n");

const PURPOSES: readonly FilePurpose[] = ["headshot", "agreement", "slides", "supportingDocument"];

const ACCEPTED: ReadonlyArray<readonly [FilePurpose, string, Uint8Array]> = [
  ["headshot", "image/jpeg", JPEG],
  ["headshot", "image/png", PNG],
  ["headshot", "image/webp", WEBP],
  ["agreement", "application/pdf", PDF],
  ["slides", "application/pdf", PDF],
  ["slides", "application/vnd.openxmlformats-officedocument.presentationml.presentation", OOXML],
  ["supportingDocument", "application/pdf", PDF],
  ["supportingDocument", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", OOXML],
  ["supportingDocument", "text/plain", TEXT],
];

const LIMIT_MEGABYTES: Readonly<Record<FilePurpose, number>> = {
  headshot: 5,
  agreement: 10,
  slides: 50,
  supportingDocument: 20,
};

const MISMATCHED = "The file's contents do not match its declared type.";

describe("validateFileUpload", () => {
  test("accepts every advertised content type for every purpose", () => {
    for (const [purpose, contentType, content] of ACCEPTED) {
      expect(validateFileUpload(purpose, contentType, content), `${purpose}/${contentType}`).toEqual({ ok: true });
    }
    for (const purpose of PURPOSES) {
      const covered = ACCEPTED.filter(([candidate]) => candidate === purpose).map(([, contentType]) => contentType);
      expect(covered).toEqual([...allowedContentTypes(purpose)]);
    }
  });

  test("advertises only the content types each purpose is meant to collect", () => {
    expect(allowedContentTypes("headshot")).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(allowedContentTypes("agreement")).toEqual(["application/pdf"]);
    expect(allowedContentTypes("slides")).toEqual([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]);
    expect(allowedContentTypes("supportingDocument")).toEqual([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ]);
  });

  test("rejects an empty upload for every purpose", () => {
    for (const purpose of PURPOSES) {
      expect(validateFileUpload(purpose, allowedContentTypes(purpose)[0], new Uint8Array()), purpose).toEqual({
        ok: false,
        message: "The file is empty.",
      });
    }
  });

  test("rejects a content type no policy allows and one another purpose allows", () => {
    for (const purpose of PURPOSES) {
      expect(validateFileUpload(purpose, "application/x-msdownload", WINDOWS_PE), purpose).toEqual({
        ok: false,
        message: "This file type is not accepted for this upload.",
      });
    }
    expect(validateFileUpload("headshot", "application/pdf", PDF).ok).toBe(false);
    expect(validateFileUpload("agreement", "image/png", PNG).ok).toBe(false);
    expect(validateFileUpload("slides", "text/plain", TEXT).ok).toBe(false);
  });

  test("rejects executable content declared as an allowed type", () => {
    for (const executable of [ELF, WINDOWS_PE, SHELL_SCRIPT]) {
      for (const purpose of PURPOSES) {
        for (const contentType of allowedContentTypes(purpose)) {
          if (contentType === "text/plain") continue;
          expect(validateFileUpload(purpose, contentType, executable), `${purpose}/${contentType}`).toEqual({
            ok: false,
            message: MISMATCHED,
          });
        }
      }
    }
  });

  test("rejects a truncated WEBP header that only matches the RIFF prefix", () => {
    expect(validateFileUpload("headshot", "image/webp", bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00))).toEqual({
      ok: false,
      message: MISMATCHED,
    });
  });

  test("rejects binary content declared as plain text", () => {
    expect(validateFileUpload("supportingDocument", "text/plain", bytes(0xff, 0xfe, 0x00, 0x80))).toEqual({
      ok: false,
      message: MISMATCHED,
    });
  });

  test("accepts a file at its purpose size limit and rejects one byte more", () => {
    for (const purpose of PURPOSES) {
      const megabytes = LIMIT_MEGABYTES[purpose];
      const limit = megabytes * 1024 * 1024;
      const contentType = allowedContentTypes(purpose)[0];
      const signature = contentType === "image/jpeg" ? JPEG : PDF;
      expect(validateFileUpload(purpose, contentType, padded(signature, limit)), purpose).toEqual({ ok: true });
      expect(validateFileUpload(purpose, contentType, padded(signature, limit + 1)), purpose).toEqual({
        ok: false,
        message: `The file exceeds the ${megabytes} MB limit.`,
      });
    }
  });
});
