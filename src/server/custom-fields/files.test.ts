import { describe, expect, test } from "vitest";

import { InMemoryFileStorage } from "../infrastructure/fakes.ts";
import {
  CUSTOM_FIELD_FILE_POLICY,
  CustomFieldFileService,
  type CustomFieldFileStore,
  prepareCustomFieldFile,
} from "./files.ts";

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

class FakeCustomFieldFileStore implements CustomFieldFileStore {
  readonly files = new Map<
    string,
    { readonly eventId: string; readonly fileName: string; readonly objectKey: string }
  >();

  async findFile(eventId: string, valueId: string) {
    const file = this.files.get(valueId);
    return file?.eventId === eventId ? file : undefined;
  }
}

describe("custom field file policy", () => {
  test("rejects content types outside the file-request allowlist with a field-specific error", async () => {
    const file = new File([PDF], "agenda.pdf", { type: "application/x-msdownload" });

    await expect(prepareCustomFieldFile(file, "Speaker agreement")).rejects.toMatchObject({
      message: "Speaker agreement: This file type is not accepted for this request.",
    });
  });

  test("rejects files over the shared file-request size limit", async () => {
    const file = new File([new Uint8Array(CUSTOM_FIELD_FILE_POLICY.maxBytes + 1)], "agenda.pdf", {
      type: "application/pdf",
    });

    await expect(prepareCustomFieldFile(file, "Speaker agreement")).rejects.toMatchObject({
      message: "Speaker agreement: The file exceeds the 100 MB limit.",
    });
  });
});

describe("custom field file downloads", () => {
  test("returns an event-owned file through its value id", async () => {
    const storage = new InMemoryFileStorage();
    const store = new FakeCustomFieldFileStore();
    store.files.set("value-1", {
      eventId: "event-1",
      fileName: "agenda.pdf",
      objectKey: "events/event-1/custom-fields/field-1/agenda.pdf",
    });
    await storage.put({
      key: "events/event-1/custom-fields/field-1/agenda.pdf",
      bytes: PDF,
      contentType: "application/pdf",
      contentDisposition: 'attachment; filename="agenda.pdf"',
      metadata: { "owner-event-id": "event-1" },
    });

    const result = await new CustomFieldFileService({ storage, store }).download("event-1", "value-1");

    expect(result).toEqual({
      bytes: PDF,
      contentType: "application/pdf",
      contentDisposition: 'attachment; filename="agenda.pdf"',
    });
  });

  test("refuses a value id owned by another event", async () => {
    const storage = new InMemoryFileStorage();
    const store = new FakeCustomFieldFileStore();
    store.files.set("value-1", {
      eventId: "event-1",
      fileName: "agenda.pdf",
      objectKey: "events/event-1/custom-fields/field-1/agenda.pdf",
    });

    await expect(
      new CustomFieldFileService({ storage, store }).download("event-2", "value-1"),
    ).resolves.toBeUndefined();
  });
});
