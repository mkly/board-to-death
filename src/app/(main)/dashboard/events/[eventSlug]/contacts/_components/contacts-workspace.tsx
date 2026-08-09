"use client";

import { useActionState, useState } from "react";

import Link from "next/link";

import { Pencil, Save, Search, UserPlus, UsersRound } from "lucide-react";

import type { DashboardEvent } from "@/app/(main)/dashboard/_lib/dashboard-shell";
import {
  type CustomFieldInputDefinition,
  CustomFieldInputs,
  type CustomFieldInputValue,
} from "@/components/custom-fields/custom-field-inputs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DirectoryPersonSummary } from "@/server/contacts/repositories";

import { type ContactRecordMutationState, linkDirectoryPersonAction, saveContactRecord } from "../actions";

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
  readonly error?: string;
  readonly event: DashboardEvent;
  readonly notice?: string;
  readonly people: readonly DirectoryPersonSummary[];
  readonly query: string;
}

const INITIAL_STATE: ContactRecordMutationState = { status: "idle" };

function personPath(eventSlug: string, personId: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/contacts/${personId}`;
}

function fieldError(state: ContactRecordMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
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
            <CustomFieldInputs definitions={definitions} values={contact.customFieldValues} />
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

export function ContactsWorkspace({
  contacts,
  customFieldDefinitions,
  error,
  event,
  notice,
  people,
  query,
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
          <AlertTitle>Contact linked</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to link contact</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Organization directory</CardTitle>
          <CardDescription>
            Search by name, email, or organization, then add an existing person to this event.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="get">
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="directory-search">Search directory</FieldLabel>
                <Input
                  defaultValue={query}
                  id="directory-search"
                  name="q"
                  placeholder="Name, email, or organization"
                  type="search"
                />
                <Button type="submit" variant="outline">
                  <Search data-icon="inline-start" />
                  Search
                </Button>
              </Field>
            </FieldGroup>
          </form>

          {people.length === 0 ? (
            <Empty className="min-h-40 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>No directory contacts found</EmptyTitle>
                <EmptyDescription>Try a different name, email address, or organization.</EmptyDescription>
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
