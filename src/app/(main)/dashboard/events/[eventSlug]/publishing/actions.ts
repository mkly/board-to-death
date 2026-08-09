"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { SpeakerResourceRepository } from "@/server/program/repositories";

export interface ResourcePageMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly pageId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const resourceSchema = z.object({
  eventSlug: z.string().trim().min(1),
  pageId: z.union([z.literal(""), z.uuid("The selected resource is invalid.")]),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a URL slug.")
    .max(100, "Keep the slug under 100 characters.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens."),
  title: z.string().trim().min(1, "Enter a title.").max(160, "Keep the title under 160 characters."),
  summary: z.string().trim().max(500, "Keep the summary under 500 characters."),
  bodyMarkdown: z.string().trim().min(1, "Enter resource content.").max(100_000, "Keep content under 100,000 characters."),
});

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function validationErrors(error: z.ZodError): Readonly<Record<string, readonly string[]>> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return null;
  return getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
}

function repositoryMessage(error: RepositoryError): string {
  if (error.code === "not-found") return "This resource is not available for this event.";
  return error.message;
}

function revalidateResourcePaths(eventSlug: string): void {
  revalidatePath(`/dashboard/events/${eventSlug}/publishing`);
  revalidatePath(`/events/${eventSlug}/resources`);
}

export async function saveResourcePage(
  _previousState: ResourcePageMutationState,
  formData: FormData,
): Promise<ResourcePageMutationState> {
  const parsed = resourceSchema.safeParse({
    eventSlug: stringValue(formData, "eventSlug"),
    pageId: stringValue(formData, "pageId"),
    slug: stringValue(formData, "slug"),
    title: stringValue(formData, "title"),
    summary: stringValue(formData, "summary"),
    bodyMarkdown: stringValue(formData, "bodyMarkdown"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Review the highlighted resource fields.", errors: validationErrors(parsed.error) };
  }
  const event = await authorizedEvent(parsed.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };

  const repository = new SpeakerResourceRepository(getDatabaseClient());
  const summary = parsed.data.summary === "" ? null : parsed.data.summary;
  try {
    const page =
      parsed.data.pageId === ""
        ? await repository.create({
            eventId: event.id,
            key: parsed.data.slug,
            slug: parsed.data.slug,
            title: parsed.data.title,
            summary,
            bodyMarkdown: parsed.data.bodyMarkdown,
          })
        : await repository.revise(event.id, parsed.data.pageId, {
            slug: parsed.data.slug,
            title: parsed.data.title,
            summary,
            bodyMarkdown: parsed.data.bodyMarkdown,
          });
    revalidateResourcePaths(event.slug);
    return {
      status: "success",
      message: parsed.data.pageId === "" ? "Resource draft created." : "Resource revision saved.",
      pageId: page.id,
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}

export async function publishResourcePage(
  eventSlug: string,
  pageId: string,
  versionId: string,
): Promise<ResourcePageMutationState> {
  if (!z.uuid().safeParse(pageId).success || !z.uuid().safeParse(versionId).success) {
    return { status: "error", message: "The selected resource is invalid." };
  }
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  try {
    await new SpeakerResourceRepository(getDatabaseClient()).publish(event.id, pageId, versionId);
    revalidateResourcePaths(event.slug);
    return { status: "success", message: "Resource published.", pageId };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}

export async function unpublishResourcePage(eventSlug: string, pageId: string): Promise<ResourcePageMutationState> {
  if (!z.uuid().safeParse(pageId).success) return { status: "error", message: "The selected resource is invalid." };
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  try {
    await new SpeakerResourceRepository(getDatabaseClient()).unpublish(event.id, pageId);
    revalidateResourcePaths(event.slug);
    return { status: "success", message: "Resource unpublished.", pageId };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}

export async function archiveResourcePage(eventSlug: string, pageId: string): Promise<ResourcePageMutationState> {
  if (!z.uuid().safeParse(pageId).success) return { status: "error", message: "The selected resource is invalid." };
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  try {
    await new SpeakerResourceRepository(getDatabaseClient()).archive(event.id, pageId);
    revalidateResourcePaths(event.slug);
    return { status: "success", message: "Resource archived.", pageId };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}

export async function moveResourcePage(
  eventSlug: string,
  pageId: string,
  direction: "up" | "down",
): Promise<ResourcePageMutationState> {
  if (!z.uuid().safeParse(pageId).success) return { status: "error", message: "The selected resource is invalid." };
  const event = await authorizedEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  try {
    const repository = new SpeakerResourceRepository(getDatabaseClient());
    const pages = await repository.list(event.id);
    const index = pages.findIndex((page) => page.id === pageId);
    const offset = direction === "up" ? -1 : 1;
    const destination = index + offset;
    if (index < 0 || destination < 0 || destination >= pages.length) {
      return { status: "error", message: "That resource cannot move any farther." };
    }
    const ids = pages.map((page) => page.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    await repository.reorder(event.id, ids);
    revalidateResourcePaths(event.slug);
    return { status: "success", message: "Resource order updated.", pageId };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}
