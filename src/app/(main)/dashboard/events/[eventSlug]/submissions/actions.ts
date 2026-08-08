"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { parseSubmissionView } from "@/lib/cfp/submission-table";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";

export interface SubmissionViewActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

async function authorizedContext(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return null;
  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true },
  });
  return event ? { event, userId: session.user.id } : null;
}

export async function saveSubmissionView(
  _previousState: SubmissionViewActionState,
  formData: FormData,
): Promise<SubmissionViewActionState> {
  const eventSlug = String(formData.get("eventSlug") ?? "");
  const context = await authorizedContext(eventSlug);
  if (!context) return { status: "error", message: "This event is not available." };

  let view: ReturnType<typeof parseSubmissionView>;
  try {
    view = parseSubmissionView(JSON.parse(String(formData.get("view") ?? "null")));
  } catch {
    return { status: "error", message: "The table view could not be saved." };
  }

  await getDatabaseClient().cfpSubmissionView.upsert({
    where: { eventId_userId: { eventId: context.event.id, userId: context.userId } },
    create: { eventId: context.event.id, userId: context.userId, ...view },
    update: view,
  });
  revalidatePath(`/dashboard/events/${context.event.slug}/submissions`);
  return { status: "success", message: "Your table view was saved for this event." };
}

export async function resetSubmissionView(eventSlug: string): Promise<void> {
  const context = await authorizedContext(eventSlug);
  if (!context) return;
  await getDatabaseClient().cfpSubmissionView.deleteMany({
    where: { eventId: context.event.id, userId: context.userId },
  });
  revalidatePath(`/dashboard/events/${context.event.slug}/submissions`);
}
