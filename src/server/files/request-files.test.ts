import JSZip from "jszip";
import { describe, test } from "vitest";

import { InMemoryFileStorage } from "../infrastructure/fakes.ts";
import { createFileRequestBundle } from "./exports.ts";
import {
  type EventFileEntry,
  type EventFileLibraryEntry,
  type FileRequestAssignmentRecord,
  FileRequestFileService,
  type FileRequestPolicySnapshot,
  type FileRequestStore,
  type RecordFileInput,
  type RecordFileResult,
  type StoredFileRecord,
} from "./request-files.ts";
import assert from "node:assert/strict";

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

const policy: FileRequestPolicySnapshot = {
  allowedContentTypes: ["application/pdf"],
  maxBytes: 1024,
  replacementPolicy: "REPLACE_LATEST",
};

/**
 * The store port stands in for the Prisma tables: `recordFile` supersedes the same way
 * `prisma-store.ts` does inside its transaction, so the service's replacement policy can be
 * exercised without a database.
 */
class FakeFileRequestStore implements FileRequestStore {
  readonly assignments = new Map<string, FileRequestAssignmentRecord>();
  readonly files: StoredFileRecord[] = [];
  readonly groupMembers = new Map<string, Set<string>>();
  readonly submissionSpeakers = new Map<string, Set<string>>();
  recordFailure?: Error;
  #sequence = 0;

  addAssignment(assignment: Partial<FileRequestAssignmentRecord> & { readonly id: string }): void {
    this.assignments.set(assignment.id, {
      eventId: "event-1",
      requestId: "request-1",
      requestTitle: "Signed contract",
      requestKey: "signed-contract",
      status: "PENDING",
      requestArchived: false,
      policy,
      contactId: null,
      groupId: null,
      submissionId: null,
      ...assignment,
    });
  }

  async findAssignment(eventId: string, assignmentId: string): Promise<FileRequestAssignmentRecord | undefined> {
    const assignment = this.assignments.get(assignmentId);
    return assignment?.eventId === eventId ? assignment : undefined;
  }

  async listAssignmentFiles(assignmentId: string, includeSuperseded: boolean): Promise<readonly StoredFileRecord[]> {
    return this.files.filter(
      (file) => file.assignmentId === assignmentId && (includeSuperseded || file.supersededAt === null),
    );
  }

  async recordFile(input: RecordFileInput): Promise<RecordFileResult> {
    if (this.recordFailure) {
      throw this.recordFailure;
    }
    if (input.supersedeExisting) {
      for (const [index, file] of this.files.entries()) {
        if (file.assignmentId === input.assignmentId && file.supersededAt === null) {
          this.files[index] = { ...file, supersededAt: new Date("2027-01-01T00:00:00.000Z") };
        }
      }
    }
    this.#sequence += 1;
    const file: StoredFileRecord = {
      id: `file-${this.#sequence}`,
      assignmentId: input.assignmentId,
      objectKey: input.objectKey,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.size,
      uploadedAt: new Date("2027-01-02T00:00:00.000Z"),
      supersededAt: null,
    };
    this.files.push(file);
    return { file };
  }

  async isGroupMember(_eventId: string, groupId: string, contactId: string): Promise<boolean> {
    return this.groupMembers.get(groupId)?.has(contactId) ?? false;
  }

  async isSubmissionSpeaker(_eventId: string, submissionId: string, speakerId: string): Promise<boolean> {
    return this.submissionSpeakers.get(submissionId)?.has(speakerId) ?? false;
  }

  async listEventFiles(eventId: string): Promise<readonly EventFileEntry[]> {
    return this.files
      .filter((file) => file.supersededAt === null)
      .flatMap((file) => {
        const assignment = this.assignments.get(file.assignmentId);
        if (!assignment || assignment.eventId !== eventId) {
          return [];
        }
        return [
          {
            requestKey: assignment.requestKey,
            requestTitle: assignment.requestTitle,
            targetLabel: assignment.contactId ?? assignment.groupId ?? assignment.submissionId ?? "unassigned",
            file,
          },
        ];
      });
  }

  async listEventFileLibrary(eventId: string): Promise<readonly EventFileLibraryEntry[]> {
    return (await this.listEventFiles(eventId)).map((entry) => ({
      ...entry,
      uploaderLabel: "Organizer",
      versionCount: 1,
    }));
  }
}

function createService(store: FakeFileRequestStore, storage = new InMemoryFileStorage()) {
  let sequence = 0;
  return {
    storage,
    store,
    service: new FileRequestFileService({ storage, store, createObjectId: () => `object-${++sequence}` }),
  };
}

const admin = { role: "admin", eventId: "event-1" } as const;

