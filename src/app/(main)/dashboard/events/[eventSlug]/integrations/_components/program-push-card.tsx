"use client";

import { useActionState, useState } from "react";

import { useRouter } from "next/navigation";

import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

import { pushAcceleventsProgram, type SyncRunMutationState } from "../actions";

interface ProgramPushCardProps {
  readonly eventSlug: string;
  readonly connected: boolean;
  readonly publishedVersion: number | null;
}

const INITIAL_STATE: SyncRunMutationState = { status: "idle" };

export function ProgramPushCard({ eventSlug, connected, publishedVersion }: ProgramPushCardProps) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: SyncRunMutationState, data: FormData) => {
    const result = await pushAcceleventsProgram(previous, data);
    if (result.status === "success") router.refresh();
    return result;
  }, INITIAL_STATE);
  const ready = connected && publishedVersion !== null;

  return (
    <section aria-label="Accelevents program push">
      <Card>
        <CardHeader>
          <CardTitle>Push program to Accelevents</CardTitle>
          <CardDescription>
            Sends the published speakers and sessions to the connected Accelevents event in one idempotent run. The
            outcome of every record appears in the sync status history below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ready ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="program-push-confirm"
                checked={confirmed}
                onCheckedChange={(checked) => setConfirmed(checked === true)}
              />
              <Label htmlFor="program-push-confirm">
                I reviewed the session preview and want to push published program v{publishedVersion} now.
              </Label>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {connected
                ? "Publish the program from the agenda workspace before pushing to Accelevents."
                : "Connect Accelevents before pushing the program."}
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {state.message}
          </p>
          <form action={formAction}>
            <input type="hidden" name="eventSlug" value={eventSlug} />
            <input type="hidden" name="confirmed" value={confirmed ? "true" : "false"} />
            <Button type="submit" disabled={pending || !ready || !confirmed}>
              {pending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
              {pending ? "Pushing..." : "Push program"}
            </Button>
          </form>
        </CardFooter>
      </Card>
    </section>
  );
}
