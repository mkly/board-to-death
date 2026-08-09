"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { Temporal } from "temporal-polyfill";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { AuthorizationError } from "@/server/authorization/policy";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { SpeakerOnboardingRepository } from "@/server/speakers/onboarding";
import { SpeakerTaskReminderRepository } from "@/server/speakers/reminders";

function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function eventDueDate(value: string, timezone: string): Date | undefined {
  if (value === "") return undefined;
  try {
    return new Date(
      Temporal.PlainDateTime.from(`${value}T23:59:59`)
        .toZonedDateTime(timezone, { disambiguation: "reject" })
        .toInstant().epochMilliseconds,
    );
  } catch {
    throw new RepositoryError("invalid-input", "The due date is invalid for the event time zone.");
  }
}

function integerField(formData: FormData, name: string): number {
  const value = Number(fieldValue(formData, name));
  if (!Number.isInteger(value)) throw new RepositoryError("invalid-input", `${name} must be an integer.`);
  return value;
}

function timeField(formData: FormData, name: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(fieldValue(formData, name));
  if (!match) throw new RepositoryError("invalid-input", "The reminder time is invalid.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new RepositoryError("invalid-input", "The reminder time is invalid.");
  return hour * 60 + minute;
}

async function requireAdminEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isAuthorizedAdminSession(session)) throw new AuthorizationError("unauthenticated");

  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true, timezone: true },
  });
  if (!event) throw new AuthorizationError("not-found");
  return event;
}

function revalidateOnboarding(eventSlug: string): void {
  revalidatePath(`/dashboard/events/${eventSlug}/onboarding`);
}

export async function assignSpeakerTasks(eventSlug: string, formData: FormData): Promise<void> {
  const event = await requireAdminEvent(eventSlug);
  const speakerIds = formData.getAll("speakerIds").filter((value): value is string => typeof value === "string");
  await new SpeakerOnboardingRepository(getDatabaseClient()).assignCohort({
    eventId: event.id,
    definitionId: fieldValue(formData, "definitionId"),
    speakerIds,
    dueAt: eventDueDate(fieldValue(formData, "dueAt"), event.timezone),
  });
  revalidateOnboarding(event.slug);
}

export async function updateSpeakerTaskDueDate(
  eventSlug: string,
  assignmentId: string,
  formData: FormData,
): Promise<void> {
  const event = await requireAdminEvent(eventSlug);
  const dueAt = eventDueDate(fieldValue(formData, "dueAt"), event.timezone) ?? null;
  await new SpeakerOnboardingRepository(getDatabaseClient()).updateDueDate(event.id, assignmentId, dueAt);
  revalidateOnboarding(event.slug);
}

export async function withdrawSpeakerTask(eventSlug: string, assignmentId: string): Promise<void> {
  const event = await requireAdminEvent(eventSlug);
  await new SpeakerOnboardingRepository(getDatabaseClient()).withdraw(
    event.id,
    assignmentId,
    "Withdrawn by an administrator.",
  );
  revalidateOnboarding(event.slug);
}

export async function saveSpeakerTaskReminderRule(
  eventSlug: string,
  ruleId: string | null,
  formData: FormData,
): Promise<void> {
  const event = await requireAdminEvent(eventSlug);
  const repository = new SpeakerTaskReminderRepository(getDatabaseClient());
  const input = {
    eventId: event.id,
    templateId: fieldValue(formData, "templateId"),
    name: fieldValue(formData, "name"),
    daysBeforeDue: integerField(formData, "daysBeforeDue"),
    sendAtMinute: timeField(formData, "sendAt"),
  };
  if (ruleId) await repository.update({ ...input, ruleId });
  else await repository.create(input);
  revalidateOnboarding(event.slug);
}

export async function activateSpeakerTaskReminderRule(eventSlug: string, ruleId: string): Promise<void> {
  const event = await requireAdminEvent(eventSlug);
  await new SpeakerTaskReminderRepository(getDatabaseClient()).activate(event.id, ruleId);
  revalidateOnboarding(event.slug);
}

export async function cancelSpeakerTaskReminderRule(eventSlug: string, ruleId: string): Promise<void> {
  const event = await requireAdminEvent(eventSlug);
  await new SpeakerTaskReminderRepository(getDatabaseClient()).cancel(event.id, ruleId);
  revalidateOnboarding(event.slug);
}

export async function setSpeakerTaskReminderOptOut(
  eventSlug: string,
  assignmentId: string,
  optedOut: boolean,
): Promise<void> {
  const event = await requireAdminEvent(eventSlug);
  await new SpeakerTaskReminderRepository(getDatabaseClient()).setAssignmentOptOut(event.id, assignmentId, optedOut);
  revalidateOnboarding(event.slug);
}