describe("file request uploads", () => {
  test("stores an upload under the assignment and normalizes the browser-supplied name", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    const { service, storage } = createService(store);

    const stored = await service.upload(
      { role: "contact", eventId: "event-1", contactId: "contact-1" },
      "assignment-1",
      {
        fileName: "../../Signed contract résumé.pdf",
        contentType: "application/pdf",
        bytes: PDF,
      },
    );

    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    assert.equal(stored.value.key, "events/event-1/file-requests/request-1/assignments/assignment-1/object-1");
    assert.equal(stored.value.fileName, "Signed contract résumé.pdf");
    assert.match(stored.value.contentDisposition, /^attachment; filename="Signed contract r_sum_.pdf";/);
    assert.equal(stored.value.size, PDF.length);

    const object = await storage.get(stored.value.key);
    assert.equal(object.ok, true);
    if (object.ok) {
      assert.deepEqual(object.value.bytes, PDF);
      assert.equal(object.value.metadata.metadata["owner-assignment-id"], "assignment-1");
    }
  });

  test("refuses an unusable file name", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    const { service } = createService(store);

    const stored = await service.upload(admin, "assignment-1", {
      fileName: "  ../  ",
      contentType: "application/pdf",
      bytes: PDF,
    });

    assert.equal(stored.ok, false);
    if (!stored.ok) assert.equal(stored.error.code, "invalid-input");
  });

  test("refuses a type outside the captured allowlist, oversized bytes, and mismatched contents", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    const { service } = createService(store);
    const upload = (contentType: string, bytes: Uint8Array) =>
      service.upload(admin, "assignment-1", { fileName: "answer.pdf", contentType, bytes });

    const wrongType = await upload("image/png", PNG);
    const oversized = await upload("application/pdf", new Uint8Array(1025).fill(0x25));
    const mismatched = await upload("application/pdf", PNG);
    const empty = await upload("application/pdf", new Uint8Array());

    assert.equal(wrongType.ok, false);
    if (!wrongType.ok) assert.match(wrongType.error.message, /not accepted/);
    assert.equal(oversized.ok, false);
    if (!oversized.ok) assert.match(oversized.error.message, /exceeds the 0\.0 MB limit/);
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.match(mismatched.error.message, /do not match its declared type/);
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.error.message, /empty/);
  });

  test("deletes the stored object when the database write fails", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    const { service, storage } = createService(store);
    store.recordFailure = new Error("unique constraint violated");

    const stored = await service.upload(admin, "assignment-1", {
      fileName: "answer.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });

    assert.equal(stored.ok, false);
    if (!stored.ok) {
      assert.equal(stored.error.code, "unexpected");
      assert.equal(stored.error.message, "unique constraint violated");
    }
    const orphan = await storage.get("events/event-1/file-requests/request-1/assignments/assignment-1/object-1");
    assert.equal(orphan.ok, false);
    if (!orphan.ok) assert.equal(orphan.error.code, "not-found");
  });
});

describe("file request replacement policy", () => {
  test("replaces the previous file while retaining its object under REPLACE_LATEST", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    const { service, storage } = createService(store);
    const upload = (fileName: string) =>
      service.upload(admin, "assignment-1", { fileName, contentType: "application/pdf", bytes: PDF });

    const first = await upload("first.pdf");
    const second = await upload("second.pdf");
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;

    const current = await service.list(admin, "assignment-1");
    const withHistory = await service.list(admin, "assignment-1", { includeSuperseded: true });
    assert.equal(current.ok && withHistory.ok, true);
    if (!current.ok || !withHistory.ok) return;
    assert.deepEqual(
      current.value.map((file) => file.fileName),
      ["second.pdf"],
    );
    assert.equal(withHistory.value.length, 2);

    const replacedObject = await storage.get(first.value.key);
    assert.equal(replacedObject.ok, true);
  });

  test("keeps every file and its object under KEEP_HISTORY", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({
      id: "assignment-1",
      contactId: "contact-1",
      policy: { ...policy, replacementPolicy: "KEEP_HISTORY" },
    });
    const { service, storage } = createService(store);
    const upload = (fileName: string) =>
      service.upload(admin, "assignment-1", { fileName, contentType: "application/pdf", bytes: PDF });

    const first = await upload("first.pdf");
    await upload("second.pdf");
    const current = await service.list(admin, "assignment-1");

    assert.equal(first.ok, true);
    assert.equal(current.ok, true);
    if (!first.ok || !current.ok) return;
    assert.deepEqual(
      current.value.map((file) => file.fileName),
      ["first.pdf", "second.pdf"],
    );
    assert.equal((await storage.get(first.value.key)).ok, true);
  });

  test("hides a replaced file from respondents but keeps it downloadable for administrators", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    const { service } = createService(store);
    const contact = { role: "contact", eventId: "event-1", contactId: "contact-1" } as const;
    const first = await service.upload(contact, "assignment-1", {
      fileName: "first.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    await service.upload(contact, "assignment-1", {
      fileName: "second.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const respondentView = await service.list(contact, "assignment-1", { includeSuperseded: true });
    const respondentDownload = await service.download(contact, "assignment-1", first.value.id);
    const adminDownload = await service.download(admin, "assignment-1", first.value.id);

    assert.equal(respondentView.ok, true);
    if (respondentView.ok) assert.equal(respondentView.value.length, 1);
    assert.equal(respondentDownload.ok, false);
    assert.equal(adminDownload.ok, true);
    if (adminDownload.ok) assert.deepEqual(adminDownload.value.bytes, PDF);
  });
});

