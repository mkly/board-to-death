import { PrismaPg } from "@prisma/adapter-pg";

import { ContactGroupKind, EventType, PrismaClient } from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { DeterministicClock, DeterministicTokenGenerator, InMemoryFileStorage } from "../infrastructure/fakes.ts";
import { FileRequestFulfillmentLinkError, FileRequestFulfillmentLinkService } from "./fulfillment-links.ts";
import { createPrismaFileRequestStore } from "./prisma-store.ts";
import {
  archiveFileRequest,
  assignFileRequest,
  createFileRequest,
  getCurrentVersion,
  listFileRequests,
  listRequestAssignments,
  restoreFileRequest,
  slugifyRequestKey,
  updateFileRequest,
  withdrawAssignment,
} from "./repositories.ts";
import { FileRequestFileService } from "./request-files.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for file request persistence integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PDF_ONLY = { allowedContentTypes: ["application/pdf"], maxBytes: 1024 } as const;

async function createEvent(slug: string): Promise<string> {
  const event = await events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-06-10T17:00:00.000Z"),
    endsAt: new Date("2027-06-12T00:00:00.000Z"),
  });
  return event.id;
}

async function createContact(eventId: string, email: string): Promise<string> {
  const contact = await client.contact.create({
    data: { eventId, email, givenName: "Dana", familyName: "Reed" },
  });
  return contact.id;
}

async function createGroup(eventId: string, slug: string): Promise<string> {
  const group = await client.contactGroup.create({
    data: { eventId, slug, name: slug, kind: ContactGroupKind.SPONSOR },
  });
  return group.id;
}

