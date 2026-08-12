"use client";

import { useActionState } from "react";

import { FileUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/hooks/use-action-toast";

import { type FileRequestUploadState, uploadFileRequest } from "../actions";

const INITIAL_STATE: FileRequestUploadState = { status: "idle" };

export function FulfillmentForm({
  token,
  acceptedTypes,
}: {
  readonly token: string;
  readonly acceptedTypes: string[];
}) {
  const [state, action, pending] = useActionState(uploadFileRequest.bind(null, token), INITIAL_STATE);
  useActionToast(state);

  return (
    <form noValidate action={action}>
      <FieldGroup>
        <Field data-disabled={pending || undefined}>
          <FieldLabel htmlFor="fulfillment-file">File</FieldLabel>
          <Input
            accept={acceptedTypes.join(",")}
            disabled={pending}
            id="fulfillment-file"
            name="file"
            required
            type="file"
          />
          <FieldDescription>Your link remains usable if the file is rejected by the upload policy.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Button disabled={pending} type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : <FileUp data-icon="inline-start" />}
            {pending ? "Uploading…" : "Upload file"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
