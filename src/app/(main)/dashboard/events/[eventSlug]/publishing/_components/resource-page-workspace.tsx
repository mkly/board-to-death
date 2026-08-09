"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { Archive, ArrowDown, ArrowUp, ExternalLink, FilePlus2, Save } from "lucide-react";

import { SanitizedMarkdown } from "@/components/content/sanitized-markdown";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import {
  archiveResourcePage,
  moveResourcePage,
  publishResourcePage,
  type ResourcePageMutationState,
  saveResourcePage,
  unpublishResourcePage,
} from "../actions";

type ResourceStatus = "draft" | "published" | "unpublished";

interface ResourcePageVersion {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly bodyMarkdown: string;
  readonly publishedAt: Date | null;
  readonly unpublishedAt: Date | null;
}

interface ResourcePage {
  readonly id: string;
  readonly status: ResourceStatus;
  readonly version: ResourcePageVersion;
  readonly pendingVersion: ResourcePageVersion | null;
}

interface ResourcePageWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly pages: readonly ResourcePage[];
}

interface EditableFields {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly bodyMarkdown: string;
}

const EMPTY_FIELDS: EditableFields = { slug: "", title: "", summary: "", bodyMarkdown: "" };
const INITIAL_STATE: ResourcePageMutationState = { status: "idle" };

function editableVersion(page: ResourcePage): ResourcePageVersion {
  return page.pendingVersion ?? page.version;
}

/** The version a publish would activate: a pending revision, or the current one while it is still a draft. */
function publishableVersion(page: ResourcePage | null): ResourcePageVersion | null {
  if (!page) return null;
  if (page.pendingVersion) return page.pendingVersion;
  return page.version.publishedAt === null && page.version.unpublishedAt === null ? page.version : null;
}

function toFields(page: ResourcePage | null): EditableFields {
  if (!page) return EMPTY_FIELDS;
  const version = editableVersion(page);
  return {
    slug: version.slug,
    title: version.title,
    summary: version.summary ?? "",
    bodyMarkdown: version.bodyMarkdown,
  };
}

function statusVariant(status: ResourceStatus): "default" | "secondary" | "outline" {
  if (status === "published") return "default";
  if (status === "unpublished") return "secondary";
  return "outline";
}

