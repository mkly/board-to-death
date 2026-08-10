"use client";

import { useActionState, useState } from "react";

import Link from "next/link";

import {
  BookmarkPlus,
  FilterX,
  GitMerge,
  Pencil,
  Save,
  Search,
  TriangleAlert,
  UserPlus,
  UsersRound,
} from "lucide-react";

import type { DashboardEvent } from "@/app/(main)/dashboard/_lib/dashboard-shell";
import {
  type CustomFieldInputDefinition,
  CustomFieldInputs,
  type CustomFieldInputValue,
} from "@/components/custom-fields/custom-field-inputs";
import { FormSelect } from "@/components/form-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DirectorySegmentRecord } from "@/server/contacts/directory-segments";
import type {
  DirectoryDuplicateMatch,
  DirectoryDuplicatePerson,
  DirectoryPeopleFilters,
  DirectoryPersonSummary,
} from "@/server/contacts/repositories";

import {
  type ContactRecordMutationState,
  linkDirectoryPersonAction,
  mergeDirectoryPeopleAction,
  saveContactRecord,
  saveDirectorySegmentAction,
} from "../actions";

interface ContactRecord {
  readonly id: string;
  readonly personId: string | null;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organization: string | null;
  readonly jobTitle: string | null;
  readonly phone: string | null;
  readonly customFieldValues: readonly CustomFieldInputValue[];
}

interface ContactsWorkspaceProps {
  readonly contacts: readonly ContactRecord[];
  readonly customFieldDefinitions: readonly CustomFieldInputDefinition[];
  readonly duplicateMatches: readonly DirectoryDuplicateMatch[];
  readonly error?: string;
  readonly event: DashboardEvent;
  readonly events: readonly { readonly id: string; readonly name: string }[];
  readonly filters: DirectoryPeopleFilters;
  readonly notice?: string;
  readonly people: readonly DirectoryPersonSummary[];
  readonly segments: readonly DirectorySegmentRecord[];
  readonly selectedSegmentId?: string;
}

const INITIAL_STATE: ContactRecordMutationState = { status: "idle" };

