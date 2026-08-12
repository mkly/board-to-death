"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";
import { getInitials } from "@/lib/utils";

import { type AvatarActionState, type ProfileActionState, removeAvatar, updateProfile, uploadAvatar } from "../actions";

const INITIAL_PROFILE_STATE: ProfileActionState = { status: "idle" };
const INITIAL_AVATAR_STATE: AvatarActionState = { status: "idle" };

function AvatarCard({ name, avatarUrl }: { readonly name: string; readonly avatarUrl: string | null }) {
  const [uploadState, uploadFormAction, uploadPending] = useActionState(uploadAvatar, INITIAL_AVATAR_STATE);
  const [removeState, removeFormAction, removePending] = useActionState(removeAvatar, INITIAL_AVATAR_STATE);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const uploadFormRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useActionToast(uploadState);
  useActionToast(removeState);

  useEffect(() => {
    if (uploadState.status !== "success") return;
    // The upload succeeded, so the stale selection must not linger next to the new avatar.
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSelectedFileName(null);
  }, [uploadState]);
  useEffect(() => {
    if (removeState.status === "success" && removeState.message) toast.success(removeState.message);
  }, [removeState]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avatar</CardTitle>
        <CardDescription>Shown next to your name across the dashboard. JPEG, PNG, or WebP up to 5 MB.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form ref={uploadFormRef} action={uploadFormAction} className="flex flex-wrap items-center gap-4">
          <Avatar className="size-16">
            <AvatarImage src={avatarUrl ?? undefined} alt={name} />
            <AvatarFallback className="bg-primary/15 font-medium text-primary text-xl">
              {getInitials(name).slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="avatar-file" className="sr-only">
              Avatar image
            </FieldLabel>
            <Input
              ref={fileInputRef}
              id="avatar-file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploadPending}
              onChange={(event) => {
                setSelectedFileName(event.target.files?.[0]?.name ?? null);
                // Uploading is the only thing this input can do, and "Save changes" below does not
                // pick it up, so choosing a file has to submit rather than wait for a second click.
                if (event.target.files?.length) uploadFormRef.current?.requestSubmit();
              }}
            />
            <FieldDescription>Choosing a file uploads it right away.</FieldDescription>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="outline" disabled={uploadPending || !selectedFileName}>
              {uploadPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UploadIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {avatarUrl ? "Replace" : "Upload"}
            </Button>
            {avatarUrl && (
              <Button type="submit" variant="ghost" formAction={removeFormAction} disabled={removePending}>
                {removePending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Trash2Icon data-icon="inline-start" aria-hidden="true" />
                )}
                Remove
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DetailsCard({
  firstName,
  lastName,
  email,
}: {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
}) {
  const [state, formAction, pending] = useActionState(updateProfile, INITIAL_PROFILE_STATE);
  useActionToast(state);

  const fieldError = (field: "firstName" | "lastName" | "email") => state.fieldErrors?.[field]?.[0];

  return (
    <Card>
      <form action={formAction} noValidate>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          <CardDescription>
            Your name appears on invitations, reviews, and activity. Changing your email updates where magic links are
            sent.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:gap-4">
              <Field data-invalid={Boolean(fieldError("firstName"))}>
                <FieldLabel htmlFor="profile-first-name">First name</FieldLabel>
                <Input
                  id="profile-first-name"
                  name="firstName"
                  defaultValue={firstName}
                  autoComplete="given-name"
                  aria-invalid={Boolean(fieldError("firstName"))}
                />
                {fieldError("firstName") && <FieldError>{fieldError("firstName")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("lastName"))}>
                <FieldLabel htmlFor="profile-last-name">Last name</FieldLabel>
                <Input
                  id="profile-last-name"
                  name="lastName"
                  defaultValue={lastName}
                  autoComplete="family-name"
                  aria-invalid={Boolean(fieldError("lastName"))}
                />
                {fieldError("lastName") && <FieldError>{fieldError("lastName")}</FieldError>}
              </Field>
            </div>
            <Field data-invalid={Boolean(fieldError("email"))}>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input
                id="profile-email"
                name="email"
                type="email"
                defaultValue={email}
                autoComplete="email"
                aria-invalid={Boolean(fieldError("email"))}
              />
              <FieldDescription>You sign in with a magic link sent to this address.</FieldDescription>
              {fieldError("email") && <FieldError>{fieldError("email")}</FieldError>}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="pt-6">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function ProfileForm({
  firstName,
  lastName,
  email,
  avatarUrl,
}: {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <AvatarCard name={[firstName, lastName].filter(Boolean).join(" ")} avatarUrl={avatarUrl} />
      <DetailsCard firstName={firstName} lastName={lastName} email={email} />
    </div>
  );
}
