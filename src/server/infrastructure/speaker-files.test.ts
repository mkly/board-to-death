import { describe, test } from "vitest";

import type {
  FileStorageService,
  FileWrite,
  InfrastructureResult,
  StoredFile,
  StoredFileMetadata,
} from "./contracts.ts";
import { InMemoryFileStorage } from "./fakes.ts";
import { createFileStorage, LocalFileStorage } from "./file-storage.ts";
import { infrastructureFailure } from "./results.ts";
import { SpeakerFileService } from "./speaker-files.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

class DeleteFailingStorage implements FileStorageService {
  readonly storage = new InMemoryFileStorage();
  #deleteAttempts = 0;

  put(file: FileWrite): Promise<InfrastructureResult<StoredFileMetadata>> {
    return this.storage.put(file);
  }

  get(key: string): Promise<InfrastructureResult<StoredFile>> {
    return this.storage.get(key);
  }

  delete(key: string): Promise<InfrastructureResult<boolean>> {
    this.#deleteAttempts += 1;
    if (this.#deleteAttempts === 1) {
      return Promise.resolve(infrastructureFailure("file-storage", "unavailable"));
    }
    return this.storage.delete(key);
  }
}

function createService(storage: FileStorageService = new InMemoryFileStorage()) {
  let sequence = 0;
  return new SpeakerFileService({
    storage,
    createObjectId: () => `object-${++sequence}`,
  });
}

const owner = { eventId: "event-1", speakerId: "speaker-1" } as const;
const speaker = { role: "speaker", ...owner } as const;

