"use client";

import { useActionState } from "react";

import { useRouter } from "next/navigation";

import { CloudOff, CloudUpload, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";

import { mutateProgramPublication, type ProgramPublicationMutationState } from "../actions";

export interface ProgramPublicationVersion {
  readonly versionNumber: number;
  readonly state: "PUBLISHED" | "UNPUBLISHED";
  readonly createdAtLabel: string;
}

interface ProgramPublicationCardProps {
  readonly eventSlug: string;
  readonly publication: ProgramPublicationVersion | null;
}

const INITIAL_STATE: ProgramPublicationMutationState = { status: "idle" };

export function ProgramPublicationCard({ eventSlug, publication }: ProgramPublicationCardProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (previous: ProgramPublicationMutationState, data: FormData) => {
      const result = await mutateProgramPublication(previous, data);
      if (result.status === "success") router.refresh();
      return result;
    },
    INITIAL_STATE,
  );
  useActionToast(state);
  const published = publication?.state === "PUBLISHED";
  const expectedVersion = publication?.versionNumber ?? 0;
  let statusDescription =
    "This program has never been published. Publish it after the schedule and speaker consent are ready.";
  if (publication) {
    statusDescription = published
      ? `Version ${publication.versionNumber} published ${publication.createdAtLabel}. Republish to snapshot the current agenda, or unpublish to take all public program views offline.`
      : `Version ${publication.versionNumber} unpublished ${publication.createdAtLabel}. Public program views are offline until you publish again.`;
  }

  return (
    <section aria-label="Program publication">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Program publication</CardTitle>
            {publication ? (
              <Badge variant={published ? "default" : "outline"}>
                {published ? `Published v${publication.versionNumber}` : "Unpublished"}
              </Badge>
            ) : (
              <Badge variant="outline">Never published</Badge>
            )}
          </div>
          <CardDescription>
            Publishing creates an immutable snapshot of the public schedule, rooms, tracks, and confirmed speakers that
            feeds embeds, the public API, and Accelevents pushes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{statusDescription}</p>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <div className="flex gap-2">
            {published ? (
              <>
                <form action={formAction}>
                  <input type="hidden" name="eventSlug" value={eventSlug} />
                  <input type="hidden" name="intent" value="unpublish" />
                  <input type="hidden" name="expectedVersion" value={expectedVersion} />
                  <Button type="submit" variant="outline" disabled={pending}>
                    {pending ? <Spinner data-icon="inline-start" /> : <CloudOff data-icon="inline-start" />}
                    Unpublish
                  </Button>
                </form>
                <form action={formAction}>
                  <input type="hidden" name="eventSlug" value={eventSlug} />
                  <input type="hidden" name="intent" value="republish" />
                  <input type="hidden" name="expectedVersion" value={expectedVersion} />
                  <Button type="submit" disabled={pending}>
                    {pending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                    Republish program
                  </Button>
                </form>
              </>
            ) : (
              <form action={formAction}>
                <input type="hidden" name="eventSlug" value={eventSlug} />
                <input type="hidden" name="intent" value={publication ? "republish" : "publish"} />
                <input type="hidden" name="expectedVersion" value={expectedVersion} />
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner data-icon="inline-start" /> : <CloudUpload data-icon="inline-start" />}
                  Publish program
                </Button>
              </form>
            )}
          </div>
        </CardFooter>
      </Card>
    </section>
  );
}
