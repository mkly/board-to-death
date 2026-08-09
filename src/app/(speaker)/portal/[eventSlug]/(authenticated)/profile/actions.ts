"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { z } from "zod";

import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";

import { getPortalViewer, portalHref } from "../../_lib/portal-session";

const optionalText = (label: string, maximum: number) =>
  z.string().trim().max(maximum, `${label} must be ${maximum} characters or fewer.`);

const profileSchema = z.object({
  expectedVersionNumber: z.coerce.number().int().positive(),
  phone: optionalText("Phone", 50),
  pronouns: optionalText("Pronouns", 80),
  organization: optionalText("Organization", 160),
  jobTitle: optionalText("Title", 160),
  biography: optionalText("Biography", 5_000),
  websiteUrl: optionalText("Website or social profile URL", 2_048).refine((value) => {
    if (value === "") return true;
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Enter a valid HTTP or HTTPS URL."),
  accessibilityNeeds: optionalText("Accessibility needs", 2_000),
});

export type SpeakerProfileField = keyof z.infer<typeof profileSchema>;

export interface SpeakerProfileActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly fieldErrors?: Partial<Record<SpeakerProfileField, readonly string[]>>;
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

export async function updateSpeakerProfile(
  eventSlug: string,
  _previousState: SpeakerProfileActionState,
  formData: FormData,
): Promise<SpeakerProfileActionState> {
  const viewer = await getPortalViewer(eventSlug);
  const parsed = profileSchema.safeParse({
    expectedVersionNumber: formData.get("expectedVersionNumber"),
    phone: formData.get("phone"),
    pronouns: formData.get("pronouns"),
    organization: formData.get("organization"),
    jobTitle: formData.get("jobTitle"),
    biography: formData.get("biography"),
    websiteUrl: formData.get("websiteUrl"),
    accessibilityNeeds: formData.get("accessibilityNeeds"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const updated = await new SpeakerRepository(getDatabaseClient()).updateProfile(
      viewer.eventId,
      viewer.speakerId,
      {
        phone: nullable(parsed.data.phone),
        pronouns: nullable(parsed.data.pronouns),
        organization: nullable(parsed.data.organization),
        jobTitle: nullable(parsed.data.jobTitle),
        biography: nullable(parsed.data.biography),
        websiteUrl: nullable(parsed.data.websiteUrl),
        accessibilityNeeds: nullable(parsed.data.accessibilityNeeds),
      },
      parsed.data.expectedVersionNumber,
    );
    revalidatePath(portalHref(eventSlug));
    revalidatePath(portalHref(eventSlug, "/profile"));
    redirect(`${portalHref(eventSlug, "/profile")}?updated=${updated.profile.versionNumber}`);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return {
        status: "error",
        message:
          error.code === "conflict"
            ? "Your profile changed in another tab. Reload the page, review the latest details, and try again."
            : error.message,
      };
    }
    throw error;
  }
}
