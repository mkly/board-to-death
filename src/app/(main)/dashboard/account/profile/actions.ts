"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { z } from "zod";

import { getRequestAuthorization } from "@/server/authorization/request-context";
import { getDatabaseClient } from "@/server/database/client";
import { getConfiguredFileStorage } from "@/server/infrastructure/configured-file-storage";
import { validateFileUpload } from "@/server/speakers/file-policy";

import { avatarFileIdFromImage, avatarObjectKey, avatarUrl } from "./_lib/avatar";
import { randomUUID } from "node:crypto";

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name.").max(80, "First name must be 80 characters or fewer."),
  lastName: z.string().trim().max(80, "Last name must be 80 characters or fewer."),
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
});

export type ProfileField = keyof z.infer<typeof profileSchema>;

export interface ProfileActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly fieldErrors?: Partial<Record<ProfileField, readonly string[]>>;
}

async function requireUserId(): Promise<string> {
  const authorization = await getRequestAuthorization();
  if (!authorization) redirect("/auth/v1/login");
  return authorization.session.user.id;
}

export async function updateProfile(
  _previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const userId = await requireUserId();

  const parsed = profileSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const database = getDatabaseClient();
  const email = parsed.data.email.toLowerCase();
  const taken = await database.user.findFirst({ where: { email, NOT: { id: userId } }, select: { id: true } });
  if (taken) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: { email: ["That email is already in use by another account."] },
    };
  }

  const name = [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(" ");
  await database.user.update({ where: { id: userId }, data: { name, email } });

  revalidatePath("/dashboard", "layout");
  return { status: "success", message: "Profile updated." };
}

export interface AvatarActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

export async function uploadAvatar(_previousState: AvatarActionState, formData: FormData): Promise<AvatarActionState> {
  const userId = await requireUserId();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose an image to upload." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateFileUpload("headshot", file.type, bytes);
  if (!validation.ok) {
    return { status: "error", message: validation.message };
  }

  const database = getDatabaseClient();
  const current = await database.user.findUniqueOrThrow({ where: { id: userId }, select: { image: true } });
  const previousFileId = avatarFileIdFromImage(current.image);

  const storage = getConfiguredFileStorage();
  const fileId = randomUUID();
  const stored = await storage.put({ key: avatarObjectKey(userId, fileId), bytes, contentType: file.type });
  if (!stored.ok) {
    return { status: "error", message: "The image could not be saved. Try again." };
  }

  await database.user.update({ where: { id: userId }, data: { image: avatarUrl(fileId) } });
  if (previousFileId) {
    await storage.delete(avatarObjectKey(userId, previousFileId));
  }

  revalidatePath("/dashboard", "layout");
  return { status: "success", message: "Avatar updated." };
}

export async function removeAvatar(_previousState: AvatarActionState, _formData: FormData): Promise<AvatarActionState> {
  const userId = await requireUserId();

  const database = getDatabaseClient();
  const current = await database.user.findUniqueOrThrow({ where: { id: userId }, select: { image: true } });
  const fileId = avatarFileIdFromImage(current.image);
  if (!fileId && !current.image) {
    return { status: "error", message: "There is no avatar to remove." };
  }

  await database.user.update({ where: { id: userId }, data: { image: null } });
  if (fileId) {
    await getConfiguredFileStorage().delete(avatarObjectKey(userId, fileId));
  }

  revalidatePath("/dashboard", "layout");
  return { status: "success", message: "Avatar removed." };
}
