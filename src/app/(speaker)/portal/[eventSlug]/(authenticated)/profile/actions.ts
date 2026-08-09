"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { z } from "zod";

import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { validateFileUpload } from "@/server/speakers/file-policy";
import type { UpdateSpeakerProfileInput } from "@/server/speakers/repositories";
import { SpeakerRepository } from "@/server/speakers/repositories";
import { createSpeakerFileService } from "@/server/speakers/speaker-file-storage";

import { portalHref, requirePortalContent } from "../../_lib/portal-session";

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
  const { viewer, portal } = await requirePortalContent(eventSlug, "profile");
  const repository = new SpeakerRepository(getDatabaseClient());
  const current = await repository.get(viewer.eventId, viewer.speakerId);
  if (!current) redirect(portalHref(eventSlug, "/sign-in"));
  const submittedOrCurrent = (field: keyof typeof portal.profileFieldVisibility) =>
    portal.profileFieldVisibility[field] === "editable" ? formData.get(field) : (current.profile[field] ?? "");
  const parsed = profileSchema.safeParse({
    expectedVersionNumber: formData.get("expectedVersionNumber"),
    phone: submittedOrCurrent("phone"),
    pronouns: submittedOrCurrent("pronouns"),
    organization: submittedOrCurrent("organization"),
    jobTitle: submittedOrCurrent("jobTitle"),
    biography: submittedOrCurrent("biography"),
    websiteUrl: submittedOrCurrent("websiteUrl"),
    accessibilityNeeds: submittedOrCurrent("accessibilityNeeds"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const updated = await repository.updateProfile(
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

export type SpeakerProfileFilePurpose = "headshot" | "agreement";

export interface SpeakerFileActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

function profileFileKey(
  profile: { readonly photoObjectKey: string | null; readonly agreementObjectKey: string | null },
  purpose: SpeakerProfileFilePurpose,
): string | null {
  return purpose === "headshot" ? profile.photoObjectKey : profile.agreementObjectKey;
}

function profileFileUpdate(purpose: SpeakerProfileFilePurpose, key: string | null): UpdateSpeakerProfileInput {
  return purpose === "headshot" ? { photoObjectKey: key } : { agreementObjectKey: key };
}

export async function uploadSpeakerProfileFile(
  eventSlug: string,
  purpose: SpeakerProfileFilePurpose,
  _previousState: SpeakerFileActionState,
  formData: FormData,
): Promise<SpeakerFileActionState> {
  const { viewer } = await requirePortalContent(eventSlug, "files");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file to upload." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateFileUpload(purpose, file.type, bytes);
  if (!validation.ok) {
    return { status: "error", message: validation.message };
  }

  const repository = new SpeakerRepository(getDatabaseClient());
  const speaker = await repository.get(viewer.eventId, viewer.speakerId);
  if (!speaker) redirect(portalHref(eventSlug, "/sign-in"));
  const currentKey = profileFileKey(speaker.profile, purpose);

  const fileService = createSpeakerFileService();
  const principal = { role: "speaker" as const, ...viewer };
  const write = {
    eventId: viewer.eventId,
    speakerId: viewer.speakerId,
    fileName: file.name,
    contentType: file.type,
    bytes,
  };
  const stored = currentKey ? await fileService.replace(currentKey, write, principal) : await fileService.write(write);
  if (!stored.ok) {
    return { status: "error", message: "The file could not be saved. Try again." };
  }

  try {
    await repository.updateProfile(viewer.eventId, viewer.speakerId, profileFileUpdate(purpose, stored.value.key));
  } catch (error) {
    if (error instanceof RepositoryError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }

  revalidatePath(portalHref(eventSlug, "/profile"));
  return { status: "success", message: purpose === "headshot" ? "Headshot updated." : "Agreement updated." };
}

export async function removeSpeakerProfileFile(
  eventSlug: string,
  purpose: SpeakerProfileFilePurpose,
  _previousState: SpeakerFileActionState,
  _formData: FormData,
): Promise<SpeakerFileActionState> {
  const { viewer } = await requirePortalContent(eventSlug, "files");
  const repository = new SpeakerRepository(getDatabaseClient());
  const speaker = await repository.get(viewer.eventId, viewer.speakerId);
  if (!speaker) redirect(portalHref(eventSlug, "/sign-in"));
  const currentKey = profileFileKey(speaker.profile, purpose);
  if (!currentKey) {
    return { status: "error", message: "There is nothing to remove." };
  }

  const removed = await createSpeakerFileService().remove(currentKey, { role: "speaker", ...viewer });
  if (!removed.ok) {
    return { status: "error", message: "The file could not be removed. Try again." };
  }

  try {
    await repository.updateProfile(viewer.eventId, viewer.speakerId, profileFileUpdate(purpose, null));
  } catch (error) {
    if (error instanceof RepositoryError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }

  revalidatePath(portalHref(eventSlug, "/profile"));
  return { status: "success", message: purpose === "headshot" ? "Headshot removed." : "Agreement removed." };
}
