"use client";

import { useActionState, useMemo, useState } from "react";

import Link from "next/link";

import { FilePlus2, Save } from "lucide-react";

import { SanitizedMarkdown } from "@/components/content/sanitized-markdown";
import { useDerivedIdentifierChanges } from "@/components/derived-identifier-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  EMAIL_TEMPLATE_PREVIEW_VALUES,
  EMAIL_TEMPLATE_VARIABLES,
  renderEmailTemplate,
} from "@/lib/communications/email-templates";
import type { PersistedEmailTemplate } from "@/server/communications/templates";

import { type SaveEmailTemplateState, saveEmailTemplate } from "../actions";

interface DraftTemplate {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly textTemplate: string;
}

interface EmailTemplateWorkspaceProps {
  readonly event: {
    readonly name: string;
    readonly slug: string;
    readonly startsAt: string;
    readonly location: string | null;
  };
  readonly templates: readonly PersistedEmailTemplate[];
}

const NEW_TEMPLATE: DraftTemplate = {
  id: "",
  key: "",
  name: "",
  subjectTemplate: "",
  bodyTemplate: "",
  textTemplate: "",
};

const INITIAL_SAVE_EMAIL_TEMPLATE_STATE: SaveEmailTemplateState = { status: "idle" };

function draftFromTemplate(template: PersistedEmailTemplate): DraftTemplate {
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
    textTemplate: template.textTemplate ?? "",
  };
}

