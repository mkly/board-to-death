"use client";

import { useActionState, useState } from "react";

import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import { SpeakerFileControl } from "../../_components/speaker-file-control";
import {
  removeSpeakerProfileFile,
  type SpeakerProfileActionState,
  type SpeakerProfileField,
  updateSpeakerProfile,
  uploadSpeakerProfileFile,
} from "../actions";

export interface EditableSpeakerProfile {
  readonly versionNumber: number;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly preferredName: string | null;
  readonly phone: string | null;
  readonly pronouns: string | null;
  readonly organization: string | null;
  readonly jobTitle: string | null;
  readonly biography: string | null;
  readonly websiteUrl: string | null;
  readonly accessibilityNeeds: string | null;
  readonly photoObjectKey: string | null;
  readonly agreementObjectKey: string | null;
}

const INITIAL_STATE: SpeakerProfileActionState = { status: "idle" };

function firstError(state: SpeakerProfileActionState, field: SpeakerProfileField): string | undefined {
  return state.fieldErrors?.[field]?.[0];
}

function OptionalFieldDescription({ children }: { readonly children: string }) {
  return <FieldDescription>Optional. {children}</FieldDescription>;
}

export function SpeakerProfileForm({
  eventSlug,
  fieldVisibility,
  filesVisible,
  profile,
}: {
  readonly eventSlug: string;
  readonly fieldVisibility: Readonly<
    Record<
      "phone" | "pronouns" | "organization" | "jobTitle" | "biography" | "websiteUrl" | "accessibilityNeeds",
      "editable" | "view" | "hidden"
    >
  >;
  readonly filesVisible: boolean;
  readonly profile: EditableSpeakerProfile;
}) {
  const action = updateSpeakerProfile.bind(null, eventSlug);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [pronouns, setPronouns] = useState(profile.pronouns ?? "");
  const [organization, setOrganization] = useState(profile.organization ?? "");
  const [jobTitle, setJobTitle] = useState(profile.jobTitle ?? "");
  const [biography, setBiography] = useState(profile.biography ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl ?? "");
  const [accessibilityNeeds, setAccessibilityNeeds] = useState(profile.accessibilityNeeds ?? "");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form action={formAction}>
        <Card>
          <CardHeader>
            <CardTitle>Profile details</CardTitle>
            <CardDescription>Keep the details shared with the event team and attendees current.</CardDescription>
          </CardHeader>
          <CardContent>
            <input type="hidden" name="expectedVersionNumber" value={profile.versionNumber} />
            <FieldGroup>
              {state.status === "error" ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertTitle>Profile not saved</AlertTitle>
                  <AlertDescription>{state.message}</AlertDescription>
                </Alert>
              ) : null}

              <FieldSet>
                <FieldLegend>Contact</FieldLegend>
                <FieldDescription>Your email is managed by the event team and used for portal access.</FieldDescription>
                <FieldGroup>
                  <Field data-disabled>
                    <FieldLabel htmlFor="profile-email">Email address</FieldLabel>
                    <Input id="profile-email" value={profile.email} disabled readOnly />
                    <FieldDescription>Required. Contact the event team to change this address.</FieldDescription>
                  </Field>
                  <Field
                    className={fieldVisibility.phone === "hidden" ? "hidden" : undefined}
                    data-disabled={fieldVisibility.phone === "view" || undefined}
                    data-invalid={Boolean(firstError(state, "phone")) || undefined}
                  >
                    <FieldLabel htmlFor="profile-phone">Phone number</FieldLabel>
                    <Input
                      id="profile-phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      disabled={fieldVisibility.phone !== "editable"}
                      readOnly={fieldVisibility.phone !== "editable"}
                      onChange={(event) => setPhone(event.target.value)}
                      aria-invalid={Boolean(firstError(state, "phone")) || undefined}
                    />
                    <OptionalFieldDescription>Used only for event coordination.</OptionalFieldDescription>
                    <FieldError>{firstError(state, "phone")}</FieldError>
                  </Field>
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>Public speaker profile</FieldLegend>
                <FieldDescription>These details may appear in the published event program.</FieldDescription>
                <FieldGroup>
                  <Field
                    className={fieldVisibility.pronouns === "hidden" ? "hidden" : undefined}
                    data-disabled={fieldVisibility.pronouns === "view" || undefined}
                    data-invalid={Boolean(firstError(state, "pronouns")) || undefined}
                  >
                    <FieldLabel htmlFor="profile-pronouns">Pronouns</FieldLabel>
                    <Input
                      id="profile-pronouns"
                      name="pronouns"
                      autoComplete="off"
                      value={pronouns}
                      disabled={fieldVisibility.pronouns !== "editable"}
                      readOnly={fieldVisibility.pronouns !== "editable"}
                      onChange={(event) => setPronouns(event.target.value)}
                      aria-invalid={Boolean(firstError(state, "pronouns")) || undefined}
                    />
                    <OptionalFieldDescription>For example, she/her, he/him, or they/them.</OptionalFieldDescription>
                    <FieldError>{firstError(state, "pronouns")}</FieldError>
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field
                      className={fieldVisibility.organization === "hidden" ? "hidden" : undefined}
                      data-disabled={fieldVisibility.organization === "view" || undefined}
                      data-invalid={Boolean(firstError(state, "organization")) || undefined}
                    >
                      <FieldLabel htmlFor="profile-organization">Organization</FieldLabel>
                      <Input
                        id="profile-organization"
                        name="organization"
                        autoComplete="organization"
                        value={organization}
                        disabled={fieldVisibility.organization !== "editable"}
                        readOnly={fieldVisibility.organization !== "editable"}
                        onChange={(event) => setOrganization(event.target.value)}
                        aria-invalid={Boolean(firstError(state, "organization")) || undefined}
                      />
                      <OptionalFieldDescription>
                        Your company, community, or independent affiliation.
                      </OptionalFieldDescription>
                      <FieldError>{firstError(state, "organization")}</FieldError>
                    </Field>
                    <Field
                      className={fieldVisibility.jobTitle === "hidden" ? "hidden" : undefined}
                      data-disabled={fieldVisibility.jobTitle === "view" || undefined}
                      data-invalid={Boolean(firstError(state, "jobTitle")) || undefined}
                    >
                      <FieldLabel htmlFor="profile-job-title">Title</FieldLabel>
                      <Input
                        id="profile-job-title"
                        name="jobTitle"
                        autoComplete="organization-title"
                        value={jobTitle}
                        disabled={fieldVisibility.jobTitle !== "editable"}
                        readOnly={fieldVisibility.jobTitle !== "editable"}
                        onChange={(event) => setJobTitle(event.target.value)}
                        aria-invalid={Boolean(firstError(state, "jobTitle")) || undefined}
                      />
                      <OptionalFieldDescription>Your role or professional title.</OptionalFieldDescription>
                      <FieldError>{firstError(state, "jobTitle")}</FieldError>
                    </Field>
                  </div>
                  <Field
                    className={fieldVisibility.biography === "hidden" ? "hidden" : undefined}
                    data-disabled={fieldVisibility.biography === "view" || undefined}
                    data-invalid={Boolean(firstError(state, "biography")) || undefined}
                  >
                    <FieldLabel htmlFor="profile-biography">Biography</FieldLabel>
                    <Textarea
                      id="profile-biography"
                      name="biography"
                      rows={7}
                      value={biography}
                      disabled={fieldVisibility.biography !== "editable"}
                      readOnly={fieldVisibility.biography !== "editable"}
                      onChange={(event) => setBiography(event.target.value)}
                      aria-invalid={Boolean(firstError(state, "biography")) || undefined}
                    />
                    <OptionalFieldDescription>Up to 5,000 characters.</OptionalFieldDescription>
                    <FieldError>{firstError(state, "biography")}</FieldError>
                  </Field>
                  <Field
                    className={fieldVisibility.websiteUrl === "hidden" ? "hidden" : undefined}
                    data-disabled={fieldVisibility.websiteUrl === "view" || undefined}
                    data-invalid={Boolean(firstError(state, "websiteUrl")) || undefined}
                  >
                    <FieldLabel htmlFor="profile-website">Website or social profile</FieldLabel>
                    <Input
                      id="profile-website"
                      name="websiteUrl"
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      placeholder="https://example.com"
                      value={websiteUrl}
                      disabled={fieldVisibility.websiteUrl !== "editable"}
                      readOnly={fieldVisibility.websiteUrl !== "editable"}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                      aria-invalid={Boolean(firstError(state, "websiteUrl")) || undefined}
                    />
                    <OptionalFieldDescription>An HTTP or HTTPS link attendees can visit.</OptionalFieldDescription>
                    <FieldError>{firstError(state, "websiteUrl")}</FieldError>
                  </Field>
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>Accessibility</FieldLegend>
                <FieldDescription>
                  Shared privately with the event team to help plan your participation.
                </FieldDescription>
                <FieldGroup>
                  <Field
                    className={fieldVisibility.accessibilityNeeds === "hidden" ? "hidden" : undefined}
                    data-disabled={fieldVisibility.accessibilityNeeds === "view" || undefined}
                    data-invalid={Boolean(firstError(state, "accessibilityNeeds")) || undefined}
                  >
                    <FieldLabel htmlFor="profile-accessibility-needs">Accessibility needs</FieldLabel>
                    <Textarea
                      id="profile-accessibility-needs"
                      name="accessibilityNeeds"
                      rows={4}
                      value={accessibilityNeeds}
                      disabled={fieldVisibility.accessibilityNeeds !== "editable"}
                      readOnly={fieldVisibility.accessibilityNeeds !== "editable"}
                      onChange={(event) => setAccessibilityNeeds(event.target.value)}
                      aria-invalid={Boolean(firstError(state, "accessibilityNeeds")) || undefined}
                    />
                    <OptionalFieldDescription>
                      Describe accommodations or support that would help you participate.
                    </OptionalFieldDescription>
                    <FieldError>{firstError(state, "accessibilityNeeds")}</FieldError>
                  </Field>
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? "Saving..." : "Save profile"}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <aside className="flex flex-col gap-6">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Managed identity</CardTitle>
            <CardDescription>
              These required fields identify your speaker record and cannot be edited here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Legal or submitted name</dt>
                <dd>
                  {profile.givenName} {profile.familyName}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Preferred name</dt>
                <dd>{profile.preferredName ?? "Not provided"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {filesVisible ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Files</CardTitle>
              <CardDescription>Upload the headshot and speaker agreement the event team requested.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SpeakerFileControl
                id="profile-file-headshot"
                label="Headshot"
                description="JPEG, PNG, or WEBP, up to 5 MB."
                accept="image/jpeg,image/png,image/webp"
                hasFile={Boolean(profile.photoObjectKey)}
                downloadHref={`/portal/${encodeURIComponent(eventSlug)}/profile/files/headshot`}
                uploadAction={uploadSpeakerProfileFile.bind(null, eventSlug, "headshot")}
                removeAction={removeSpeakerProfileFile.bind(null, eventSlug, "headshot")}
              />
              <SpeakerFileControl
                id="profile-file-agreement"
                label="Speaker agreement"
                description="PDF, up to 10 MB."
                accept="application/pdf"
                hasFile={Boolean(profile.agreementObjectKey)}
                downloadHref={`/portal/${encodeURIComponent(eventSlug)}/profile/files/agreement`}
                uploadAction={uploadSpeakerProfileFile.bind(null, eventSlug, "agreement")}
                removeAction={removeSpeakerProfileFile.bind(null, eventSlug, "agreement")}
              />
            </CardContent>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}
