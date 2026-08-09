"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import type { FileRequestReplacementPolicy, FileRequestTargetKind } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
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

function destination(
  eventSlug: string,
  result: { readonly requestId?: string; readonly notice?: string; readonly error?: string },
): string {
  const search = new URLSearchParams();
  if (result.notice) search.set("notice", result.notice);
  if (result.error) search.set("error", result.error);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const requestPath = result.requestId ? `/${result.requestId}` : "";
  return `${indexPath(eventSlug)}${requestPath}${suffix}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  console.error(error);
  return "The file request could not be saved. Try again.";
}

function refreshAndRedirect(eventSlug: string, requestId: string | undefined, notice: string): never {
  revalidatePath(destination(eventSlug, { requestId }));
  redirect(destination(eventSlug, { requestId, notice }));
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

export async function createFileRequestAction(eventSlug: string, formData: FormData): Promise<never> {
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
    redirect(destination(event.slug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(event.slug, requestId, "File request created.");
}

export async function updateFileRequestAction(
  eventSlug: string,
  requestId: string,
  formData: FormData,
): Promise<never> {
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
    redirect(destination(event.slug, { requestId, error: errorMessage(error) }));
  }
  return refreshAndRedirect(event.slug, requestId, "File request updated. New assignments use the new rules.");
}

export async function archiveFileRequestAction(eventSlug: string, requestId: string): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await archiveFileRequest(getDatabaseClient(), event.id, requestId);
  } catch (error) {
    redirect(destination(event.slug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(event.slug, undefined, "File request archived. It no longer collects files.");
}

export async function restoreFileRequestAction(eventSlug: string, requestId: string): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await restoreFileRequest(getDatabaseClient(), event.id, requestId);
  } catch (error) {
    redirect(destination(event.slug, { error: errorMessage(error) }));
  }
  return refreshAndRedirect(event.slug, undefined, "File request restored.");
}

export async function assignFileRequestAction(
  eventSlug: string,
  requestId: string,
  formData: FormData,
): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    const kind = parseTargetKind(formData);
    const targetId = requiredField(formData, "targetId");
    if (targetId === "") throw new RepositoryError("invalid-input", "Choose a target to assign this request to.");
    await assignFileRequest(getDatabaseClient(), event.id, requestId, buildTarget(kind, targetId));
  } catch (error) {
    redirect(destination(event.slug, { requestId, error: errorMessage(error) }));
  }
  return refreshAndRedirect(event.slug, requestId, "File request assigned.");
}

export async function withdrawAssignmentAction(
  eventSlug: string,
  requestId: string,
  assignmentId: string,
): Promise<never> {
  const event = await requireAuthorizedEvent(eventSlug);
  try {
    await withdrawAssignment(getDatabaseClient(), event.id, assignmentId);
  } catch (error) {
    redirect(destination(event.slug, { requestId, error: errorMessage(error) }));
  }
  return refreshAndRedirect(event.slug, requestId, "Assignment withdrawn.");
}