async function expectRepositoryError(promise: Promise<unknown>, code: RepositoryError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

describe("file request persistence", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("derives a per-event key and appends a version instead of mutating the current one", async () => {
    const eventId = await createEvent("file-request-versions");
    const request = await createFileRequest(client, {
      eventId,
      targetKind: "CONTACT",
      title: "Signed Sponsor Contract",
      instructions: "  Return the countersigned PDF.  ",
      dueOffsetDays: 14,
      ...PDF_ONLY,
    });

    assert.equal(request.key, slugifyRequestKey("Signed Sponsor Contract"));
    assert.equal(request.currentVersion.versionNumber, 1);
    assert.equal(request.currentVersion.instructions, "Return the countersigned PDF.");
    assert.equal(request.currentVersion.replacementPolicy, "REPLACE_LATEST");

    const second = await updateFileRequest(client, eventId, request.id, {
      title: "Signed sponsor contract",
      maxBytes: 2048,
      replacementPolicy: "KEEP_HISTORY",
    });

    assert.equal(second.versionNumber, 2);
    assert.equal(second.maxBytes, 2048);
    assert.equal(second.instructions, "Return the countersigned PDF.");
    assert.deepEqual((await getCurrentVersion(client, eventId, request.id)).id, second.id);

    // The first version is retained: assignments created against it keep its policy.
    const versions = await client.fileRequestVersion.findMany({ where: { requestId: request.id } });
    assert.equal(versions.length, 2);
  });

  test("refuses a request whose accepted types cannot be verified", async () => {
    const eventId = await createEvent("file-request-types");
    await expectRepositoryError(
      createFileRequest(client, {
        eventId,
        targetKind: "CONTACT",
        title: "Headshot",
        allowedContentTypes: ["application/zip"],
        maxBytes: 1024,
      }),
      "invalid-input",
    );
    await expectRepositoryError(
      createFileRequest(client, {
        eventId,
        targetKind: "CONTACT",
        title: "Headshot",
        allowedContentTypes: [],
        maxBytes: 1024,
      }),
      "invalid-input",
    );
  });

  test("assigns against the current version and derives the due date from the event start", async () => {
    const eventId = await createEvent("file-request-assignment");
    const contactId = await createContact(eventId, "dana@example.test");
    const request = await createFileRequest(client, {
      eventId,
      targetKind: "CONTACT",
      title: "Contract",
      dueOffsetDays: 7,
      ...PDF_ONLY,
    });
    const firstVersion = request.currentVersion;
    const assignment = await assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId });

    assert.equal(assignment.requestVersionId, firstVersion.id);
    assert.equal(assignment.dueAt?.toISOString(), "2027-06-03T17:00:00.000Z");
    assert.equal(assignment.status, "PENDING");

    // Editing the request afterwards leaves the assignment on the version it captured.
    await updateFileRequest(client, eventId, request.id, { maxBytes: 4096 });
    const assignments = await listRequestAssignments(client, eventId, request.id);
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0]?.version.id, firstVersion.id);
    assert.equal(assignments[0]?.version.maxBytes, PDF_ONLY.maxBytes);
    assert.deepEqual(assignments[0]?.target, { kind: "CONTACT", id: contactId, label: "Dana Reed" });
  });

  test("refuses a mismatched target kind, another event's target, an archived target, and a repeat assignment", async () => {
    const eventId = await createEvent("file-request-targets");
    const otherEventId = await createEvent("file-request-targets-other");
    const contactId = await createContact(eventId, "dana@example.test");
    const foreignContactId = await createContact(otherEventId, "dana@example.test");
    const groupId = await createGroup(eventId, "sponsors");
    const request = await createFileRequest(client, { eventId, targetKind: "CONTACT", title: "Contract", ...PDF_ONLY });

    await expectRepositoryError(
      assignFileRequest(client, eventId, request.id, { kind: "GROUP", groupId }),
      "invalid-input",
    );
    await expectRepositoryError(
      assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId: foreignContactId }),
      "not-found",
    );

    await assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId });
    await expectRepositoryError(
      assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId }),
      "conflict",
    );

    const archivedContactId = await createContact(eventId, "archived@example.test");
    await client.contact.update({ where: { id: archivedContactId }, data: { archivedAt: new Date() } });
    await expectRepositoryError(
      assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId: archivedContactId }),
      "invalid-input",
    );
  });

  test("archiving hides a request from the default list and closes it to new assignments", async () => {
    const eventId = await createEvent("file-request-archive");
    const contactId = await createContact(eventId, "dana@example.test");
    const request = await createFileRequest(client, { eventId, targetKind: "CONTACT", title: "Contract", ...PDF_ONLY });

    await archiveFileRequest(client, eventId, request.id);
    assert.equal((await listFileRequests(client, eventId)).length, 0);
    assert.equal((await listFileRequests(client, eventId, { includeArchived: true })).length, 1);
    await expectRepositoryError(
      assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId }),
      "invalid-input",
    );

    await restoreFileRequest(client, eventId, request.id);
    assert.equal((await listFileRequests(client, eventId)).length, 1);
    assert.equal(
      (await assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId })).status,
      "PENDING",
    );
  });

  test("withdrawn assignments leave the request's active counts", async () => {
    const eventId = await createEvent("file-request-counts");
    const request = await createFileRequest(client, { eventId, targetKind: "CONTACT", title: "Contract", ...PDF_ONLY });
    const kept = await assignFileRequest(client, eventId, request.id, {
      kind: "CONTACT",
      contactId: await createContact(eventId, "kept@example.test"),
    });
    const dropped = await assignFileRequest(client, eventId, request.id, {
      kind: "CONTACT",
      contactId: await createContact(eventId, "dropped@example.test"),
    });

    const withdrawn = await withdrawAssignment(client, eventId, dropped.id);
    assert.equal(withdrawn.status, "WITHDRAWN");
    assert.ok(withdrawn.withdrawnAt);

    const [listed] = await listFileRequests(client, eventId);
    assert.equal(listed?.assignmentCount, 1);
    assert.equal(listed?.fulfilledCount, 0);
    // The withdrawn row is still readable to an administrator on the request's own screen.
    assert.equal((await listRequestAssignments(client, eventId, request.id)).length, 2);
    assert.equal(kept.status, "PENDING");
  });

  test("refuses an assignment id that belongs to another event", async () => {
    const eventId = await createEvent("file-request-isolation");
    const otherEventId = await createEvent("file-request-isolation-other");
    const request = await createFileRequest(client, { eventId, targetKind: "CONTACT", title: "Contract", ...PDF_ONLY });
    const assignment = await assignFileRequest(client, eventId, request.id, {
      kind: "CONTACT",
      contactId: await createContact(eventId, "dana@example.test"),
    });

    await expectRepositoryError(withdrawAssignment(client, otherEventId, assignment.id), "not-found");
  });
});

