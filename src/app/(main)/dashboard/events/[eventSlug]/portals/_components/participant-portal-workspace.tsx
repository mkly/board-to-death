"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { ArrowDown, ArrowUp, Eye, Plus, Save, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import {
  deleteParticipantPortal,
  moveParticipantPortal,
  type PortalMutationState,
  saveParticipantPortal,
} from "../actions";

const ACCENTS = ["neutral", "rose", "orange", "amber", "emerald", "sky", "indigo", "violet"] as const;
const ROLES = ["SPEAKER", "MODERATOR", "CHAIRPERSON"] as const;
const STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "WAITLISTED", "ACCEPTED", "REJECTED", "CONFIRMED"] as const;
const GROUP_KINDS = ["SPONSOR", "EXHIBITOR"] as const;
const CONTENT = ["submissions", "profile", "tasks", "sessions", "resources", "files", "forms"] as const;
const PROFILE_FIELDS = [
  "phone",
  "pronouns",
  "organization",
  "jobTitle",
  "biography",
  "websiteUrl",
  "accessibilityNeeds",
] as const;
const LABELS: Record<string, string> = {
  submissions: "Submissions",
  profile: "Profile",
  tasks: "Tasks",
  sessions: "Sessions",
  resources: "Resources",
  files: "Files",
  forms: "Forms",
  phone: "Phone",
  pronouns: "Pronouns",
  organization: "Organization",
  jobTitle: "Job title",
  biography: "Biography",
  websiteUrl: "Website",
  accessibilityNeeds: "Accessibility needs",
};

interface Portal {
  readonly id: string | null;
  readonly name: string;
  readonly slug: string;
  readonly welcomeMessage: string;
  readonly accentColor: string;
  readonly logoObjectKey: string;
  readonly backgroundObjectKey: string;
  readonly sectionTitles: Readonly<Record<"submissions" | "profile" | "tasks" | "sessions" | "resources", string>>;
  readonly audienceRules: {
    readonly roles: readonly string[];
    readonly submissionStatuses: readonly string[];
    readonly groupKinds: readonly string[];
  };
  readonly contentVisibility: Readonly<Record<(typeof CONTENT)[number], boolean>>;
  readonly profileFieldVisibility: Readonly<Record<(typeof PROFILE_FIELDS)[number], string>>;
  readonly isDefault: boolean;
}

interface PreviewParticipant {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly portalName: string;
  readonly portalWelcomeMessage: string;
}

const EMPTY_PORTAL: Portal = {
  id: null,
  name: "",
  slug: "",
  welcomeMessage: "Track your proposals, speaking schedule, onboarding work, and event resources in one place.",
  accentColor: "neutral",
  logoObjectKey: "",
  backgroundObjectKey: "",
  sectionTitles: {
    submissions: "My submissions",
    profile: "My profile",
    tasks: "Onboarding tasks",
    sessions: "My sessions",
    resources: "Resources",
  },
  audienceRules: { roles: [], submissionStatuses: [], groupKinds: [] },
  contentVisibility: {
    submissions: true,
    profile: true,
    tasks: true,
    sessions: true,
    resources: true,
    files: true,
    forms: true,
  },
  profileFieldVisibility: {
    phone: "editable",
    pronouns: "editable",
    organization: "editable",
    jobTitle: "editable",
    biography: "editable",
    websiteUrl: "editable",
    accessibilityNeeds: "editable",
  },
  isDefault: false,
};

const INITIAL_STATE: PortalMutationState = { status: "idle" };

function firstError(state: PortalMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function CheckOption({
  defaultChecked,
  label,
  name,
  value,
}: {
  readonly defaultChecked: boolean;
  readonly label: string;
  readonly name: string;
  readonly value: string;
}) {
  const id = `${name}-${value}`;
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} name={name} value={value} defaultChecked={defaultChecked} />
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
  );
}

