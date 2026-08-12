"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import type { FileRequestReplacementPolicy, FileRequestTargetKind } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { deliverFileRequestFulfillmentLinks } from "@/server/files/fulfillment-email";
import { FileRequestFulfillmentLinkError, FileRequestFulfillmentLinkService } from "@/server/files/fulfillment-links";
import {
  archiveFileRequest,
  assignFileRequest,
  createFileRequest,
  type FileRequestTarget,
  restoreFileRequest,
  updateFileRequest,
  withdrawAssignment,
} from "@/server/files/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";

const TARGET_KINDS: readonly FileRequestTargetKind[] = ["CONTACT", "GROUP", "SUBMISSION"];
const REPLACEMENT_POLICIES: readonly FileRequestReplacementPolicy[] = ["REPLACE_LATEST", "KEEP_HISTORY"];

interface AuthorizedFileRequestEvent {
  readonly id: string;
  readonly slug: string;
}

async function requireAuthorizedEvent(eventSlug: string): Promise<AuthorizedFileRequestEvent> {
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);

  if (!event || shell.activeEvent?.id !== event.id) notFound();
  return { id: event.id, slug: event.slug };
}

function indexPath(eventSlug: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/file-requests`;
}

export interface FileRequestActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof RepositoryError || error instanceof FileRequestFulfillmentLinkError) return error.message;
  console.error(error);
  return "The file request could not be saved. Try again.";
}

function fail(error: unknown): FileRequestActionState {
  return { status: "error", message: errorMessage(error) };
}

function succeed(eventSlug: string, requestId: string | undefined, notice: string): FileRequestActionState {
  revalidatePath(indexPath(eventSlug));
  if (requestId) revalidatePath(`${indexPath(eventSlug)}/${requestId}`);
  return { status: "success", message: notice };
}

function requiredField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** The form collects a megabyte limit because that is the unit an administrator thinks in. */
function parseMaxBytes(formData: FormData): number {
  const megabytes = Number(optionalField(formData, "maxMegabytes") ?? "10");
  if (!Number.isFinite(megabytes) || megabytes <= 0) {
    throw new RepositoryError("invalid-input", "The size limit must be a positive number of megabytes.");
  }
  return Math.round(megabytes * 1024 * 1024);
}

function parseDueOffsetDays(formData: FormData): number | null {
  const raw = optionalField(formData, "dueOffsetDays");
  if (raw === undefined) return null;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0) {
    throw new RepositoryError("invalid-input", "The due offset must be zero or a whole number of days.");
  }
  return days;
}

function parseAllowedContentTypes(formData: FormData): string[] {
  return formData
    .getAll("allowedContentTypes")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function parseTargetKind(formData: FormData): FileRequestTargetKind {
  const value = requiredField(formData, "targetKind");
  const kind = TARGET_KINDS.find((candidate) => candidate === value);
  if (!kind)
    throw new RepositoryError("invalid-input", "Choose whether this request targets contacts, groups, or submissions.");
  return kind;
}

function parseReplacementPolicy(formData: FormData): FileRequestReplacementPolicy {
  const value = optionalField(formData, "replacementPolicy");
  return REPLACEMENT_POLICIES.find((candidate) => candidate === value) ?? "REPLACE_LATEST";
}

function buildTarget(kind: FileRequestTargetKind, targetId: string): FileRequestTarget {
  if (kind === "CONTACT") return { kind, contactId: targetId };
  if (kind === "GROUP") return { kind, groupId: targetId };
  return { kind, submissionId: targetId };
}

async function issueFulfillmentLinks(eventId: string, assignmentId: string): Promise<number> {
  const links = await new FileRequestFulfillmentLinkService({ database: getDatabaseClient() }).issue(
    eventId,
    assignmentId,
  );
  await deliverFileRequestFulfillmentLinks(links);
  return links.length;
}

export async function createFileRequestAction(
  eventSlug: string,
  _previousState: FileRequestActionState,
  formData: FormData,
): Promise<FileRequestActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  let requestId: string;
  try {
    const created = await createFileRequest(getDatabaseClient(), {
      eventId: event.id,
      targetKind: parseTargetKind(formData),
      title: requiredField(formData, "title"),
      instructions: optionalField(formData, "instructions") ?? null,
      dueOffsetDays: parseDueOffsetDays(formData),
      allowedContentTypes: parseAllowedContentTypes(formData),
      maxBytes: parseMaxBytes(formData),
      replacementPolicy: parseReplacementPolicy(formData),
    });
    requestId = created.id;
  } catch (error) {
    return fail(error);
  }
  return succeed(event.slug, requestId, "File request created.");
}

export async function updateFileRequestAction(
  eventSlug: string,
  requestId: string,
  _previousState: FileRequestActionState,
  formData: FormData,
): Promise<FileRequestActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await updateFileRequest(getDatabaseClient(), event.id, requestId, {
      title: requiredField(formData, "title"),
      instructions:
        formData.get("instructions") === null ? undefined : (optionalField(formData, "instructions") ?? null),
      dueOffsetDays: parseDueOffsetDays(formData),
      allowedContentTypes: parseAllowedContentTypes(formData),
      maxBytes: parseMaxBytes(formData),
      replacementPolicy: parseReplacementPolicy(formData),
    });
  } catch (error) {
    return fail(error);
  }
  return succeed(event.slug, requestId, "File request updated. New assignments use the new rules.");
}

export async function archiveFileRequestAction(eventSlug: string, requestId: string): Promise<FileRequestActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await archiveFileRequest(getDatabaseClient(), event.id, requestId);
  } catch (error) {
    return fail(error);
  }
  return succeed(event.slug, requestId, "File request archived. It no longer collects files.");
}

export async function restoreFileRequestAction(eventSlug: string, requestId: string): Promise<FileRequestActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await restoreFileRequest(getDatabaseClient(), event.id, requestId);
  } catch (error) {
    return fail(error);
  }
  return succeed(event.slug, requestId, "File request restored.");
}

export async function assignFileRequestAction(
  eventSlug: string,
  requestId: string,
  _previousState: FileRequestActionState,
  formData: FormData,
): Promise<FileRequestActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  let recipientCount = 0;
  let createdAssignmentId: string | undefined;
  try {
    const kind = parseTargetKind(formData);
    const targetId = requiredField(formData, "targetId");
    if (targetId === "") throw new RepositoryError("invalid-input", "Choose a target to assign this request to.");
    const assignment = await assignFileRequest(getDatabaseClient(), event.id, requestId, buildTarget(kind, targetId));
    createdAssignmentId = assignment.id;
    if (kind === "CONTACT" || kind === "GROUP") {
      recipientCount = await issueFulfillmentLinks(event.id, assignment.id);
    }
  } catch (error) {
    if (createdAssignmentId) {
      await getDatabaseClient().fileRequestAssignment.deleteMany({
        where: { eventId: event.id, id: createdAssignmentId, status: "PENDING", files: { none: {} } },
      });
    }
    return fail(error);
  }
  return succeed(
    event.slug,
    requestId,
    recipientCount > 0
      ? `File request assigned. A fulfillment link was sent to ${recipientCount} contact${recipientCount === 1 ? "" : "s"}.`
      : "File request assigned.",
  );
}

export async function resendFulfillmentLinkAction(
  eventSlug: string,
  requestId: string,
  assignmentId: string,
): Promise<FileRequestActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  let recipientCount = 0;
  try {
    recipientCount = await issueFulfillmentLinks(event.id, assignmentId);
  } catch (error) {
    return fail(error);
  }
  return succeed(
    event.slug,
    requestId,
    `A fresh fulfillment link was sent to ${recipientCount} contact${recipientCount === 1 ? "" : "s"}.`,
  );
}

export async function withdrawAssignmentAction(
  eventSlug: string,
  requestId: string,
  assignmentId: string,
): Promise<FileRequestActionState> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await withdrawAssignment(getDatabaseClient(), event.id, assignmentId);
  } catch (error) {
    return fail(error);
  }
  return succeed(event.slug, requestId, "Assignment withdrawn.");
}