describe("file request storage through the Prisma store", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("records an upload, fulfils the assignment, and retains the previous file as a version", async () => {
    const eventId = await createEvent("file-request-uploads");
    const contactId = await createContact(eventId, "dana@example.test");
    const request = await createFileRequest(client, { eventId, targetKind: "CONTACT", title: "Contract", ...PDF_ONLY });
    const assignment = await assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId });
    const storage = new InMemoryFileStorage();
    const files = new FileRequestFileService({ storage, store: createPrismaFileRequestStore(client) });
    const contact = { role: "contact", eventId, contactId } as const;

    const first = await files.upload(contact, assignment.id, {
      fileName: "contract.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(
      (await client.fileRequestAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).status,
      "FULFILLED",
    );

    const second = await files.upload(contact, assignment.id, {
      fileName: "contract-final.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    assert.equal(second.ok, true);

    const current = await files.list(contact, assignment.id);
    assert.equal(current.ok, true);
    if (current.ok) {
      assert.deepEqual(
        current.value.map((file) => file.fileName),
        ["contract-final.pdf"],
      );
    }
    assert.equal(await client.fileRequestFile.count({ where: { assignmentId: assignment.id } }), 2);
    assert.equal((await storage.get(first.value.key)).ok, true);

    const library = await createPrismaFileRequestStore(client).listEventFileLibrary(eventId);
    assert.equal(library.length, 1);
    assert.equal(library[0]?.file.fileName, "contract-final.pdf");
    assert.equal(library[0]?.uploaderLabel, "Dana Reed");
    assert.equal(library[0]?.versionCount, 2);
  });

  test("admits a member of an assigned group and refuses a contact outside it", async () => {
    const eventId = await createEvent("file-request-groups");
    const groupId = await createGroup(eventId, "sponsors");
    const memberId = await createContact(eventId, "member@example.test");
    const outsiderId = await createContact(eventId, "outsider@example.test");
    await client.contactGroupMember.create({ data: { eventId, groupId, contactId: memberId } });
    const request = await createFileRequest(client, { eventId, targetKind: "GROUP", title: "Logo pack", ...PDF_ONLY });
    const assignment = await assignFileRequest(client, eventId, request.id, { kind: "GROUP", groupId });
    const files = new FileRequestFileService({
      storage: new InMemoryFileStorage(),
      store: createPrismaFileRequestStore(client),
    });

    const member = await files.upload({ role: "contact", eventId, contactId: memberId }, assignment.id, {
      fileName: "logo.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    const outsider = await files.list({ role: "contact", eventId, contactId: outsiderId }, assignment.id);

    assert.equal(member.ok, true);
    assert.equal(outsider.ok, false);
    if (!outsider.ok) assert.equal(outsider.error.code, "unauthorized");
  });

  test("issues event-scoped single-use links and records the contact who fulfills the request", async () => {
    const eventId = await createEvent("file-request-fulfillment-links");
    const otherEventId = await createEvent("file-request-fulfillment-links-other");
    const contactId = await createContact(eventId, "dana@example.test");
    const request = await createFileRequest(client, {
      eventId,
      targetKind: "CONTACT",
      title: "Signed contract",
      instructions: "Upload the signed PDF.",
      ...PDF_ONLY,
    });
    const assignment = await assignFileRequest(client, eventId, request.id, { kind: "CONTACT", contactId });
    const clock = new DeterministicClock("2027-01-01T00:00:00.000Z");
    const links = new FileRequestFulfillmentLinkService({
      clock,
      database: client,
      tokenGenerator: new DeterministicTokenGenerator("file-request"),
    });

    await assert.rejects(
      links.issue(otherEventId, assignment.id),
      (error: unknown) => error instanceof FileRequestFulfillmentLinkError && error.code === "not-found",
    );
    const [issued] = await links.issue(eventId, assignment.id);
    assert.ok(issued);
    assert.notEqual(
      (await client.fileRequestFulfillmentLink.findFirstOrThrow({ where: { assignmentId: assignment.id } })).tokenHash,
      issued.token,
    );
    assert.equal((await links.resolve(issued.token)).title, "Signed contract");

    const files = new FileRequestFileService({
      storage: new InMemoryFileStorage(),
      store: createPrismaFileRequestStore(client),
    });
    const rejected = await links.fulfill(
      issued.token,
      { fileName: "contract.pdf", contentType: "application/pdf", bytes: Uint8Array.from([1, 2, 3]) },
      files,
    );
    assert.equal(rejected.ok, false);
    assert.equal((await links.resolve(issued.token)).assignmentId, assignment.id);

    const uploaded = await links.fulfill(
      issued.token,
      { fileName: "contract.pdf", contentType: "application/pdf", bytes: PDF },
      files,
    );
    assert.equal(uploaded.ok, true);
    assert.equal(
      (await client.fileRequestFile.findFirstOrThrow({ where: { assignmentId: assignment.id } })).uploadedByContactId,
      contactId,
    );
    await assert.rejects(
      links.resolve(issued.token),
      (error: unknown) => error instanceof FileRequestFulfillmentLinkError && error.code === "invalid-token",
    );
  });

  test("issues a group link to every active member and closes it when membership is removed", async () => {
    const eventId = await createEvent("file-request-group-fulfillment-links");
    const groupId = await createGroup(eventId, "sponsors");
    const firstContactId = await createContact(eventId, "first@example.test");
    const secondContactId = await createContact(eventId, "second@example.test");
    await client.contactGroupMember.createMany({
      data: [
        { eventId, groupId, contactId: firstContactId },
        { eventId, groupId, contactId: secondContactId },
      ],
    });
    const request = await createFileRequest(client, {
      eventId,
      targetKind: "GROUP",
      title: "Sponsor logo",
      ...PDF_ONLY,
    });
    const assignment = await assignFileRequest(client, eventId, request.id, { kind: "GROUP", groupId });
    const links = new FileRequestFulfillmentLinkService({
      database: client,
      tokenGenerator: new DeterministicTokenGenerator("group"),
    });

    const issued = await links.issue(eventId, assignment.id);
    assert.deepEqual(
      issued.map((link) => link.email),
      ["first@example.test", "second@example.test"],
    );
    await client.contactGroupMember.delete({ where: { groupId_contactId: { groupId, contactId: firstContactId } } });
    await assert.rejects(
      links.resolve(issued[0]?.token ?? ""),
      (error: unknown) => error instanceof FileRequestFulfillmentLinkError && error.code === "invalid-token",
    );
    assert.equal((await links.resolve(issued[1]?.token ?? "")).contactId, secondContactId);
  });

  test("collects only this event's current files for the archive export", async () => {
    const eventId = await createEvent("file-request-export");
    const otherEventId = await createEvent("file-request-export-other");
    const files = new FileRequestFileService({
      storage: new InMemoryFileStorage(),
      store: createPrismaFileRequestStore(client),
    });

    for (const [event, name] of [
      [eventId, "ours.pdf"],
      [otherEventId, "theirs.pdf"],
    ] as const) {
      const request = await createFileRequest(client, {
        eventId: event,
        targetKind: "CONTACT",
        title: "Contract",
        ...PDF_ONLY,
      });
      const assignment = await assignFileRequest(client, event, request.id, {
        kind: "CONTACT",
        contactId: await createContact(event, "dana@example.test"),
      });
      const stored = await files.upload({ role: "admin", eventId: event }, assignment.id, {
        fileName: name,
        contentType: "application/pdf",
        bytes: PDF,
      });
      assert.equal(stored.ok, true);
    }

    const collected = await files.collectForEvent(eventId);
    assert.equal(collected.ok, true);
    if (!collected.ok) return;
    assert.deepEqual(
      collected.value.map((entry) => entry.file.fileName),
      ["ours.pdf"],
    );
    assert.equal(collected.value[0]?.targetLabel, "Dana Reed");
    assert.deepEqual(collected.value[0]?.bytes, PDF);
  });
});
