"use server";

import { z } from "zod";

import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";
import { SpeakerSourcingRepository } from "@/server/speaker-sourcing/repositories";

export interface SpeakerInterestActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const interestSchema = z.object({
  publicId: z.uuid(),
  givenName: z.string().trim().min(1, "Enter your first name.").max(100),
  familyName: z.string().trim().min(1, "Enter your last name.").max(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address." })),
  organization: z.string().trim().max(200),
  jobTitle: z.string().trim().max(200),
  phone: z.string().trim().max(100),
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

export async function submitSpeakerInterest(
  publicId: string,
  _previousState: SpeakerInterestActionState,
  formData: FormData,
): Promise<SpeakerInterestActionState> {
  const parsed = interestSchema.safeParse({
    publicId,
    givenName: stringValue(formData, "givenName"),
    familyName: stringValue(formData, "familyName"),
    email: stringValue(formData, "email"),
    organization: stringValue(formData, "organization"),
    jobTitle: stringValue(formData, "jobTitle"),
    phone: stringValue(formData, "phone"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Review the highlighted fields.", errors: validationErrors(parsed.error) };
  }

  try {
    await new SpeakerSourcingRepository(getDatabaseClient()).submitInterest(parsed.data);
    return {
      status: "success",
      message: "Thanks for your interest. The event team can now follow up with you.",
    };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: error.message };
    throw error;
  }
}
