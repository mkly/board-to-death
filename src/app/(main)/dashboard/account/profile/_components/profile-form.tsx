"use client";

import { useActionState, useEffect, useState } from "react";

import { Trash2Icon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getInitials } from "@/lib/utils";

import { type AvatarActionState, type ProfileActionState, removeAvatar, updateProfile, uploadAvatar } from "../actions";

const INITIAL_PROFILE_STATE: ProfileActionState = { status: "idle" };
const INITIAL_AVATAR_STATE: AvatarActionState = { status: "idle" };

function AvatarCard({ name, avatarUrl }: { readonly name: string; readonly avatarUrl: string | null }) {
  const [uploadState, uploadFormAction, uploadPending] = useActionState(uploadAvatar, INITIAL_AVATAR_STATE);
  const [removeState, removeFormAction, removePending] = useActionState(removeAvatar, INITIAL_AVATAR_STATE);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  useEffect(() => {
    if (uploadState.status === "success" && uploadState.message) toast.success(uploadState.message);
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
        {uploadState.status === "error" && (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>{uploadState.message}</AlertDescription>
          </Alert>
        )}
        {removeState.status === "error" && (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Removal failed</AlertTitle>
            <AlertDescription>{removeState.message}</AlertDescription>
          </Alert>
        )}
        <form action={uploadFormAction} className="flex flex-wrap items-center gap-4">
          <Avatar className="size-16 rounded-lg">
            <AvatarImage src={avatarUrl ?? undefined} alt={name} />
            <AvatarFallback className="rounded-lg text-lg">{getInitials(name)}</AvatarFallback>
          </Avatar>
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="avatar-file" className="sr-only">
              Avatar image
            </FieldLabel>
            <Input
              id="avatar-file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name ?? null)}
            />
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

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message);
  }, [state]);

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