function personPath(eventSlug: string, personId: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/contacts/${personId}`;
}

function fieldError(state: ContactRecordMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function personName(person: Pick<DirectoryDuplicatePerson, "givenName" | "familyName">): string {
  return `${person.givenName} ${person.familyName}`;
}

function DuplicatePersonCard({ person }: { readonly person: DirectoryDuplicatePerson }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{personName(person)}</CardTitle>
        <CardDescription>{person.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">Organization</dt>
            <dd>{person.organization ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Job title</dt>
            <dd>{person.jobTitle ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Event history</dt>
            <dd>{person.eventCount} linked events</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Pipeline notes</dt>
            <dd>{person.noteCount} saved notes</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function DuplicateMergeCard({
  eventSlug,
  match,
}: {
  readonly eventSlug: string;
  readonly match: DirectoryDuplicateMatch;
}) {
  const [first, second] = match.people;
  const mergeAction = mergeDirectoryPeopleAction.bind(null, eventSlug);
  const reason = match.reasons.map((value) => (value === "email" ? "same email" : "same name")).join(" and ");

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {personName(first)} and {personName(second)}
        </CardTitle>
        <CardDescription>Compare both records and choose which identity should survive.</CardDescription>
        <CardAction>
          <Badge variant="secondary">{reason}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        <DuplicatePersonCard person={first} />
        <DuplicatePersonCard person={second} />
      </CardContent>
      <CardFooter className="justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">
              <GitMerge data-icon="inline-start" />
              Compare and merge
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="sm:max-w-2xl">
            <form action={mergeAction} className="flex flex-col gap-4">
              <input name="firstPersonId" type="hidden" value={first.id} />
              <input name="secondPersonId" type="hidden" value={second.id} />
              <AlertDialogHeader>
                <AlertDialogTitle>Merge these duplicate people?</AlertDialogTitle>
                <AlertDialogDescription>
                  The primary record keeps its identity fields. Event links, pipeline notes, stage history, and session
                  participation from both records are consolidated under it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <FieldSet>
                <FieldLegend variant="label">Choose the primary record</FieldLegend>
                <RadioGroup defaultValue={first.id} name="primaryPersonId">
                  {match.people.map((person) => {
                    const id = `merge-primary-${first.id}-${person.id}`;
                    return (
                      <FieldLabel htmlFor={id} key={person.id}>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>{personName(person)}</FieldTitle>
                            <FieldDescription>
                              {person.email} · {person.eventCount} events · {person.noteCount} notes
                            </FieldDescription>
                          </FieldContent>
                          <RadioGroupItem id={id} value={person.id} />
                        </Field>
                      </FieldLabel>
                    );
                  })}
                </RadioGroup>
              </FieldSet>
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>This merge cannot be undone</AlertTitle>
                <AlertDescription>
                  The non-primary directory record will be removed after its history moves.
                </AlertDescription>
              </Alert>
              <AlertDialogFooter>
                <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
                <AlertDialogAction type="submit" variant="destructive">
                  <GitMerge data-icon="inline-start" />
                  Merge records
                </AlertDialogAction>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}

function valueLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  if (value && typeof value === "object" && "fileName" in value && typeof value.fileName === "string") {
    return value.fileName;
  }
  return "Not set";
}

function SavedCustomFields({
  definitions,
  values,
}: {
  readonly definitions: readonly CustomFieldInputDefinition[];
  readonly values: readonly CustomFieldInputValue[];
}) {
  if (definitions.length === 0) return null;
  return (
    <section aria-labelledby="contact-saved-custom-fields" className="flex flex-col gap-3">
      <h3 id="contact-saved-custom-fields" className="font-medium">
        Saved custom fields
      </h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        {definitions.map((definition) => (
          <div key={definition.id} className="flex flex-col gap-1 rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">{definition.label}</dt>
            <dd>{valueLabel(values.find(({ definitionId }) => definitionId === definition.id)?.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ContactEditor({
  contact,
  definitions,
  eventSlug,
}: {
  readonly contact: ContactRecord;
  readonly definitions: readonly CustomFieldInputDefinition[];
  readonly eventSlug: string;
}) {
  const [state, action, pending] = useActionState(saveContactRecord, INITIAL_STATE);

  return (
    <form action={action}>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="contactId" value={contact.id} />
      <Card>
        <CardHeader>
          <CardTitle>
            Edit {contact.givenName} {contact.familyName}
          </CardTitle>
          <CardDescription>Update this event snapshot without changing the organization directory.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(fieldError(state, "givenName")) || undefined}>
                <FieldLabel htmlFor="contact-given-name">First name</FieldLabel>
                <Input
                  aria-invalid={Boolean(fieldError(state, "givenName")) || undefined}
                  defaultValue={contact.givenName}
                  id="contact-given-name"
                  name="givenName"
                  required
                />
                <FieldError>{fieldError(state, "givenName")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(fieldError(state, "familyName")) || undefined}>
                <FieldLabel htmlFor="contact-family-name">Last name</FieldLabel>
                <Input
                  aria-invalid={Boolean(fieldError(state, "familyName")) || undefined}
                  defaultValue={contact.familyName}
                  id="contact-family-name"
                  name="familyName"
                  required
                />
                <FieldError>{fieldError(state, "familyName")}</FieldError>
              </Field>
            </div>
            <Field data-invalid={Boolean(fieldError(state, "email")) || undefined}>
              <FieldLabel htmlFor="contact-email">Email</FieldLabel>
              <Input
                aria-invalid={Boolean(fieldError(state, "email")) || undefined}
                defaultValue={contact.email}
                id="contact-email"
                name="email"
                required
                type="email"
              />
              <FieldError>{fieldError(state, "email")}</FieldError>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="contact-organization">Organization</FieldLabel>
                <Input defaultValue={contact.organization ?? ""} id="contact-organization" name="organization" />
              </Field>
              <Field>
                <FieldLabel htmlFor="contact-job-title">Job title</FieldLabel>
                <Input defaultValue={contact.jobTitle ?? ""} id="contact-job-title" name="jobTitle" />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="contact-phone">Phone</FieldLabel>
              <Input defaultValue={contact.phone ?? ""} id="contact-phone" name="phone" type="tel" />
            </Field>
            <CustomFieldInputs
              definitions={definitions}
              values={contact.customFieldValues}
              fileDownloadBasePath={`/dashboard/events/${encodeURIComponent(eventSlug)}/custom-fields/files`}
            />
            <SavedCustomFields definitions={definitions} values={contact.customFieldValues} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {state.message}
          </p>
          <Button disabled={pending} type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {pending ? "Saving..." : "Save contact"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function SaveSegmentDialog({
  eventSlug,
  filters,
  disabled,
}: {
  readonly eventSlug: string;
  readonly filters: DirectoryPeopleFilters;
  readonly disabled: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={disabled} type="button" variant="outline">
          <BookmarkPlus data-icon="inline-start" />
          Save segment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={saveDirectorySegmentAction.bind(null, eventSlug)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Save dynamic segment</DialogTitle>
            <DialogDescription>
              Save these criteria as a reusable view. Membership updates whenever the segment is reopened.
            </DialogDescription>
          </DialogHeader>
          <input name="q" type="hidden" value={filters.query ?? ""} />
          <input name="organization" type="hidden" value={filters.organization ?? ""} />
          <input name="jobTitle" type="hidden" value={filters.jobTitle ?? ""} />
          <input name="participatedEventId" type="hidden" value={filters.eventId ?? ""} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="segment-name">Segment name</FieldLabel>
              <Input id="segment-name" maxLength={100} name="name" placeholder="AI Experts" required />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit">
              <BookmarkPlus data-icon="inline-start" />
              Save segment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DirectoryFilters({
  event,
  events,
  filters,
}: {
  readonly event: DashboardEvent;
  readonly events: readonly { readonly id: string; readonly name: string }[];
  readonly filters: DirectoryPeopleFilters;
}) {
  const hasActiveFilters = Object.values(filters).some((value) => Boolean(value?.trim()));
  const activeLabels = [
    filters.query ? `Search: ${filters.query}` : null,
    filters.organization ? `Organization: ${filters.organization}` : null,
    filters.jobTitle ? `Job title: ${filters.jobTitle}` : null,
    filters.eventId ? `Event: ${events.find(({ id }) => id === filters.eventId)?.name ?? "Selected event"}` : null,
  ].filter((label): label is string => label !== null);

  return (
    <div className="flex flex-col gap-4">
      <form method="get">
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="directory-search">Search directory</FieldLabel>
              <Input
                defaultValue={filters.query}
                id="directory-search"
                name="q"
                placeholder="Name, email, or organization"
                type="search"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="directory-organization">Organization</FieldLabel>
              <Input
                defaultValue={filters.organization}
                id="directory-organization"
                name="organization"
                placeholder="Company or organization"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="directory-job-title">Job title</FieldLabel>
              <Input
                defaultValue={filters.jobTitle}
                id="directory-job-title"
                name="jobTitle"
                placeholder="Role or title"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="directory-event">Participated in event</FieldLabel>
              <FormSelect
                className="w-full"
                defaultValue={filters.eventId ?? ""}
                id="directory-event"
                name="participatedEventId"
                options={[
                  { value: "", label: "Any event" },
                  ...events.map(({ id, name }) => ({ value: id, label: name })),
                ]}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">
              <Search data-icon="inline-start" />
              Apply filters
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href={`/dashboard/events/${encodeURIComponent(event.slug)}/contacts`}>
                <FilterX data-icon="inline-start" />
                Clear filters
              </Link>
            </Button>
          </div>
        </FieldGroup>
      </form>
      <section aria-labelledby="active-directory-filters" className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="sr-only" id="active-directory-filters">
          Active directory filters
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {activeLabels.length > 0 ? (
            activeLabels.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">No filters applied.</p>
          )}
        </div>
        <SaveSegmentDialog disabled={!hasActiveFilters} eventSlug={event.slug} filters={filters} />
      </section>
    </div>
  );
}

export function ContactsWorkspace({
  contacts,
  customFieldDefinitions,
  duplicateMatches,
  error,
  event,
  events,
  filters,
  notice,
  people,
  segments,
  selectedSegmentId,
}: ContactsWorkspaceProps) {
  const [selectedContactId, setSelectedContactId] = useState<string | null>(contacts[0]?.id ?? null);
  const selectedContact = contacts.find(({ id }) => id === selectedContactId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-semibold text-2xl tracking-tight">Contacts</h1>
        <p className="text-muted-foreground text-sm">
          Reuse organization contacts across events while keeping each event&apos;s details independent.
        </p>
      </header>

      {notice ? (
        <Alert>
          <AlertTitle>Directory updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to link contact</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {duplicateMatches.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Possible duplicates</CardTitle>
            <CardDescription>
              People with the same full name or email may represent one person. Review the comparison before merging.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">{duplicateMatches.length} found</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {duplicateMatches.map((match) => (
              <DuplicateMergeCard
                eventSlug={event.slug}
                key={match.people.map(({ id }) => id).join("-")}
                match={match}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Organization directory</CardTitle>
          <CardDescription>
            Combine search, profile, and event-history criteria, then save the result as a reusable segment.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">
              {people.length} {people.length === 1 ? "person" : "people"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <section aria-labelledby="saved-segments-heading" className="flex flex-col gap-2">
            <h3 className="font-medium" id="saved-segments-heading">
              Saved segments
            </h3>
            <div className="flex flex-wrap gap-2">
              {segments.length === 0 ? (
                <p className="text-muted-foreground text-sm">Save a filtered view to create your first segment.</p>
              ) : (
                segments.map((segment) => (
                  <Button
                    asChild
                    key={segment.id}
                    size="sm"
                    variant={selectedSegmentId === segment.id ? "secondary" : "outline"}
                  >
                    <Link
                      href={`/dashboard/events/${encodeURIComponent(event.slug)}/contacts?segment=${encodeURIComponent(segment.id)}`}
                    >
                      {segment.name}
                    </Link>
                  </Button>
                ))
              )}
            </div>
          </section>

          <DirectoryFilters event={event} events={events} filters={filters} />

          {people.length === 0 ? (
            <Empty className="min-h-40 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>No directory contacts found</EmptyTitle>
                <EmptyDescription>Clear one or more criteria to broaden this directory view.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => {
                  const linked = person.linkedEventIds.includes(event.id);
                  return (
                    <TableRow key={person.id}>
                      <TableCell>
                        <Link className="font-medium hover:underline" href={personPath(event.slug, person.id)}>
                          {person.givenName} {person.familyName}
                        </Link>
                        <p className="text-muted-foreground">{person.email}</p>
                      </TableCell>
                      <TableCell>{person.organization ?? "—"}</TableCell>
                      <TableCell>{person.linkedEventIds.length}</TableCell>
                      <TableCell className="text-right">
                        {linked ? (
                          <Badge variant="secondary">In this event</Badge>
                        ) : (
                          <form action={linkDirectoryPersonAction.bind(null, event.slug, person.id)}>
                            <Button size="sm" type="submit">
                              <UserPlus data-icon="inline-start" />
                              Add to event
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event contacts</CardTitle>
          <CardDescription>
            These snapshots can be edited without changing organization directory fields.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <Empty className="min-h-40 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>No contacts in this event</EmptyTitle>
                <EmptyDescription>Add someone from the organization directory to get started.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Job title</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id} data-state={contact.id === selectedContactId ? "selected" : undefined}>
                    <TableCell>
                      {contact.personId ? (
                        <Link className="font-medium hover:underline" href={personPath(event.slug, contact.personId)}>
                          {contact.givenName} {contact.familyName}
                        </Link>
                      ) : (
                        <span className="font-medium">
                          {contact.givenName} {contact.familyName}
                        </span>
                      )}
                      <p className="text-muted-foreground">{contact.email}</p>
                    </TableCell>
                    <TableCell>{contact.organization ?? "—"}</TableCell>
                    <TableCell>{contact.jobTitle ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={contact.personId ? "outline" : "secondary"}>
                        {contact.personId ? "Directory" : "Event only"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => setSelectedContactId(contact.id)}
                      >
                        <Pencil data-icon="inline-start" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedContact ? (
        <ContactEditor
          key={selectedContact.id}
          contact={selectedContact}
          definitions={customFieldDefinitions}
          eventSlug={event.slug}
        />
      ) : null}
    </div>
  );
}
