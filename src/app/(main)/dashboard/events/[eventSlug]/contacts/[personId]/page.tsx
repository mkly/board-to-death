import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDirectoryPersonProfile } from "@/server/contacts/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../_lib/dashboard-shell";

export default async function ContactProfilePage({
  params,
}: {
  readonly params: Promise<{ eventSlug: string; personId: string }>;
}) {
  const [{ eventSlug, personId }, shell] = await Promise.all([params, getDashboardShellData()]);
  const activeEvent = findAuthorizedEvent(shell.events, eventSlug);
  if (!activeEvent) notFound();
  if (shell.activeEvent?.id !== activeEvent.id) {
    redirect(
      shell.activeEvent ? `/dashboard/events/${encodeURIComponent(shell.activeEvent.slug)}/contacts` : "/dashboard",
    );
  }

  const profile = await getDirectoryPersonProfile(getDatabaseClient(), personId);
  if (!profile) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/dashboard/events/${encodeURIComponent(activeEvent.slug)}/contacts`}>
            <ArrowLeft data-icon="inline-start" />
            Contacts
          </Link>
        </Button>
      </div>
      <header>
        <p className="text-muted-foreground text-sm">Organization directory</p>
        <h1 className="font-semibold text-2xl tracking-tight">
          {profile.person.givenName} {profile.person.familyName}
        </h1>
        <p className="text-muted-foreground text-sm">{profile.person.email}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Directory details</CardTitle>
          <CardDescription>Shared reference values; event snapshots remain independently editable.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-sm">Organization</dt>
              <dd className="font-medium">{profile.person.organization ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Job title</dt>
              <dd className="font-medium">{profile.person.jobTitle ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Phone</dt>
              <dd className="font-medium">{profile.person.phone ?? "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event history</CardTitle>
          <CardDescription>Every event this person is linked to, ordered by event date.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Event snapshot</TableHead>
                <TableHead>Relationship</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.events.map(({ contact, event, relationship }) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">{event.name}</TableCell>
                  <TableCell>
                    {contact.givenName} {contact.familyName}
                    <p className="text-muted-foreground">{contact.organization ?? contact.email}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={relationship === "new" ? "secondary" : "outline"}>
                      {relationship === "new" ? "New" : "Returning"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
