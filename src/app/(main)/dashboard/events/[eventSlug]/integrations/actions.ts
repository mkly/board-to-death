"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { IntegrationProvider, IntegrationRemoteRecordStatus, PublishedProgramState } from "@/generated/prisma/client";
import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { ApiTokenService } from "@/server/developer-api";
import {
  type ApiTokenScope,
  apiTokenScopes,
  type WebhookEventType,
  webhookEventTypes,
} from "@/server/developer-api/contracts";
import {
  disableWebhookEndpoint,
  processDueWebhookDeliveries,
  registerWebhookEndpoint,
} from "@/server/developer-api/webhooks";
import { RepositoryError } from "@/server/events/repositories";
import {
  AcceleventsProgramPushService,
  AcceleventsSessionMappingRepository,
  AcceleventsSessionPushService,
  AcceleventsSpeakerPushService,
  AcceleventsSyncRunService,
  DeterministicAcceleventsAdapter,
  SpeakerMappingRepository,
  speakerMappingSources,
} from "@/server/integrations";
import { PublishedProgramRepository } from "@/server/published-program";

import { randomUUID } from "node:crypto";

export interface SessionMappingMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

export interface SyncRunMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

export interface DeveloperAccessActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly secret?: string;
}

const speakerMappingSchema = z.object({
  email: z.enum(speakerMappingSources),
  firstName: z.enum(speakerMappingSources),
  lastName: z.enum(speakerMappingSources),
});

const sessionMappingSchema = z.object({
  eventSlug: z.string().trim().min(1),
  title: z.enum(["session.title", "event.name"]),
  description: z.enum(["session.description", "event.theme", "omit"]),
  speakers: z.enum(["linked-speakers", "omit"]),
});

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;
  return getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
}

