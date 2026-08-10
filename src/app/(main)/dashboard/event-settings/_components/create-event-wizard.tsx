"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowLeft, ArrowRight, Check, ImageUp, PencilLine, Sparkles, Trash2 } from "lucide-react";

import { DateTimePicker } from "@/components/date-time-picker";
import { browserTimezone, TimezoneSelect } from "@/components/timezone-select";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

import type { MutationResult } from "../types";

type FieldErrors = MutationResult["fieldErrors"];

const EVENT_TYPES = ["CONFERENCE", "MEETUP", "WORKSHOP", "OTHER"] as const;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const STEPS = [
  { key: "basics", label: "Basics", description: "Name your event" },
  { key: "schedule", label: "Schedule", description: "When and where" },
  { key: "branding", label: "Branding", description: "Logo and backdrop" },
  { key: "review", label: "Program & review", description: "Options, then create" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const STEP_FIELDS: Record<StepKey, readonly string[]> = {
  basics: ["name", "slug", "type"],
  schedule: ["websiteUrl", "location", "timezone", "startsAt", "endsAt"],
  branding: ["theme", "logoFile", "backgroundFile"],
  review: ["exhibitorsEnabled", "sponsorsEnabled"],
};

interface ImagePick {
  readonly file: File;
  readonly previewUrl: string;
}

interface WizardState {
  readonly name: string;
  readonly slug: string;
  readonly slugEdited: boolean;
  readonly type: (typeof EVENT_TYPES)[number];
  readonly websiteUrl: string;
  readonly location: string;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly theme: string;
  readonly exhibitorsEnabled: boolean;
  readonly sponsorsEnabled: boolean;
  readonly logo: ImagePick | null;
  readonly background: ImagePick | null;
}

const INITIAL_STATE: WizardState = {
  name: "",
  slug: "",
  slugEdited: false,
  type: "CONFERENCE",
  websiteUrl: "",
  location: "",
  timezone: "America/Los_Angeles",
  startsAt: "",
  endsAt: "",
  theme: "",
  exhibitorsEnabled: false,
  sponsorsEnabled: false,
  logo: null,
  background: null,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function stepClientErrors(step: StepKey, state: WizardState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === "basics") {
    if (!state.name.trim()) errors.name = "Event name is required.";
    if (!state.slug.trim()) errors.slug = "Slug is required.";
    else if (!SLUG_PATTERN.test(state.slug)) errors.slug = "Use lowercase letters, numbers, and single hyphens.";
  }
  if (step === "schedule") {
    if (!state.timezone.trim()) errors.timezone = "Time zone is required.";
    else if (!validTimezone(state.timezone)) errors.timezone = "Enter a valid IANA time zone.";
    if (!state.startsAt) errors.startsAt = "Start date and time are required.";
    if (!state.endsAt) errors.endsAt = "End date and time are required.";
    else if (state.startsAt && state.endsAt <= state.startsAt) errors.endsAt = "End must be later than start.";
  }
  return errors;
}

function firstServerError(errors: FieldErrors, field: string): string | undefined {
  return errors?.[field]?.[0];
}

function stepWithServerError(errors: FieldErrors): number {
  if (!errors) return -1;
  return STEPS.findIndex(({ key }) => STEP_FIELDS[key].some((field) => errors[field]?.length));
}

function imagePickError(file: File, label: string, maxMegabytes: number): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return `Upload the ${label} as a PNG, JPEG, or WebP image.`;
  }
  if (file.size > maxMegabytes * 1024 * 1024) {
    return `The ${label} must be ${maxMegabytes} MB or smaller.`;
  }
  return null;
}

function stepStatus(index: number, currentIndex: number): "done" | "current" | "upcoming" {
  if (index < currentIndex) return "done";
  if (index === currentIndex) return "current";
  return "upcoming";
}

function formatBytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function ImagePicker({
  id,
  label,
  description,
  pick,
  error,
  previewClassName,
  onSelect,
  onClear,
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly pick: ImagePick | null;
  readonly error?: string;
  readonly previewClassName: string;
  readonly onSelect: (file: File) => void;
  readonly onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="sr-only"
        onChange={(changeEvent) => {
          const file = changeEvent.target.files?.[0];
          if (file) onSelect(file);
          changeEvent.target.value = "";
        }}
      />
      {pick ? (
        <div className="flex items-center gap-3 rounded-lg border p-2">
          {/* biome-ignore lint/performance/noImgElement: object URLs preview local picks before upload */}
          <img src={pick.previewUrl} alt="" className={cn("shrink-0 rounded-md border bg-muted", previewClassName)} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{pick.file.name}</p>
            <p className="text-muted-foreground text-xs">{formatBytes(pick.file.size)}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            Replace
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} onClick={onClear}>
            <Trash2 />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-muted-foreground text-sm transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => inputRef.current?.click()}
        >
          <ImageUp className="size-4" aria-hidden="true" />
          Choose image
        </button>
      )}
      <FieldDescription>{description}</FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function PortalPreview({ state }: { readonly state: WizardState }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-l-4 border-l-primary bg-background">
      {state.background ? (
        // biome-ignore lint/performance/noImgElement: object URLs preview local picks before upload
        <img src={state.background.previewUrl} alt="" className="absolute inset-0 size-full object-cover opacity-10" />
      ) : null}
      <div className="relative flex items-center gap-3 px-4 py-3">
        {state.logo ? (
          // biome-ignore lint/performance/noImgElement: object URLs preview local picks before upload
          <img src={state.logo.previewUrl} alt="" className="size-7 shrink-0 object-contain" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-sm">{state.name.trim() || "Your event"}</p>
          <p className="truncate text-muted-foreground text-xs">{state.theme.trim() || "Participant portal"}</p>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-muted-foreground text-sm">{label}</dt>
      <dd className="truncate text-right font-medium text-sm">{value}</dd>
    </div>
  );
}

export function CreateEventWizard({
  errors,
  pending,
  action,
}: {
  readonly errors?: FieldErrors;
  readonly pending: boolean;
  readonly action: (formData: FormData) => Promise<void>;
}) {
  const [state, setState] = useState<WizardState>(() => ({ ...INITIAL_STATE, timezone: browserTimezone() }));
  const [stepIndex, setStepIndex] = useState(0);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const step = STEPS[stepIndex] ?? STEPS[0];

  useEffect(() => {
    const errored = stepWithServerError(errors);
    if (errored >= 0) setStepIndex(errored);
  }, [errors]);

  const picksRef = useRef<{ logo: ImagePick | null; background: ImagePick | null }>({ logo: null, background: null });
  picksRef.current = { logo: state.logo, background: state.background };

  useEffect(() => {
    return () => {
      for (const pick of [picksRef.current.logo, picksRef.current.background]) {
        if (pick) URL.revokeObjectURL(pick.previewUrl);
      }
    };
  }, []);

  const update = (patch: Partial<WizardState>) => setState((current) => ({ ...current, ...patch }));

  const selectImage = (target: "logo" | "background", label: string, maxMegabytes: number) => (file: File) => {
    const error = imagePickError(file, label, maxMegabytes);
    if (error) {
      setClientErrors((current) => ({ ...current, [`${target}File`]: error }));
      return;
    }
    setClientErrors(({ [`${target}File`]: _removed, ...rest }) => rest);
    setState((current) => {
      const previous = current[target];
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return { ...current, [target]: { file, previewUrl: URL.createObjectURL(file) } };
    });
  };

  const clearImage = (target: "logo" | "background") => () => {
    setClientErrors(({ [`${target}File`]: _removed, ...rest }) => rest);
    setState((current) => {
      const previous = current[target];
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return { ...current, [target]: null };
    });
  };

  const errorFor = (field: string): string | undefined => clientErrors[field] ?? firstServerError(errors, field);

  const goNext = () => {
    const stepErrors = stepClientErrors(step.key, state);
    setClientErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setClientErrors({});
    setStepIndex((current) => Math.max(current - 1, 0));
  };

  const jumpTo = (index: number) => {
    setClientErrors({});
    setStepIndex(index);
  };

  const submit = async () => {
    const data = new FormData();
    data.set("name", state.name);
    data.set("slug", state.slug);
    data.set("type", state.type);
    data.set("websiteUrl", state.websiteUrl);
    data.set("location", state.location);
    data.set("timezone", state.timezone);
    data.set("startsAt", state.startsAt);
    data.set("endsAt", state.endsAt);
    data.set("theme", state.theme);
    if (state.exhibitorsEnabled) data.set("exhibitorsEnabled", "on");
    if (state.sponsorsEnabled) data.set("sponsorsEnabled", "on");
    if (state.logo) data.set("logoFile", state.logo.file);
    if (state.background) data.set("backgroundFile", state.background.file);
    await action(data);
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Create event steps">
        <ol className="flex gap-1 sm:gap-2">
          {STEPS.map((item, index) => {
            const status = stepStatus(index, stepIndex);
            return (
              <li key={item.key} className="flex-1">
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col gap-1.5 rounded-md px-1 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring",
                    status === "upcoming" && "cursor-default",
                  )}
                  aria-current={status === "current" ? "step" : undefined}
                  disabled={status === "upcoming" || pending}
                  onClick={() => jumpTo(index)}
                >
                  <span
                    className={cn(
                      "h-1 w-full rounded-full",
                      status === "upcoming" ? "bg-muted" : "bg-primary",
                      status === "current" && "opacity-70",
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px]",
                        status === "upcoming" ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {status === "done" ? <Check className="size-2.5" /> : index + 1}
                    </span>
                    <span
                      className={cn(
                        "truncate font-medium text-xs",
                        status === "upcoming" ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {item.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {step.key === "basics" ? (
        <FieldGroup>
          <Field data-invalid={Boolean(errorFor("name"))}>
            <FieldLabel htmlFor="wizard-name">Event name</FieldLabel>
            <Input
              id="wizard-name"
              value={state.name}
              autoFocus
              aria-invalid={Boolean(errorFor("name"))}
              placeholder="Board to Death 2027"
              onChange={({ target }) =>
                update({ name: target.value, slug: state.slugEdited ? state.slug : slugify(target.value) })
              }
            />
            <FieldError>{errorFor("name")}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errorFor("slug"))}>
            <FieldLabel htmlFor="wizard-slug">Slug</FieldLabel>
            <Input
              id="wizard-slug"
              value={state.slug}
              aria-invalid={Boolean(errorFor("slug"))}
              placeholder="board-to-death-2027"
              onChange={({ target }) => update({ slug: target.value, slugEdited: true })}
            />
            <FieldDescription>Used in links. Lowercase letters, numbers, and single hyphens.</FieldDescription>
            <FieldError>{errorFor("slug")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="wizard-type">Type</FieldLabel>
            <Select value={state.type} onValueChange={(value) => update({ type: value as WizardState["type"] })}>
              <SelectTrigger id="wizard-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {EVENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0) + type.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      ) : null}

      {step.key === "schedule" ? (
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={Boolean(errorFor("startsAt"))}>
              <FieldLabel htmlFor="wizard-start">Starts</FieldLabel>
              <DateTimePicker
                id="wizard-start"
                value={state.startsAt}
                aria-invalid={Boolean(errorFor("startsAt"))}
                onChange={(next) => update({ startsAt: next })}
              />
              <FieldError>{errorFor("startsAt")}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errorFor("endsAt"))}>
              <FieldLabel htmlFor="wizard-end">Ends</FieldLabel>
              <DateTimePicker
                id="wizard-end"
                value={state.endsAt}
                min={state.startsAt || undefined}
                aria-invalid={Boolean(errorFor("endsAt"))}
                onChange={(next) => update({ endsAt: next })}
              />
              <FieldError>{errorFor("endsAt")}</FieldError>
            </Field>
          </div>
          <Field data-invalid={Boolean(errorFor("timezone"))}>
            <FieldLabel htmlFor="wizard-timezone">Time zone</FieldLabel>
            <TimezoneSelect
              id="wizard-timezone"
              value={state.timezone}
              aria-invalid={Boolean(errorFor("timezone"))}
              onChange={(next) => update({ timezone: next })}
            />
            <FieldDescription>Dates above are entered in this time zone.</FieldDescription>
            <FieldError>{errorFor("timezone")}</FieldError>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="wizard-location">Location</FieldLabel>
              <Input
                id="wizard-location"
                value={state.location}
                placeholder="Portland, Oregon"
                onChange={({ target }) => update({ location: target.value })}
              />
            </Field>
            <Field data-invalid={Boolean(errorFor("websiteUrl"))}>
              <FieldLabel htmlFor="wizard-website">Website URL</FieldLabel>
              <Input
                id="wizard-website"
                type="url"
                value={state.websiteUrl}
                aria-invalid={Boolean(errorFor("websiteUrl"))}
                placeholder="https://example.com"
                onChange={({ target }) => update({ websiteUrl: target.value })}
              />
              <FieldError>{errorFor("websiteUrl")}</FieldError>
            </Field>
          </div>
        </FieldGroup>
      ) : null}

      {step.key === "branding" ? (
        <FieldGroup>
          <PortalPreview state={state} />
          <ImagePicker
            id="wizard-logo"
            label="Logo"
            description="Shown next to your event name. PNG, JPEG, or WebP, up to 5 MB."
            pick={state.logo}
            error={errorFor("logoFile")}
            previewClassName="size-12 object-contain p-1"
            onSelect={selectImage("logo", "logo", 5)}
            onClear={clearImage("logo")}
          />
          <ImagePicker
            id="wizard-background"
            label="Background image"
            description="Used as a subtle backdrop behind your event pages. PNG, JPEG, or WebP, up to 10 MB."
            pick={state.background}
            error={errorFor("backgroundFile")}
            previewClassName="h-12 w-20 object-cover"
            onSelect={selectImage("background", "background image", 10)}
            onClear={clearImage("background")}
          />
          <Field>
            <FieldLabel htmlFor="wizard-theme">Descriptive theme</FieldLabel>
            <Input
              id="wizard-theme"
              value={state.theme}
              placeholder="Playful strategy and design"
              onChange={({ target }) => update({ theme: target.value })}
            />
            <FieldDescription>A short phrase that sets the tone for participants.</FieldDescription>
          </Field>
        </FieldGroup>
      ) : null}

      {step.key === "review" ? (
        <div className="flex flex-col gap-5">
          <PortalPreview state={state} />
          <FieldSet>
            <FieldLegend variant="label">Program features</FieldLegend>
            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <FieldLabel htmlFor="wizard-exhibitors" className="font-normal">
                  <span className="flex flex-col gap-0.5">
                    <span>Exhibitors</span>
                    <span className="text-muted-foreground text-xs">
                      Enable exhibitor administration for this event.
                    </span>
                  </span>
                </FieldLabel>
                <Switch
                  id="wizard-exhibitors"
                  checked={state.exhibitorsEnabled}
                  onCheckedChange={(checked) => update({ exhibitorsEnabled: checked })}
                />
              </Field>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="wizard-sponsors" className="font-normal">
                  <span className="flex flex-col gap-0.5">
                    <span>Sponsors</span>
                    <span className="text-muted-foreground text-xs">Enable sponsor administration for this event.</span>
                  </span>
                </FieldLabel>
                <Switch
                  id="wizard-sponsors"
                  checked={state.sponsorsEnabled}
                  onCheckedChange={(checked) => update({ sponsorsEnabled: checked })}
                />
              </Field>
            </FieldGroup>
          </FieldSet>
          <div className="rounded-lg border px-4 py-2">
            <dl className="divide-y">
              <ReviewRow label="Name" value={state.name.trim() || "—"} />
              <ReviewRow label="Slug" value={state.slug || "—"} />
              <ReviewRow label="Type" value={state.type.charAt(0) + state.type.slice(1).toLowerCase()} />
              <ReviewRow label="Starts" value={state.startsAt ? state.startsAt.replace("T", " ") : "—"} />
              <ReviewRow label="Ends" value={state.endsAt ? state.endsAt.replace("T", " ") : "—"} />
              <ReviewRow label="Time zone" value={state.timezone || "—"} />
              <ReviewRow label="Location" value={state.location.trim() || "—"} />
              <ReviewRow label="Logo" value={state.logo ? state.logo.file.name : "None"} />
              <ReviewRow label="Background" value={state.background ? state.background.file.name : "None"} />
            </dl>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" disabled={stepIndex === 0 || pending} onClick={goBack}>
          <ArrowLeft data-icon="inline-start" />
          Back
        </Button>
        {step.key === "review" ? (
          <Button type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? <Spinner data-icon="inline-start" /> : <PencilLine data-icon="inline-start" />}
            {pending ? "Creating…" : "Create event"}
          </Button>
        ) : (
          <Button type="button" onClick={goNext}>
            Next
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}
