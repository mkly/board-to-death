import Link from "next/link";

import { ArrowLeft, ClipboardCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PersistedSpeaker } from "@/server/speakers";

interface SpeakerDetailProps {
  readonly event: { readonly name: string; readonly slug: string; readonly timezone: string };
  readonly speaker: PersistedSpeaker;
  readonly assignments: readonly {
    readonly id: string;
    readonly status: string;
    readonly dueAt: Date | null;
    readonly definitionVersion: { readonly title: string };
  }[];
}

export function SpeakerDetail({ event, speaker, assignments }: SpeakerDetailProps) {
  const profile = speaker.profile;
  const name = `${profile.preferredName ?? profile.givenName} ${profile.familyName}`;
  const matrixHref = `/dashboard/events/${encodeURIComponent(event.slug)}/speakers?speaker=${speaker.id}`;
  const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: event.timezone });
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="w-fit">
          <Link href={matrixHref}>
            <ArrowLeft data-icon="inline-start" />
            Back to task matrix
          </Link>
        </Button>
        <div>
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-semibold text-2xl tracking-tight">{name}</h1>
          <p className="text-muted-foreground text-sm">{profile.email}</p>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Speaker profile</CardTitle>
            <CardDescription>Current version {profile.versionNumber}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>{profile.organization ?? "No organization"}</p>
            <p className="text-muted-foreground">{profile.jobTitle ?? "No job title"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Task summary</CardTitle>
            <CardDescription>Authoritative assignments for this event</CardDescription>
          </CardHeader>
          <CardContent className="font-semibold text-2xl tabular-nums">{assignments.length}</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
          <CardDescription>Due dates use {event.timezone}.</CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardCheck />
                </EmptyMedia>
                <EmptyTitle>No assignments</EmptyTitle>
                <EmptyDescription>This speaker has no task assignment history.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell className="font-medium">{assignment.definitionVersion.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{assignment.status.replaceAll("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>{assignment.dueAt ? dateFormatter.format(assignment.dueAt) : "—"}</TableCell>
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