describe("speaker file lifecycle", () => {
  test("writes owned metadata and enforces speaker or event-admin access", async () => {
    const service = createService();
    const stored = await service.write({
      ...owner,
      fileName: "../Speaker résumé.pdf",
      contentType: "application/pdf",
      bytes: Uint8Array.from([1, 2, 3]),
    });
    assert.equal(stored.ok, true);
    if (!stored.ok) return;

    assert.equal(stored.value.key, "events/event-1/speakers/speaker-1/object-1");
    assert.equal(stored.value.fileName, "Speaker résumé.pdf");
    assert.match(stored.value.contentDisposition, /^attachment; filename="Speaker r_sum_.pdf";/);

    const fetched = await service.read(stored.value.key, speaker);
    const eventAdmin = await service.read(stored.value.key, { role: "admin", eventId: owner.eventId });
    const otherSpeaker = await service.read(stored.value.key, {
      role: "speaker",
      eventId: owner.eventId,
      speakerId: "speaker-2",
    });
    const otherEventAdmin = await service.read(stored.value.key, { role: "admin", eventId: "event-2" });

    assert.equal(fetched.ok, true);
    if (fetched.ok) assert.deepEqual(fetched.value.bytes, Uint8Array.from([1, 2, 3]));
    assert.equal(eventAdmin.ok, true);
    assert.equal(otherSpeaker.ok, false);
    if (!otherSpeaker.ok) assert.equal(otherSpeaker.error.code, "unauthorized");
    assert.equal(otherEventAdmin.ok, false);
    if (!otherEventAdmin.ok) assert.equal(otherEventAdmin.error.code, "unauthorized");
  });

  test("replaces and removes objects without retaining superseded data", async () => {
    const storage = new InMemoryFileStorage();
    const service = createService(storage);
    const original = await service.write({
      ...owner,
      fileName: "slides-v1.pdf",
      contentType: "application/pdf",
      bytes: Uint8Array.from([1]),
    });
    assert.equal(original.ok, true);
    if (!original.ok) return;

    const replacement = await service.replace(
      original.value.key,
      {
        ...owner,
        fileName: "slides-v2.pdf",
        contentType: "application/pdf",
        bytes: Uint8Array.from([2]),
      },
      speaker,
    );
    assert.equal(replacement.ok, true);
    if (!replacement.ok) return;

    assert.equal((await storage.get(original.value.key)).ok, false);
    assert.equal((await service.read(replacement.value.key, speaker)).ok, true);
    assert.deepEqual(await service.remove(replacement.value.key, speaker), { ok: true, value: true });
    assert.equal((await storage.get(replacement.value.key)).ok, false);
  });

  test("keeps the current object and cleans up a replacement when removal fails", async () => {
    const storage = new DeleteFailingStorage();
    const service = createService(storage);
    const original = await service.write({
      ...owner,
      fileName: "slides-v1.pdf",
      contentType: "application/pdf",
      bytes: Uint8Array.from([1]),
    });
    assert.equal(original.ok, true);
    if (!original.ok) return;

    const replacement = await service.replace(
      original.value.key,
      {
        ...owner,
        fileName: "slides-v2.pdf",
        contentType: "application/pdf",
        bytes: Uint8Array.from([2]),
      },
      speaker,
    );

    assert.equal(replacement.ok, false);
    if (!replacement.ok) assert.equal(replacement.error.code, "unavailable");
    assert.equal((await storage.get(original.value.key)).ok, true);
    assert.equal((await storage.get("events/event-1/speakers/speaker-1/object-2")).ok, false);
  });

  test("rejects unsafe ownership keys and propagates storage failures without creating data", async () => {
    const storage = new InMemoryFileStorage();
    const service = createService(storage);

    const unsafeOwner = await service.write({
      eventId: "..",
      speakerId: "speaker-1",
      fileName: "slides.pdf",
      contentType: "application/pdf",
      bytes: Uint8Array.from([1]),
    });
    const unsafeName = await service.write({
      ...owner,
      fileName: "..",
      contentType: "application/pdf",
      bytes: Uint8Array.from([1]),
    });
    storage.failNext("unavailable");
    const failedWrite = await service.write({
      ...owner,
      fileName: "slides.pdf",
      contentType: "application/pdf",
      bytes: Uint8Array.from([1]),
    });

    assert.equal(unsafeOwner.ok, false);
    if (!unsafeOwner.ok) assert.equal(unsafeOwner.error.code, "invalid-input");
    assert.equal(unsafeName.ok, false);
    if (!unsafeName.ok) assert.equal(unsafeName.error.code, "invalid-input");
    assert.equal(failedWrite.ok, false);
    if (!failedWrite.ok) assert.equal(failedWrite.error.code, "unavailable");
    assert.equal((await storage.get("events/event-1/speakers/speaker-1/object-3")).ok, false);
  });

  test("rejects malformed Unicode filenames without throwing", async () => {
    const result = await createService().write({
      ...owner,
      fileName: "slides\uD800.pdf",
      contentType: "application/pdf",
      bytes: Uint8Array.from([1]),
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid-input");
  });

  test("truncates filenames without splitting an astral character", async () => {
    const result = await createService().write({
      ...owner,
      fileName: `${"a".repeat(254)}💡.pdf`,
      contentType: "application/pdf",
      bytes: Uint8Array.from([1]),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.fileName, "a".repeat(254));
    assert.equal(result.value.fileName.isWellFormed(), true);
  });

  test("percent-encodes RFC 5987 characters that encodeURIComponent leaves bare", async () => {
    const result = await createService().write({
      ...owner,
      fileName: "speaker's (final)*.pdf",
      contentType: "application/pdf",
      bytes: Uint8Array.from([1]),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.value.contentDisposition, /filename\*=UTF-8''speaker%27s%20%28final%29%2A\.pdf$/);
  });
});

describe("configurable file storage adapters", () => {
  test("selects in-memory storage and rejects traversal keys", async () => {
    const storage = createFileStorage({ driver: "memory" });
    const result = await storage.put({
      key: "../outside",
      contentType: "text/plain",
      bytes: Uint8Array.from([1]),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid-input");
  });

  test("persists local objects atomically with metadata and deletes them", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "board-to-death-files-"));
    try {
      const storage = new LocalFileStorage({ rootDirectory });
      const bytes = Uint8Array.from([4, 5, 6]);
      const written = await storage.put({
        key: "events/event-1/speakers/speaker-1/object-1",
        contentType: "application/pdf",
        contentDisposition: 'attachment; filename="slides.pdf"',
        metadata: { owner: "speaker-1" },
        bytes,
      });
      bytes[0] = 9;
      const fetched = await storage.get("events/event-1/speakers/speaker-1/object-1");

      assert.equal(written.ok, true);
      assert.equal(fetched.ok, true);
      if (fetched.ok) {
        assert.deepEqual(fetched.value.bytes, Uint8Array.from([4, 5, 6]));
        assert.equal(fetched.value.metadata.metadata.owner, "speaker-1");
        assert.equal(fetched.value.metadata.contentDisposition, 'attachment; filename="slides.pdf"');
      }
      assert.deepEqual(await storage.delete("events/event-1/speakers/speaker-1/object-1"), {
        ok: true,
        value: true,
      });
      assert.deepEqual(await storage.delete("events/event-1/speakers/speaker-1/object-1"), {
        ok: true,
        value: false,
      });
      const missing = await storage.get("events/event-1/speakers/speaker-1/object-1");
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.equal(missing.error.code, "not-found");
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });
});