describe("file request access", () => {
  test("refuses an assignment that belongs to another event", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    const { service } = createService(store);

    const otherAdmin = await service.list({ role: "admin", eventId: "event-2" }, "assignment-1");
    const otherContact = await service.list(
      { role: "contact", eventId: "event-2", contactId: "contact-1" },
      "assignment-1",
    );

    assert.equal(otherAdmin.ok, false);
    if (!otherAdmin.ok) assert.equal(otherAdmin.error.code, "not-found");
    assert.equal(otherContact.ok, false);
    if (!otherContact.ok) assert.equal(otherContact.error.code, "not-found");
  });

  test("admits the assigned contact, a member of an assigned group, and a submission speaker", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    store.addAssignment({ id: "assignment-2", groupId: "group-1" });
    store.addAssignment({ id: "assignment-3", submissionId: "submission-1" });
    store.groupMembers.set("group-1", new Set(["contact-2"]));
    store.submissionSpeakers.set("submission-1", new Set(["speaker-1"]));
    const { service } = createService(store);

    const assigned = await service.list(
      { role: "contact", eventId: "event-1", contactId: "contact-1" },
      "assignment-1",
    );
    const member = await service.list({ role: "contact", eventId: "event-1", contactId: "contact-2" }, "assignment-2");
    const speaker = await service.list({ role: "speaker", eventId: "event-1", speakerId: "speaker-1" }, "assignment-3");
    const stranger = await service.list(
      { role: "contact", eventId: "event-1", contactId: "contact-9" },
      "assignment-1",
    );
    const otherSpeaker = await service.list(
      { role: "speaker", eventId: "event-1", speakerId: "speaker-9" },
      "assignment-3",
    );

    assert.equal(assigned.ok, true);
    assert.equal(member.ok, true);
    assert.equal(speaker.ok, true);
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.error.code, "unauthorized");
    assert.equal(otherSpeaker.ok, false);
    if (!otherSpeaker.ok) assert.equal(otherSpeaker.error.code, "unauthorized");
  });

  test("closes a withdrawn assignment and an archived request to respondents only", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1", status: "WITHDRAWN" });
    store.addAssignment({ id: "assignment-2", contactId: "contact-1", requestArchived: true });
    const { service } = createService(store);
    const contact = { role: "contact", eventId: "event-1", contactId: "contact-1" } as const;

    const withdrawnUpload = await service.upload(contact, "assignment-1", {
      fileName: "answer.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    const archivedUpload = await service.upload(contact, "assignment-2", {
      fileName: "answer.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    const adminUpload = await service.upload(admin, "assignment-1", {
      fileName: "answer.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    const adminList = await service.list(admin, "assignment-1");

    assert.equal(withdrawnUpload.ok, false);
    if (!withdrawnUpload.ok) assert.equal(withdrawnUpload.error.code, "not-found");
    assert.equal(archivedUpload.ok, false);
    if (!archivedUpload.ok) assert.equal(archivedUpload.error.code, "not-found");
    // An administrator still reads what a withdrawn assignment collected, but cannot add to it.
    assert.equal(adminUpload.ok, false);
    if (!adminUpload.ok) assert.equal(adminUpload.error.code, "conflict");
    assert.equal(adminList.ok, true);
  });
});

describe("file request export", () => {
  test("packs every current file for the event, foldered by request, with a manifest", async () => {
    const store = new FakeFileRequestStore();
    store.addAssignment({ id: "assignment-1", contactId: "contact-1" });
    store.addAssignment({ id: "assignment-2", contactId: "contact-2" });
    store.addAssignment({ id: "assignment-3", contactId: "contact-3", eventId: "event-2" });
    const { service } = createService(store);
    const upload = (assignmentId: string, fileName: string) =>
      service.upload(
        { role: "admin", eventId: store.assignments.get(assignmentId)?.eventId ?? "event-1" },
        assignmentId,
        {
          fileName,
          contentType: "application/pdf",
          bytes: PDF,
        },
      );

    await upload("assignment-1", "signed.pdf");
    await upload("assignment-1", "signed.pdf");
    await upload("assignment-2", "signed.pdf");
    await upload("assignment-3", "other-event.pdf");

    const collected = await service.collectForEvent("event-1");
    assert.equal(collected.ok, true);
    if (!collected.ok) return;
    // The replaced first upload is not exported, and the other event's file is not visible.
    assert.equal(collected.value.length, 2);

    const archive = await JSZip.loadAsync(await createFileRequestBundle(collected.value));
    // JSZip records the per-request folder as its own entry; only the file entries matter here.
    const paths = Object.values(archive.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(paths, [
      "manifest.json",
      "signed-contract/contact-1-signed.pdf",
      "signed-contract/contact-2-signed.pdf",
    ]);

    const manifest = JSON.parse((await archive.file("manifest.json")?.async("string")) ?? "{}");
    assert.equal(manifest.files.length, 2);
    assert.deepEqual(
      manifest.files.map((entry: { readonly requestTitle: string }) => entry.requestTitle),
      ["Signed contract", "Signed contract"],
    );
    assert.deepEqual(await archive.file("signed-contract/contact-2-signed.pdf")?.async("uint8array"), PDF);
  });
});