export function ParticipantPortalWorkspace({
  event,
  portals,
  previewParticipants,
}: {
  readonly event: { readonly name: string; readonly slug: string };
  readonly portals: readonly Portal[];
  readonly previewParticipants: readonly PreviewParticipant[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(() => portals[0]?.id ?? null);
  const selected = portals.find(({ id }) => id === selectedId) ?? EMPTY_PORTAL;
  const [previewId, setPreviewId] = useState(() => previewParticipants[0]?.id ?? "");
  const preview = previewParticipants.find(({ id }) => id === previewId);
  const [feedback, setFeedback] = useState("");
  const [mutationPending, startMutation] = useTransition();
  const [saveState, saveAction, savePending] = useActionState(saveParticipantPortal, INITIAL_STATE);

  useEffect(() => {
    if (!saveState.message) return;
    setFeedback(saveState.message);
    if (saveState.status === "success") {
      if (saveState.portalId) setSelectedId(saveState.portalId);
      router.refresh();
    }
  }, [router, saveState]);

  const mutate = (operation: () => Promise<PortalMutationState>) => {
    startMutation(async () => {
      const result = await operation();
      setFeedback(result.message ?? "");
      if (result.status === "success") router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Participant portals</h1>
          <p className="max-w-3xl text-muted-foreground text-sm">
            Create branded participant experiences. The first matching audience wins; the default catches everyone else.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setSelectedId(null)}>
          <Plus data-icon="inline-start" />
          New portal
        </Button>
      </header>

      {feedback ? (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {feedback}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Audience precedence</CardTitle>
            <CardDescription>{portals.length} configured portals</CardDescription>
          </CardHeader>
          <CardContent>
            {portals.length === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Eye />
                  </EmptyMedia>
                  <EmptyTitle>No custom portals</EmptyTitle>
                  <EmptyDescription>The built-in speaker portal remains active until you create one.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {portals.map((portal, index) => (
                  <div key={portal.id} className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant={selectedId === portal.id ? "secondary" : "ghost"}
                      className="h-auto min-w-0 flex-1 justify-start py-2 text-left"
                      onClick={() => setSelectedId(portal.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{portal.name}</span>
                      {portal.isDefault ? <Badge variant="outline">Default</Badge> : null}
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Move ${portal.name} up`}
                      disabled={index === 0 || mutationPending}
                      onClick={() =>
                        portal.id && mutate(() => moveParticipantPortal(event.slug, portal.id as string, "up"))
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Move ${portal.name} down`}
                      disabled={index === portals.length - 1 || mutationPending}
                      onClick={() =>
                        portal.id && mutate(() => moveParticipantPortal(event.slug, portal.id as string, "down"))
                      }
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <form key={selected.id ?? "new"} action={saveAction}>
          <input type="hidden" name="eventSlug" value={event.slug} />
          <input type="hidden" name="portalId" value={selected.id ?? ""} />
          <Card>
            <CardHeader>
              <CardTitle>{selected.id ? `Edit ${selected.name}` : "New participant portal"}</CardTitle>
              <CardDescription>
                Configure its audience, appearance, navigation, and profile-field access.
              </CardDescription>
              {selected.id ? (
                <CardAction>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${selected.name}`}>
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selected.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Participants will be matched to the next eligible portal.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            selected.id && mutate(() => deleteParticipantPortal(event.slug, selected.id as string))
                          }
                        >
                          Delete portal
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="identity">
                <TabsList className="max-w-full flex-wrap">
                  <TabsTrigger value="identity">Identity</TabsTrigger>
                  <TabsTrigger value="audience">Audience</TabsTrigger>
                  <TabsTrigger value="content">Content</TabsTrigger>
                  <TabsTrigger value="fields">Fields</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                <TabsContent value="identity" className="pt-5" forceMount>
                  <FieldGroup>
                    <div className="grid gap-5 md:grid-cols-2">
                      <Field data-invalid={Boolean(firstError(saveState, "name"))}>
                        <FieldLabel htmlFor="portal-name">Name</FieldLabel>
                        <Input
                          id="portal-name"
                          name="name"
                          defaultValue={selected.name}
                          required
                          aria-invalid={Boolean(firstError(saveState, "name"))}
                        />
                        <FieldError>{firstError(saveState, "name")}</FieldError>
                      </Field>
                      <Field data-invalid={Boolean(firstError(saveState, "slug"))}>
                        <FieldLabel htmlFor="portal-slug">Slug</FieldLabel>
                        <Input
                          id="portal-slug"
                          name="slug"
                          defaultValue={selected.slug}
                          required
                          aria-invalid={Boolean(firstError(saveState, "slug"))}
                        />
                        <FieldDescription>Internal identifier for this portal.</FieldDescription>
                        <FieldError>{firstError(saveState, "slug")}</FieldError>
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="portal-welcome">Welcome message</FieldLabel>
                      <Textarea
                        id="portal-welcome"
                        name="welcomeMessage"
                        defaultValue={selected.welcomeMessage}
                        rows={3}
                      />
                    </Field>
                    <div className="grid gap-5 md:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="portal-accent">Accent</FieldLabel>
                        <Select name="accentColor" defaultValue={selected.accentColor}>
                          <SelectTrigger id="portal-accent">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            <SelectGroup>
                              {ACCENTS.map((accent) => (
                                <SelectItem key={accent} value={accent}>
                                  {accent.charAt(0).toUpperCase() + accent.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="portal-logo">Logo asset key</FieldLabel>
                        <Input
                          id="portal-logo"
                          name="logoObjectKey"
                          defaultValue={selected.logoObjectKey}
                          placeholder="events/portal-logo.svg"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="portal-background">Background asset key</FieldLabel>
                        <Input
                          id="portal-background"
                          name="backgroundObjectKey"
                          defaultValue={selected.backgroundObjectKey}
                          placeholder="events/portal-background.webp"
                        />
                      </Field>
                    </div>
                    <Field orientation="horizontal">
                      <FieldLabel htmlFor="portal-default">
                        <span className="flex flex-col gap-0.5">
                          <span>Default portal</span>
                          <span className="text-muted-foreground text-xs">Use when no audience rule matches.</span>
                        </span>
                      </FieldLabel>
                      <Switch id="portal-default" name="isDefault" defaultChecked={selected.isDefault} />
                    </Field>
                  </FieldGroup>
                </TabsContent>
                <TabsContent value="audience" className="pt-5" forceMount>
                  <div className="grid gap-6 lg:grid-cols-3">
                    <FieldSet>
                      <FieldLegend variant="label">Participant roles</FieldLegend>
                      <FieldDescription>Match any selected role.</FieldDescription>
                      <FieldGroup className="gap-3">
                        {ROLES.map((role) => (
                          <CheckOption
                            key={role}
                            name="roles"
                            value={role}
                            label={role.toLowerCase()}
                            defaultChecked={selected.audienceRules.roles.includes(role)}
                          />
                        ))}
                      </FieldGroup>
                    </FieldSet>
                    <FieldSet>
                      <FieldLegend variant="label">Submission status</FieldLegend>
                      <FieldDescription>Match any selected status.</FieldDescription>
                      <FieldGroup className="gap-3">
                        {STATUSES.map((status) => (
                          <CheckOption
                            key={status}
                            name="submissionStatuses"
                            value={status}
                            label={status.toLowerCase().replaceAll("_", " ")}
                            defaultChecked={selected.audienceRules.submissionStatuses.includes(status)}
                          />
                        ))}
                      </FieldGroup>
                    </FieldSet>
                    <FieldSet>
                      <FieldLegend variant="label">Group kind</FieldLegend>
                      <FieldDescription>Matches a contact membership with the same email.</FieldDescription>
                      <FieldGroup className="gap-3">
                        {GROUP_KINDS.map((kind) => (
                          <CheckOption
                            key={kind}
                            name="groupKinds"
                            value={kind}
                            label={kind.toLowerCase()}
                            defaultChecked={selected.audienceRules.groupKinds.includes(kind)}
                          />
                        ))}
                      </FieldGroup>
                    </FieldSet>
                  </div>
                </TabsContent>
                <TabsContent value="content" className="pt-5" forceMount>
                  <FieldGroup>
                    <FieldSet>
                      <FieldLegend variant="label">Visible sections</FieldLegend>
                      <FieldDescription>
                        Hidden sections are removed from navigation and the portal home.
                      </FieldDescription>
                      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {CONTENT.map((key) => (
                          <CheckOption
                            key={key}
                            name={`content-${key}`}
                            value="on"
                            label={LABELS[key]}
                            defaultChecked={selected.contentVisibility[key]}
                          />
                        ))}
                      </FieldGroup>
                    </FieldSet>
                    <FieldSet>
                      <FieldLegend variant="label">Section titles</FieldLegend>
                      <FieldGroup>
                        <div className="grid gap-5 sm:grid-cols-2">
                          {Object.entries(selected.sectionTitles).map(([key, value]) => (
                            <Field key={key}>
                              <FieldLabel htmlFor={`title-${key}`}>{LABELS[key]}</FieldLabel>
                              <Input id={`title-${key}`} name={`title-${key}`} defaultValue={value} required />
                            </Field>
                          ))}
                        </div>
                      </FieldGroup>
                    </FieldSet>
                  </FieldGroup>
                </TabsContent>
                <TabsContent value="fields" className="pt-5" forceMount>
                  <FieldSet>
                    <FieldLegend variant="label">Profile field access</FieldLegend>
                    <FieldDescription>
                      Editable fields can be changed, view-only fields remain visible, and hidden fields are omitted.
                    </FieldDescription>
                    <FieldGroup>
                      {PROFILE_FIELDS.map((field) => (
                        <Field key={field} orientation="responsive">
                          <FieldLabel htmlFor={`field-${field}`}>{LABELS[field]}</FieldLabel>
                          <Select name={`field-${field}`} defaultValue={selected.profileFieldVisibility[field]}>
                            <SelectTrigger id={`field-${field}`} className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              <SelectGroup>
                                <SelectItem value="editable">Editable</SelectItem>
                                <SelectItem value="view">View only</SelectItem>
                                <SelectItem value="hidden">Hidden</SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      ))}
                    </FieldGroup>
                  </FieldSet>
                </TabsContent>
                <TabsContent value="preview" className="pt-5">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="preview-participant">Preview participant</FieldLabel>
                      <Select value={previewId} onValueChange={setPreviewId}>
                        <SelectTrigger id="preview-participant">
                          <SelectValue placeholder="Choose a participant" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectGroup>
                            {previewParticipants.map((participant) => (
                              <SelectItem key={participant.id} value={participant.id}>
                                {participant.name} · {participant.email}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {preview ? (
                      <Card size="sm">
                        <CardHeader>
                          <CardDescription>Matched portal</CardDescription>
                          <CardTitle>{preview.portalName}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-muted-foreground text-sm">
                            {preview.portalWelcomeMessage || "No welcome message configured."}
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <Empty>
                        <EmptyHeader>
                          <EmptyTitle>No participant selected</EmptyTitle>
                          <EmptyDescription>
                            Add a participant to this event to preview audience matching.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </FieldGroup>
                </TabsContent>
              </Tabs>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="submit" disabled={savePending}>
                {savePending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                {savePending ? "Saving…" : "Save portal"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  );
}
