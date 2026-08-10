"use client";

import { useMemo, useState, useTransition } from "react";

import { History, RotateCcw } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

import { restoreProgramSessionContent } from "../actions";

export interface SessionContentVersion {
  readonly versionNumber: number;
  readonly title: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly restoredFromVersionNumber: number | null;
}

interface SessionContentHistoryProps {
  readonly eventSlug: string;
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly archived: boolean;
  readonly versions: readonly SessionContentVersion[];
}

interface ContentHistoryEntry {
  readonly version: SessionContentVersion;
  readonly changes: readonly string[];
}

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function describeChanges(version: SessionContentVersion, previous?: SessionContentVersion): readonly string[] {
  if (version.restoredFromVersionNumber !== null) {
    return [`Restored title and abstract from version ${version.restoredFromVersionNumber}`];
  }
  if (!previous) return ["Initial title and abstract recorded"];
  const changes: string[] = [];
  if (version.title !== previous.title) changes.push("Title changed");
  if (version.description !== previous.description) {
    if (previous.description === null) changes.push("Abstract added");
    else if (version.description === null) changes.push("Abstract removed");
    else changes.push("Abstract changed");
  }
  return changes;
}

export function SessionContentHistory({
  eventSlug,
  sessionId,
  sessionTitle,
  archived,
  versions,
}: SessionContentHistoryProps) {
  const [message, setMessage] = useState("");
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const current = versions.at(-1);
  const entries = useMemo(
    () =>
      versions
        .map(
          (version, index): ContentHistoryEntry => ({
            version,
            changes: describeChanges(version, versions[index - 1]),
          }),
        )
        .filter(({ changes }) => changes.length > 0)
        .reverse(),
    [versions],
  );

  const restore = (versionNumber: number) => {
    setRestoringVersion(versionNumber);
    startTransition(async () => {
      const result = await restoreProgramSessionContent(eventSlug, sessionId, versionNumber);
      setMessage(result.message ?? "");
      setRestoringVersion(null);
    });
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Title and abstract history</CardTitle>
        <CardDescription>
          Every content edit records who made it and when. Restoring creates a new version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col">
          {entries.map(({ version, changes }, index) => {
            const canRestore =
              !archived &&
              current !== undefined &&
              version.versionNumber !== current.versionNumber &&
              (version.title !== current.title || version.description !== current.description);
            const formattedTimestamp = `${timestampFormatter.format(new Date(version.createdAt))} UTC`;
            return (
              <li key={version.versionNumber} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-medium">
                      Version {version.versionNumber} · {changes.join(" · ")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {version.createdBy ?? "System"} · <time dateTime={version.createdAt}>{formattedTimestamp}</time>
                    </p>
                  </div>
                  {canRestore ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm" disabled={pending}>
                          {pending && restoringVersion === version.versionNumber ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <RotateCcw data-icon="inline-start" />
                          )}
                          Restore
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Restore version {version.versionNumber}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The title and abstract from this version will become the latest content for {sessionTitle}.
                            Current scheduling, participants, duration, and track stay unchanged.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => restore(version.versionNumber)}>
                            Restore as new version
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="truncate text-sm">{version.title}</p>
                  <p className="line-clamp-2 text-muted-foreground text-sm">{version.description ?? "No abstract"}</p>
                </div>
                {index < entries.length - 1 ? <Separator /> : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
      {message ? (
        <CardFooter className="gap-2">
          <History />
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {message}
          </p>
        </CardFooter>
      ) : null}
    </Card>
  );
}