function firstError(state: ResourcePageMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

export function ResourcePageWorkspace({ event, pages }: ResourcePageWorkspaceProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(() => pages[0]?.id ?? null);
  const selected = pages.find((page) => page.id === selectedId) ?? null;
  const publishable = publishableVersion(selected);

  const [fields, setFields] = useState<EditableFields>(() => toFields(selected));
  useEffect(() => {
    setFields(toFields(selected));
  }, [selected]);

  const [feedback, setFeedback] = useState("");
  const [mutationPending, startMutation] = useTransition();
  const [saveState, saveAction, savePending] = useActionState(
    async (previousState: ResourcePageMutationState, formData: FormData) => {
      const result = await saveResourcePage(previousState, formData);
      if (result.status === "success") {
        if (result.pageId) setSelectedId(result.pageId);
        router.refresh();
      }
      return result;
    },
    INITIAL_STATE,
  );

  useEffect(() => {
    if (saveState.message) setFeedback(saveState.message);
  }, [saveState]);

  const updateField = (field: keyof EditableFields, value: string) => {
    setFields((current) => ({ ...current, [field]: value }));
  };

  const publish = () => {
    if (!selected || !publishable) return;
    startMutation(async () => {
      const result = await publishResourcePage(event.slug, selected.id, publishable.id);
      setFeedback(result.message ?? "");
      if (result.status === "success") router.refresh();
    });
  };

  const unpublish = () => {
    if (!selected) return;
    startMutation(async () => {
      const result = await unpublishResourcePage(event.slug, selected.id);
      setFeedback(result.message ?? "");
      if (result.status === "success") router.refresh();
    });
  };

  const archive = () => {
    if (!selected) return;
    startMutation(async () => {
      const result = await archiveResourcePage(event.slug, selected.id);
      setFeedback(result.message ?? "");
      if (result.status === "success") {
        setSelectedId(null);
        router.refresh();
      }
    });
  };

  const move = (pageId: string, direction: "up" | "down") => {
    startMutation(async () => {
      const result = await moveResourcePage(event.slug, pageId, direction);
      setFeedback(result.message ?? "");
      if (result.status === "success") router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Speaker resources</h1>
          <p className="text-muted-foreground text-sm">
            Draft, preview, order, and publish event-scoped pages for speakers.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setSelectedId(null)}>
          <FilePlus2 data-icon="inline-start" />
          New resource
        </Button>
      </header>

      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Resource order</CardTitle>
            <CardDescription>{pages.length} active resource pages</CardDescription>
          </CardHeader>
          <CardContent>
            {pages.length === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyTitle>No resources yet</EmptyTitle>
                  <EmptyDescription>Create the first speaker resource for this event.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {pages.map((page, index) => (
                  <div key={page.id} className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant={selectedId === page.id ? "secondary" : "ghost"}
                      className="h-auto min-w-0 flex-1 justify-start py-2 text-left"
                      onClick={() => setSelectedId(page.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{page.version.title}</span>
                      <Badge variant={statusVariant(page.status)}>{page.status}</Badge>
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Move ${page.version.title} up`}
                      disabled={index === 0 || mutationPending}
                      onClick={() => move(page.id, "up")}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Move ${page.version.title} down`}
                      disabled={index === pages.length - 1 || mutationPending}
                      onClick={() => move(page.id, "down")}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-6 2xl:grid-cols-2">
          <form action={saveAction}>
            <input type="hidden" name="eventSlug" value={event.slug} />
            <input type="hidden" name="pageId" value={selected?.id ?? ""} />
            <Card>
              <CardHeader>
                <CardTitle>{selected ? `Edit ${editableVersion(selected).title}` : "Create resource"}</CardTitle>
                <CardDescription>Content is stored as Markdown and sanitized wherever it renders.</CardDescription>
                {selected ? (
                  <CardAction className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>
                    {selected.pendingVersion ? <Badge variant="outline">unpublished changes</Badge> : null}
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field data-invalid={Boolean(firstError(saveState, "title")) || undefined}>
                    <FieldLabel htmlFor="resource-title">Title</FieldLabel>
                    <Input
                      id="resource-title"
                      name="title"
                      value={fields.title}
                      onChange={(changeEvent) => updateField("title", changeEvent.target.value)}
                      aria-invalid={Boolean(firstError(saveState, "title")) || undefined}
                      placeholder="Travel and lodging"
                      required
                    />
                    <FieldError>{firstError(saveState, "title")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(firstError(saveState, "slug")) || undefined}>
                    <FieldLabel htmlFor="resource-slug">URL slug</FieldLabel>
                    <Input
                      id="resource-slug"
                      name="slug"
                      value={fields.slug}
                      onChange={(changeEvent) => updateField("slug", changeEvent.target.value)}
                      aria-invalid={Boolean(firstError(saveState, "slug")) || undefined}
                      placeholder="travel-and-lodging"
                      required
                    />
                    <FieldDescription>Lowercase letters, numbers, and hyphens.</FieldDescription>
                    <FieldError>{firstError(saveState, "slug")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(firstError(saveState, "summary")) || undefined}>
                    <FieldLabel htmlFor="resource-summary">Summary</FieldLabel>
                    <Textarea
                      id="resource-summary"
                      name="summary"
                      value={fields.summary}
                      onChange={(changeEvent) => updateField("summary", changeEvent.target.value)}
                      aria-invalid={Boolean(firstError(saveState, "summary")) || undefined}
                      placeholder="Optional introduction shown above the page."
                      className="min-h-20"
                    />
                    <FieldError>{firstError(saveState, "summary")}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(firstError(saveState, "bodyMarkdown")) || undefined}>
                    <FieldLabel htmlFor="resource-body">Content</FieldLabel>
                    <Textarea
                      id="resource-body"
                      name="bodyMarkdown"
                      value={fields.bodyMarkdown}
                      onChange={(changeEvent) => updateField("bodyMarkdown", changeEvent.target.value)}
                      aria-invalid={Boolean(firstError(saveState, "bodyMarkdown")) || undefined}
                      placeholder={"## Before you travel\n\nBook your hotel by **September 1**."}
                      className="min-h-72 font-mono text-sm"
                      required
                    />
                    <FieldDescription>Markdown and allowlisted embeds are supported.</FieldDescription>
                    <FieldError>{firstError(saveState, "bodyMarkdown")}</FieldError>
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="flex-wrap justify-between gap-3">
                <p aria-live="polite" className="text-muted-foreground text-sm">
                  {feedback}
                </p>
                <Button type="submit" disabled={savePending}>
                  {savePending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  {selected ? "Save changes" : "Create draft"}
                </Button>
              </CardFooter>
            </Card>
          </form>

          <Card>
            <CardHeader>
              <CardTitle>Safe preview</CardTitle>
              <CardDescription>This is the same sanitized renderer used by the published page.</CardDescription>
              {selected && selected.status === "published" ? (
                <CardAction>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`/events/${event.slug}/resources/${selected.version.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink data-icon="inline-end" />
                      View published
                    </a>
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent className="min-h-72">
              {fields.bodyMarkdown ? (
                <SanitizedMarkdown content={fields.bodyMarkdown} />
              ) : (
                <Empty className="min-h-64 border border-dashed">
                  <EmptyHeader>
                    <EmptyTitle>Preview is empty</EmptyTitle>
                    <EmptyDescription>Add Markdown content to preview the resource.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
            {selected ? (
              <CardFooter className="flex-wrap items-center gap-2">
                {selected.status === "published" && (
                  <Button type="button" variant="outline" disabled={mutationPending} onClick={unpublish}>
                    Unpublish
                  </Button>
                )}
                {publishable && (
                  <Button type="button" disabled={mutationPending} onClick={publish}>
                    {selected.status === "published" ? "Publish update" : "Publish"}
                  </Button>
                )}
                {selected.status !== "published" && !publishable && (
                  <p className="text-muted-foreground text-sm">Save changes to create a new draft before publishing.</p>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" disabled={mutationPending}>
                      <Archive data-icon="inline-start" />
                      Archive
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Archive this resource?</AlertDialogTitle>
                      <AlertDialogDescription>
                        It will disappear from the speaker resource list and any published URL will stop working.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={archive}>Archive resource</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardFooter>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
