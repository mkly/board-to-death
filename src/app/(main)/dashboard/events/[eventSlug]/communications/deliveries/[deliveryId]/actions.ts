"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { BulkCommunicationRepository } from "@/server/communications";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

export interface CancelBulkDeliveryState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function value(formData: FormData, name: string): string {
  const field = formData.get(name);
  return typeof field === "string" ? field.trim() : "";
}

export async function cancelBulkDelivery(
  _previousState: CancelBulkDeliveryState,
  formData: FormData,
): Promise<CancelBulkDeliveryState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isAuthorizedAdminSession(session)) {
    return { status: "error", message: "Your admin session expired. Sign in and try again." };
  }

  const eventSlug = value(formData, "eventSlug");
  const deliveryId = value(formData, "deliveryId");
  const client = getDatabaseClient();
  const event = await client.event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
  if (!event) return { status: "error", message: "This event is not available." };

  try {
    await new BulkCommunicationRepository(client).cancel(event.id, deliveryId);
    revalidatePath(`/dashboard/events/${event.slug}/communications/deliveries/${deliveryId}`);
    return { status: "success", message: "Remaining recipient attempts were cancelled." };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
