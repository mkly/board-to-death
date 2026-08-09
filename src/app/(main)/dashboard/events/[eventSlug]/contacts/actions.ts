"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { linkDirectoryPersonToEvent } from "@/server/contacts/repositories";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";

function contactsPath(eventSlug: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/contacts`;
}

export async function linkDirectoryPersonAction(eventSlug: string, personId: string): Promise<never> {
  const shell = await getDashboardShellData();
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event || shell.activeEvent?.id !== event.id) notFound();

  try {
    await linkDirectoryPersonToEvent(getDatabaseClient(), event.id, personId);
  } catch (error) {
    const message = error instanceof RepositoryError ? error.message : "The directory contact could not be linked.";
    redirect(`${contactsPath(event.slug)}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(contactsPath(event.slug));
  redirect(`${contactsPath(event.slug)}?notice=${encodeURIComponent("Contact added from the directory.")}`);
}