function firstError(state: SaveEmailTemplateState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function saveButtonLabel(pending: boolean, isNew: boolean): string {
  if (pending) return "Saving...";
  return isNew ? "Create template" : "Save new version";
}

export function EmailTemplateWorkspace({ event, templates }: EmailTemplateWorkspaceProps) {
  const [draft, setDraft] = useState<DraftTemplate>(() =>
    templates[0] ? draftFromTemplate(templates[0]) : NEW_TEMPLATE,
  );
  const [state, formAction, pending] = useActionState(
    async (previousState: SaveEmailTemplateState, formData: FormData) => {
      const result = await saveEmailTemplate(previousState, formData);
      if (result.status === "success" && result.templateId) {
        setDraft((current) => ({ ...current, id: result.templateId ?? current.id }));
      }
      return result;
    },
    INITIAL_SAVE_EMAIL_TEMPLATE_STATE,
  );
  const previewValues = useMemo(
    () => ({
      ...EMAIL_TEMPLATE_PREVIEW_VALUES,
      "event.name": event.name,
      "event.start_date": event.startsAt,
      "event.location": event.location ?? "Online",
    }),
    [event],
  );
  const preview = renderEmailTemplate(
    {
      ...draft,
      key: draft.key || "preview",
      name: draft.name || "Preview",
    },
    previewValues,
  );
  const submitLabel = saveButtonLabel(pending, draft.id === "");

  const updateDraft = (field: keyof DraftTemplate, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const nameAndKeyChanges = useDerivedIdentifierChanges({
    identifier: draft.key,
    onIdentifierChange: (value) => updateDraft("key", value),
    onSourceChange: (value) => updateDraft("name", value),
    resetKey: draft.id || "new",
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Email templates</h1>
          <p className="text-muted-foreground text-sm">
            Create safe, reusable messages scoped to this event. Every save keeps the previous version.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/dashboard/events/${encodeURIComponent(event.slug)}/communications/audience`}>
              Recipient audience
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => setDraft(NEW_TEMPLATE)}>
            <FilePlus2 data-icon="inline-start" />
            New template
          </Button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Event templates</CardTitle>
            <CardDescription>{templates.length} saved for this event</CardDescription>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilePlus2 />
                  </EmptyMedia>
                  <EmptyTitle>No templates yet</EmptyTitle>
                  <EmptyDescription>Create the first reusable email for this event.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {templates.map((template) => (
                  <Button
                    key={template.id}
                    type="button"
                    variant={draft.id === template.id ? "secondary" : "ghost"}
                    className="h-auto min-w-0 justify-start py-2 text-left"
                    onClick={() => setDraft(draftFromTemplate(template))}
                  >
                    <span className="min-w-0 flex-1 truncate">{template.name}</span>
                    <Badge variant="outline">v{template.version}</Badge>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-6 2xl:grid-cols-2">
          <form action={formAction}>
            <input type="hidden" name="eventSlug" value={event.slug} />
            <input type="hidden" name="templateId" value={draft.id} />
            <Card>
              <CardHeader>
                <CardTitle>{draft.id === "" ? "Create template" : `Edit ${draft.name}`}</CardTitle>
                <CardDescription>
                  Write the message in Markdown and insert only variables from the catalog below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field data-invalid={Boolean(firstError(state, "name")) || undefined}>
                    <FieldLabel htmlFor="template-name">Name</FieldLabel>
                    <Input
                      id="template-name"
                      name="name"
                      value={draft.name}
                      onChange={(event) => nameAndKeyChanges.changeSource(event.target.value)}
                      aria-invalid={Boolean(firstError(state, "name")) || undefined}
                      placeholder="Speaker welcome"
                      required
                    />
                    <FieldError>{firstError(state, "name")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(firstError(state, "key")) || undefined}>
                    <FieldLabel htmlFor="template-key">Key</FieldLabel>
                    <Input
                      id="template-key"
                      name="key"
                      value={draft.key}
                      onChange={(event) => nameAndKeyChanges.changeIdentifier(event.target.value)}
                      aria-invalid={Boolean(firstError(state, "key")) || undefined}
                      placeholder="speaker-welcome"
                      disabled={draft.id !== ""}
                      required
                    />
                    {draft.id !== "" ? <input type="hidden" name="key" value={draft.key} /> : null}
                    <FieldDescription>A stable lowercase identifier. It cannot change after creation.</FieldDescription>
                    <FieldError>{firstError(state, "key")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(firstError(state, "subjectTemplate")) || undefined}>
                    <FieldLabel htmlFor="template-subject">Subject</FieldLabel>
                    <Input
                      id="template-subject"
                      name="subjectTemplate"
                      value={draft.subjectTemplate}
                      onChange={(event) => updateDraft("subjectTemplate", event.target.value)}
                      aria-invalid={Boolean(firstError(state, "subjectTemplate")) || undefined}
                      placeholder="Welcome to {{event.name}}"
                      required
                    />
                    <FieldError>{firstError(state, "subjectTemplate")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(firstError(state, "bodyTemplate")) || undefined}>
                    <FieldLabel htmlFor="template-body">Message body</FieldLabel>
                    <Textarea
                      id="template-body"
                      name="bodyTemplate"
                      value={draft.bodyTemplate}
                      onChange={(event) => updateDraft("bodyTemplate", event.target.value)}
                      aria-invalid={Boolean(firstError(state, "bodyTemplate")) || undefined}
                      placeholder={"Hello {{speaker.name}},\n\nWelcome to **{{event.name}}**."}
                      className="min-h-56"
                      required
                    />
                    <FieldDescription>
                      Markdown is supported. Raw HTML is rejected before saving or delivery.
                    </FieldDescription>
                    <FieldError>{firstError(state, "bodyTemplate")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(firstError(state, "textTemplate")) || undefined}>
                    <FieldLabel htmlFor="template-text">Plain-text fallback</FieldLabel>
                    <Textarea
                      id="template-text"
                      name="textTemplate"
                      value={draft.textTemplate}
                      onChange={(event) => updateDraft("textTemplate", event.target.value)}
                      aria-invalid={Boolean(firstError(state, "textTemplate")) || undefined}
                      placeholder="Optional plain-text version"
                      className="min-h-24"
                    />
                    <FieldError>{firstError(state, "textTemplate")}</FieldError>
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="justify-between gap-3">
                <p aria-live="polite" className="text-muted-foreground text-sm">
                  {state.message}
                </p>
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  {submitLabel}
                </Button>
              </CardFooter>
            </Card>
          </form>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Variable catalog</CardTitle>
                <CardDescription>Only these values are accepted. Missing values stop delivery.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {EMAIL_TEMPLATE_VARIABLES.map(({ key, label }) => (
                  <Badge key={key} variant="secondary" title={label}>
                    {`{{${key}}}`}
                  </Badge>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>Uses representative event and recipient values.</CardDescription>
                {preview.ok ? (
                  <CardAction>
                    <Badge variant="outline">Safe preview</Badge>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent>
                {preview.ok ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-muted-foreground text-xs">Subject</span>
                      <p className="font-medium">{preview.rendered.subject}</p>
                    </div>
                    <div className="rounded-lg border bg-background p-4">
                      <SanitizedMarkdown content={preview.rendered.previewMarkdown} />
                    </div>
                  </div>
                ) : (
                  <Alert variant="destructive">
                    <AlertTitle>Preview unavailable</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-4">
                        {preview.issues.map((issue) => (
                          <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
