"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { SpeakerMappingRepository, speakerMappingSources } from "@/server/integrations";

const mappingSchema = z.object({
  email: z.enum(speakerMappingSources),
  firstName: z.enum(speakerMappingSources),
  lastName: z.enum(speakerMappingSources),
});

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return null;
  return getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
}

function destination(eventSlug: string, key: "notice" | "error", message: string): string {
  const query = new URLSearchParams({ [key]: message });
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/integrations?${query}`;
}

export async function saveSpeakerMapping(eventSlug: string, formData: FormData): Promise<never> {
  const parsed = mappingSchema.safeParse({
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
