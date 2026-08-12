"use client";

import { useActionState } from "react";

import { MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { SpeakerTaskFileCommentAuthorRole } from "@/generated/prisma/client";
import { useActionToast } from "@/hooks/use-action-toast";

export interface SpeakerTaskFileCommentView {
  readonly id: string;
  readonly authorLabel: string;
  readonly authorRole: SpeakerTaskFileCommentAuthorRole;
  readonly body: string;
  readonly createdAt: Date;
}

export interface SpeakerTaskFileCommentActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

const INITIAL_STATE: SpeakerTaskFileCommentActionState = { status: "idle" };

export function SpeakerTaskFileComments({
  comments,
  formAction,
  inputId,
  timezone,
}: {
  readonly comments: readonly SpeakerTaskFileCommentView[];
  readonly formAction: (
    previousState: SpeakerTaskFileCommentActionState,
    formData: FormData,
  ) => Promise<SpeakerTaskFileCommentActionState>;
  readonly inputId: string;
  readonly timezone: string;
}) {
  const [state, submitAction, pending] = useActionState(formAction, INITIAL_STATE);
  useActionToast(state);
  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });

  return (
    <section aria-label="File comments" className="flex min-w-64 flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <MessageSquare aria-hidden="true" />
        <h3 className="font-medium text-sm">File comments</h3>
        <Badge variant="outline">{comments.length}</Badge>
      </div>
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No comments yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li className="flex flex-col gap-1" key={comment.id}>
              <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                <span className="font-medium">{comment.authorLabel}</span>
                <Badge variant="secondary">{comment.authorRole === "ORGANIZER" ? "Organizer" : "Speaker"}</Badge>
                <time className="text-muted-foreground" dateTime={comment.createdAt.toISOString()}>
                  {formatter.format(comment.createdAt)}
                </time>
              </div>
              <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form action={submitAction}>
        <FieldGroup>
          <Field>
            <FieldLabel className="sr-only" htmlFor={inputId}>
              Add a file comment
            </FieldLabel>
            <Textarea id={inputId} maxLength={2000} name="comment" placeholder="Add a comment…" required rows={2} />
          </Field>
          <Button className="w-fit" disabled={pending} size="sm" type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Adding…" : "Add comment"}
          </Button>
        </FieldGroup>
      </form>
    </section>
  );
}
