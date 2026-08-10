import { Download, Files } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EventFileLibraryEntry } from "@/server/files/request-files";

import { formatBytes } from "./file-request-options";

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function EventFilesLibrary({
  event,
  files,
}: {
  readonly event: { readonly name: string; readonly slug: string };
  readonly files: readonly EventFileLibraryEntry[];
}) {
  const baseHref = `/dashboard/events/${encodeURIComponent(event.slug)}/file-requests`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event files library</CardTitle>
        <CardDescription>
          {files.length === 0
            ? "No files have been uploaded for this event."
            : `${files.length} collected file${files.length === 1 ? "" : "s"}, with prior versions available from each request.`}
        </CardDescription>
      </CardHeader>
      <CardContent className={files.length === 0 ? undefined : "px-0"}>
        {files.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Files />
              </EmptyMedia>
              <EmptyTitle>No event files yet</EmptyTitle>
              <EmptyDescription>Uploaded responses will appear here with their version count.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableCaption className="sr-only">Collected files for {event.name}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="hidden sm:table-cell">Uploaded by</TableHead>
                <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                <TableHead className="hidden lg:table-cell">Size</TableHead>
                <TableHead>Versions</TableHead>
                <TableHead className="text-right">Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((entry) => (
                <TableRow key={entry.file.assignmentId}>
                  <TableCell>
                    <div className="flex max-w-72 flex-col gap-0.5">
                      <span className="truncate font-medium">{entry.file.fileName}</span>
                      <span className="truncate text-muted-foreground text-xs">
                        {entry.requestTitle} · {entry.targetLabel}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{entry.uploaderLabel}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(entry.file.uploadedAt)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatBytes(entry.file.size)}</TableCell>
                  <TableCell>
                    <Badge variant={entry.versionCount > 1 ? "secondary" : "outline"}>{entry.versionCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <a href={`${baseHref}/files/${entry.file.assignmentId}/${entry.file.id}`}>
                        <Download data-icon="inline-start" />
                        Latest
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
