"use client";

import { useActionState, useState } from "react";

import { DownloadIcon, Trash2Icon, UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";

export interface SpeakerFileActionResult {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

const INITIAL_STATE: SpeakerFileActionResult = { status: "idle" };

export function SpeakerFileControl({
  id,
  label,
  description,
  accept,
  hasFile,
  downloadHref,
  uploadAction,
  removeAction,
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly accept: string;
  readonly hasFile: boolean;
  readonly downloadHref: string;
  readonly uploadAction: (state: SpeakerFileActionResult, formData: FormData) => Promise<SpeakerFileActionResult>;
  readonly removeAction: (state: SpeakerFileActionResult, formData: FormData) => Promise<SpeakerFileActionResult>;
}) {
  const [uploadState, uploadFormAction, uploadPending] = useActionState(uploadAction, INITIAL_STATE);
  const [removeState, removeFormAction, removePending] = useActionState(removeAction, INITIAL_STATE);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  useActionToast(uploadState);
  useActionToast(removeState);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{label}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {hasFile ? (
          <Button asChild variant="outline" size="sm">
            <a href={downloadHref}>
              <DownloadIcon data-icon="inline-start" aria-hidden="true" />
              Download
            </a>
          </Button>
        ) : null}
      </div>

      <form action={uploadFormAction} className="flex flex-wrap items-end gap-2">
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor={id} className="sr-only">
            {label}
          </FieldLabel>
          <Input
            id={id}
            name="file"
            type="file"
            accept={accept}
            onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name ?? null)}
          />
        </Field>
        <Button type="submit" variant="outline" size="sm" disabled={uploadPending || !selectedFileName}>
          {uploadPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {hasFile ? "Replace" : "Upload"}
        </Button>
        {hasFile ? (
          <Button type="submit" variant="ghost" size="sm" formAction={removeFormAction} disabled={removePending}>
            {removePending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Trash2Icon data-icon="inline-start" aria-hidden="true" />
            )}
            Remove
          </Button>
        ) : null}
      </form>
    </div>
  );
}
