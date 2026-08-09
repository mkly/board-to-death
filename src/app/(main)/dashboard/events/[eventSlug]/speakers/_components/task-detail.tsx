import Link from "next/link";

import { ArrowLeft, ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PersistedSpeakerTaskDefinition } from "@/server/speakers";

interface TaskDetailProps {
  readonly event: { readonly name: string; readonly slug: string; readonly timezone: string };
  readonly definition: PersistedSpeakerTaskDefinition;
  readonly assignments: readonly {
    readonly id: string;
    readonly status: string;
    readonly dueAt: Date | null;
    readonly speaker: {
      readonly id: string;
      readonly profileVersions: readonly {
        readonly givenName: string;
        readonly familyName: string;
        readonly preferredName: string | null;
      }[];
    };
  }[];
}

export function TaskDetail({ event, definition, assignments }: TaskDetailProps) {
  const version = definition.versions.at(-1);
  if (!version) return null;
  const matrixHref = `/dashboard/events/${encodeURIComponent(event.slug)}/speakers?task=${definition.id}`;
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
          <h1 className="font-semibold text-2xl tracking-tight">{version.title}</h1>
          <p className="text-muted-foreground text-sm">{version.description ?? "No task instructions."}</p>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
            <CardDescription>Version {version.versionNumber}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="outline">Order {version.sortOrder + 1}</Badge>
            <Badge variant="outline">
              {version.defaultDueOffsetDays === null ? "No default deadline" : `${version.defaultDueOffsetDays} days`}
            </Badge>
            <Badge variant="outline">{version.responseRequired ? "Response required" : "No response required"}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assignment history</CardTitle>
            <CardDescription>Current and withdrawn records</CardDescription>
          </CardHeader>
          <CardContent className="font-semibold text-2xl tabular-nums">{assignments.length}</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Speakers</CardTitle>
          <CardDescription>Due dates use {event.timezone}.</CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardList />
                </EmptyMedia>
                <EmptyTitle>No assignments</EmptyTitle>
                <EmptyDescription>This task has not been assigned yet.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Speaker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment) => {
                  const profile = assignment.speaker.profileVersions[0];
                  const name = profile
                    ? `${profile.preferredName ?? profile.givenName} ${profile.familyName}`
                    : "Unknown speaker";
                  return (
                    <TableRow key={assignment.id}>
                      <TableCell>
                        <Link
                          className="font-medium underline-offset-4 hover:underline"
                          href={`/dashboard/events/${encodeURIComponent(event.slug)}/speakers/${assignment.speaker.id}`}
                        >
                          {name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{assignment.status.replaceAll("_", " ")}</Badge>
                      </TableCell>
                      <TableCell>{assignment.dueAt ? dateFormatter.format(assignment.dueAt) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
