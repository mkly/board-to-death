import Link from "next/link";

import { Search, UserPlus, UsersRound } from "lucide-react";

import type { DashboardEvent } from "@/app/(main)/dashboard/_lib/dashboard-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Contact } from "@/generated/prisma/client";
import type { DirectoryPersonSummary } from "@/server/contacts/repositories";

import { linkDirectoryPersonAction } from "../actions";

interface ContactsWorkspaceProps {
  readonly contacts: readonly Contact[];
  readonly error?: string;
  readonly event: DashboardEvent;
  readonly notice?: string;
  readonly people: readonly DirectoryPersonSummary[];
  readonly query: string;
}

function personPath(eventSlug: string, personId: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/contacts/${personId}`;
}

export function ContactsWorkspace({ contacts, error, event, notice, people, query }: ContactsWorkspaceProps) {
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
