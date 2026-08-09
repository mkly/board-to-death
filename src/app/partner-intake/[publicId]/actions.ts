"use server";

import { z } from "zod";

import { submitContactGroupIntakeForm } from "@/server/contacts/group-intake";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

export interface PartnerIntakeActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const formSchema = z.object({
  organizationName: z.string().trim().min(1, "Enter an organization name."),
  contactGivenName: z.string().trim().min(1, "Enter a first name."),
  contactFamilyName: z.string().trim().min(1, "Enter a last name."),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address." })),
  contactPhone: z.string().trim().optional(),
  contactJobTitle: z.string().trim().optional(),
});

function value(formData: FormData, name: string): string {
  const field = formData.get(name);
  return typeof field === "string" ? field : "";
}

export async function submitPartnerIntake(
  publicId: string,
  _previousState: PartnerIntakeActionState,
  formData: FormData,
): Promise<PartnerIntakeActionState> {
  const parsed = formSchema.safeParse({
    organizationName: value(formData, "organizationName"),
    contactGivenName: value(formData, "contactGivenName"),
    contactFamilyName: value(formData, "contactFamilyName"),
    contactEmail: value(formData, "contactEmail"),
    contactPhone: value(formData, "contactPhone"),
    contactJobTitle: value(formData, "contactJobTitle"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the form and fix the highlighted fields.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await submitContactGroupIntakeForm(getDatabaseClient(), publicId, parsed.data);
    return {
      status: "success",
      message: "Your interest form was received. The event team will review it before creating a partner record.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof RepositoryError
          ? error.message
          : "Your interest form could not be submitted. Try again or contact the event team.",
    };
  }
}