function destination(eventSlug: string, key: "notice" | "error", message: string): string {
  const query = new URLSearchParams({ [key]: message });
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/integrations?${query}`;
}

export async function saveSpeakerMapping(eventSlug: string, formData: FormData): Promise<never> {
  const parsed = speakerMappingSchema.safeParse({
    email: formData.get("email"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) redirect(destination(eventSlug, "error", "Choose a valid local source for every field."));
  const event = await authorizedEvent(eventSlug);
  if (!event) redirect(destination(eventSlug, "error", "This event is not available."));

  try {
    const version = await new SpeakerMappingRepository(getDatabaseClient()).save(event.id, parsed.data);
    const path = `/dashboard/events/${encodeURIComponent(event.slug)}/integrations`;
    revalidatePath(path);
    redirect(destination(event.slug, "notice", `Speaker mapping version ${version} saved.`));
  } catch (error) {
    if (error instanceof RepositoryError) redirect(destination(event.slug, "error", error.message));
    throw error;
  }
}

function value(formData: FormData, name: string): string {
  const entry = formData.get(name);
  return typeof entry === "string" ? entry : "";
}

function checkedValues<T extends string>(formData: FormData, name: string, allowed: readonly T[]): T[] {
  return formData
    .getAll(name)
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry): entry is T => allowed.includes(entry as T));
}

export async function issueApiToken(
  _previousState: DeveloperAccessActionState,
  formData: FormData,
): Promise<DeveloperAccessActionState> {
  const eventSlug = value(formData, "eventSlug");
  const name = value(formData, "name").trim();
  const scopes = checkedValues<ApiTokenScope>(formData, "scopes", apiTokenScopes);
  if (!name || scopes.length === 0) return { status: "error", message: "Enter a name and choose at least one scope." };
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const issued = await new ApiTokenService(getDatabaseClient()).issue(event.id, name, scopes);
  revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
  return { status: "success", message: "Copy this token now. It will not be shown again.", secret: issued.secret };
}

export async function revokeApiToken(formData: FormData): Promise<void> {
  const event = await authorizedEvent(value(formData, "eventSlug"));
  if (!event) return;
  await new ApiTokenService(getDatabaseClient()).revoke(event.id, value(formData, "tokenId"));
  revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
}

export async function createWebhookEndpoint(
  _previousState: DeveloperAccessActionState,
  formData: FormData,
): Promise<DeveloperAccessActionState> {
  const eventSlug = value(formData, "eventSlug");
  const name = value(formData, "name").trim();
  const parsedUrl = z.url().safeParse(value(formData, "url"));
  const events = checkedValues<WebhookEventType>(formData, "events", webhookEventTypes);
  if (!name || !parsedUrl.success || events.length === 0) {
    return { status: "error", message: "Enter a valid endpoint name and URL, then choose at least one event." };
  }
  const protocol = new URL(parsedUrl.data).protocol;
  if (protocol !== "https:" && protocol !== "http:") {
    return { status: "error", message: "Webhook endpoints must use HTTP or HTTPS." };
  }
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const endpoint = await registerWebhookEndpoint(getDatabaseClient(), {
    eventId: event.id,
    name,
    url: parsedUrl.data,
    events,
  });
  revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
  return {
    status: "success",
    message: "Copy this signing secret now. It will not be shown again.",
    secret: endpoint.signingSecret,
  };
}

export async function disableWebhook(formData: FormData): Promise<void> {
  const event = await authorizedEvent(value(formData, "eventSlug"));
  if (!event) return;
  await disableWebhookEndpoint(getDatabaseClient(), event.id, value(formData, "endpointId"));
  revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
}

export async function retryDueWebhooks(formData: FormData): Promise<void> {
  const event = await authorizedEvent(value(formData, "eventSlug"));
  if (!event) return;
  await processDueWebhookDeliveries(getDatabaseClient(), { eventId: event.id });
  revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
}

function validationErrors(error: z.ZodError): Readonly<Record<string, readonly string[]>> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

export async function saveSessionMapping(
  _previousState: SessionMappingMutationState,
  formData: FormData,
): Promise<SessionMappingMutationState> {
  const parsed = sessionMappingSchema.safeParse({
    eventSlug: value(formData, "eventSlug"),
    title: value(formData, "title"),
    description: value(formData, "description"),
    speakers: value(formData, "speakers"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted mapping fields.",
      errors: validationErrors(parsed.error),
    };
  }

  const event = await authorizedEvent(parsed.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    const mapping = await new AcceleventsSessionMappingRepository(getDatabaseClient()).save(event.id, {
      title: parsed.data.title,
      description: parsed.data.description,
      speakers: parsed.data.speakers,
    });
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
    return { status: "success", message: `Mapping version ${mapping.versionNumber} saved.` };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function requestSyncRunCancellation(
  _previousState: SyncRunMutationState,
  formData: FormData,
): Promise<SyncRunMutationState> {
  const eventSlug = value(formData, "eventSlug");
  const runId = value(formData, "runId");
  if (!eventSlug || !runId) return { status: "error", message: "A sync run is required." };

  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    const requested = await new AcceleventsSyncRunService(getDatabaseClient()).requestCancellation(event.id, runId);
    if (!requested) return { status: "error", message: "This Accelevents sync run is no longer active." };
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
    return { status: "success", message: "Cancellation requested." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function pushAcceleventsProgram(
  _previousState: SyncRunMutationState,
  formData: FormData,
): Promise<SyncRunMutationState> {
  const eventSlug = value(formData, "eventSlug");
  if (!eventSlug) return { status: "error", message: "This event is not available." };
  if (value(formData, "confirmed") !== "true") {
    return { status: "error", message: "Confirm the push before sending the program to Accelevents." };
  }

  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  const client = getDatabaseClient();
  const configuration = await client.integrationConfiguration.findFirst({
    where: { eventId: event.id, provider: IntegrationProvider.ACCELEVENTS },
    select: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { remoteEventId: true } },
      remoteRecords: {
        where: { status: IntegrationRemoteRecordStatus.ACTIVE },
        select: { remoteId: true, resourceType: true },
      },
    },
  });
  const remoteEventId = configuration?.versions[0]?.remoteEventId;
  if (!remoteEventId) return { status: "error", message: "This event is not connected to Accelevents." };

  // The speaker half of the program push has no publication guard, while the session half refuses an
  // unpublished program. Without this check an unpublished event pushes speakers and then fails on
  // sessions, leaving the remote half-written.
  const published = await new PublishedProgramRepository(client).latest(event.id);
  if (published?.state !== PublishedProgramState.PUBLISHED) {
    return { status: "error", message: "Publish the program before pushing it to Accelevents." };
  }

  const connection = { remoteEventId, apiKey: "runtime-preview-key" };
  const adapter = new DeterministicAcceleventsAdapter({
    remoteEventId,
    apiKey: "runtime-preview-key",
    speakers: configuration.remoteRecords
      .filter((record) => record.resourceType === "speaker")
      .map((record, index) => ({
        remoteId: record.remoteId,
        email: `linked-${index}@preview.invalid`,
        firstName: "Linked",
        lastName: "Speaker",
      })),
    sessions: configuration.remoteRecords
      .filter((record) => record.resourceType === "session")
      .map((record) => ({
        remoteId: record.remoteId,
        title: "Remote session awaiting comparison",
        description: "",
        speakerRemoteIds: [],
      })),
  });

  try {
    const result = await new AcceleventsProgramPushService(client).push({
      eventId: event.id,
      idempotencyKey: randomUUID(),
      confirmed: true,
      adapter,
      connection,
    });
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
    return {
      status: "success",
      message: `Program push complete: ${result.speakers.records.length} speaker and ${result.sessions.records.length} session actions recorded.`,
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function retryAcceleventsSyncRun(
  _previousState: SyncRunMutationState,
  formData: FormData,
): Promise<SyncRunMutationState> {
  const eventSlug = value(formData, "eventSlug");
  const runId = value(formData, "runId");
  if (!eventSlug || !runId) return { status: "error", message: "A sync run is required." };

  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  const client = getDatabaseClient();
  const run = await client.integrationSyncRun.findFirst({
    where: { id: runId, eventId: event.id },
    select: { configurationId: true, records: { take: 1, select: { resourceType: true } } },
  });
  const resourceType = run?.records[0]?.resourceType;
  if (!run || (resourceType !== "speaker" && resourceType !== "session")) {
    return { status: "error", message: "This Accelevents sync run has no failures eligible for retry yet." };
  }

  const configuration = await client.integrationConfiguration.findUnique({
    where: { id: run.configurationId },
    select: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { remoteEventId: true } },
      remoteRecords: {
        where: { resourceType, status: IntegrationRemoteRecordStatus.ACTIVE },
        select: { remoteId: true },
      },
    },
  });
  const remoteEventId = configuration?.versions[0]?.remoteEventId;
  if (!remoteEventId) return { status: "error", message: "This event is not connected to Accelevents." };

  const connection = { remoteEventId, apiKey: "runtime-preview-key" };
  const adapter = new DeterministicAcceleventsAdapter({
    remoteEventId,
    apiKey: "runtime-preview-key",
    speakers:
      resourceType === "speaker"
        ? configuration.remoteRecords.map((record, index) => ({
            remoteId: record.remoteId,
            email: `linked-${index}@preview.invalid`,
            firstName: "Linked",
            lastName: "Speaker",
          }))
        : [],
    sessions:
      resourceType === "session"
        ? configuration.remoteRecords.map((record) => ({
            remoteId: record.remoteId,
            title: "Remote session awaiting comparison",
            description: "",
            speakerRemoteIds: [],
          }))
        : [],
  });

  try {
    const service =
      resourceType === "speaker"
        ? new AcceleventsSpeakerPushService(client)
        : new AcceleventsSessionPushService(client);
    await service.push({
      eventId: event.id,
      idempotencyKey: randomUUID(),
      confirmed: true,
      adapter,
      connection,
      retryOfRunId: runId,
    });
    revalidatePath(`/dashboard/events/${encodeURIComponent(event.slug)}/integrations`);
    return { status: "success", message: "Retry submitted for eligible records." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
