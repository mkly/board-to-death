"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { Temporal } from "temporal-polyfill";

import { isAuthorizedAdminSession } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { addSpeakerTaskFileComment } from "@/server/speakers/file-comments";
import { SpeakerOnboardingRepository } from "@/server/speakers/onboarding";
import { SpeakerTaskReminderRepository } from "@/server/speakers/reminders";

export interface OnboardingActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

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
  if (!session || !(await isAuthorizedAdminSession(session, { slug: eventSlug }))) return null;

  const event = await getDatabaseClient().event.findUnique({
    where: { slug: eventSlug },
    select: { id: true, slug: true, timezone: true },
  });
  if (!event) return null;
  return { ...event, userId: session.user.id };
}

function revalidateOnboarding(eventSlug: string): void {
  revalidatePath(`/dashboard/events/${eventSlug}/onboarding`);
  revalidatePath(`/portal/${eventSlug}`);
}

async function runMutation(
  eventSlug: string,
  operation: (event: NonNullable<Awaited<ReturnType<typeof requireAdminEvent>>>) => Promise<string>,
): Promise<OnboardingActionState> {
  const event = await requireAdminEvent(eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  try {
    const message = await operation(event);
    revalidateOnboarding(event.slug);
    return { status: "success", message };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function commentOnSpeakerTaskFile(
  eventSlug: string,
  submissionId: string,
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    await addSpeakerTaskFileComment(
      getDatabaseClient(),
      event.id,
      submissionId,
      { role: "ORGANIZER", userId: event.userId },
      fieldValue(formData, "comment"),
    );
    return "Comment added.";
  });
}

export async function assignSpeakerTasks(
  eventSlug: string,
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    const speakerIds = formData.getAll("speakerIds").filter((value): value is string => typeof value === "string");
    await new SpeakerOnboardingRepository(getDatabaseClient()).assignCohort({
      eventId: event.id,
      definitionId: fieldValue(formData, "definitionId"),
      speakerIds,
      dueAt: eventDueDate(fieldValue(formData, "dueAt"), event.timezone),
    });
    return "Selected speakers assigned.";
  });
}

export async function updateSpeakerTaskDueDate(
  eventSlug: string,
  assignmentId: string,
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    const dueAt = eventDueDate(fieldValue(formData, "dueAt"), event.timezone) ?? null;
    await new SpeakerOnboardingRepository(getDatabaseClient()).updateDueDate(event.id, assignmentId, dueAt);
    return "Due date saved.";
  });
}

export async function withdrawSpeakerTask(eventSlug: string, assignmentId: string): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    await new SpeakerOnboardingRepository(getDatabaseClient()).withdraw(
      event.id,
      assignmentId,
      "Withdrawn by an administrator.",
    );
    return "Task withdrawn.";
  });
}

export async function approveSpeakerTask(eventSlug: string, assignmentId: string): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    await new SpeakerOnboardingRepository(getDatabaseClient()).review(event.id, assignmentId, "APPROVED");
    return "Task approved.";
  });
}

export async function requestSpeakerTaskRevision(
  eventSlug: string,
  assignmentId: string,
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    const feedback = fieldValue(formData, "feedback").trim();
    if (feedback === "") throw new RepositoryError("invalid-input", "Revision feedback is required.");
    await new SpeakerOnboardingRepository(getDatabaseClient()).review(
      event.id,
      assignmentId,
      "REVISION_REQUESTED",
      feedback,
    );
    return "Revision requested.";
  });
}

export async function saveSpeakerTaskReminderRule(
  eventSlug: string,
  ruleId: string | null,
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    const repository = new SpeakerTaskReminderRepository(getDatabaseClient());
    const input = {
      eventId: event.id,
      templateId: fieldValue(formData, "templateId"),
      name: fieldValue(formData, "name"),
      daysBeforeDue: integerField(formData, "daysBeforeDue"),
      sendAtMinute: timeField(formData, "sendAt"),
    };
    if (ruleId) {
      await repository.update({ ...input, ruleId });
      return "Reminder rule saved.";
    }
    await repository.create(input);
    return "Reminder rule added.";
  });
}

export async function activateSpeakerTaskReminderRule(
  eventSlug: string,
  ruleId: string,
): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    await new SpeakerTaskReminderRepository(getDatabaseClient()).activate(event.id, ruleId);
    return "Reminder rule activated.";
  });
}

export async function cancelSpeakerTaskReminderRule(eventSlug: string, ruleId: string): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    await new SpeakerTaskReminderRepository(getDatabaseClient()).cancel(event.id, ruleId);
    return "Reminder rule cancelled.";
  });
}

export async function setSpeakerTaskReminderOptOut(
  eventSlug: string,
  assignmentId: string,
  optedOut: boolean,
): Promise<OnboardingActionState> {
  return runMutation(eventSlug, async (event) => {
    await new SpeakerTaskReminderRepository(getDatabaseClient()).setAssignmentOptOut(event.id, assignmentId, optedOut);
    return optedOut ? "Reminders paused for this assignment." : "Reminders resumed for this assignment.";
  });
}
