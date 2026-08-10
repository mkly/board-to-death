import { CalendarClock, FileLock2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDatabaseClient } from "@/server/database/client";
import {
  FileRequestFulfillmentLinkError,
  FileRequestFulfillmentLinkService,
  type FileRequestFulfillmentView,
} from "@/server/files/fulfillment-links";

import { FulfillmentForm } from "./_components/fulfillment-form";

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

function fulfillmentDescription(fulfillment: FileRequestFulfillmentView): string {
  if (!fulfillment.fulfilled) return "A file is requested from you.";
  return fulfillment.replacementPolicy === "REPLACE_LATEST"
    ? "A file was already uploaded; a new upload will replace it."
    : "A file was already uploaded; a new upload will be added to its history.";
}

function InvalidLink() {
  return (
    <Alert variant="destructive">
      <FileLock2 />
      <AlertTitle>This fulfillment link is not available</AlertTitle>
      <AlertDescription>
        It may have expired, already been used, or been withdrawn. Ask the event organizer for a fresh link.
      </AlertDescription>
    </Alert>
  );
}

export default async function FileRequestFulfillmentPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) {
  const { token } = await params;
  let fulfillment: FileRequestFulfillmentView | null;
  try {
    fulfillment = await new FileRequestFulfillmentLinkService({ database: getDatabaseClient() }).resolve(token);
  } catch (error) {
    if (!(error instanceof FileRequestFulfillmentLinkError)) console.error(error);
    fulfillment = null;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-10 sm:px-6">
      <div className="flex w-full flex-col gap-4">
        <header className="flex flex-col gap-2">
          <Badge className="w-fit" variant="secondary">
            Secure file request
          </Badge>
          <h1 className="font-semibold text-2xl tracking-tight">Upload a requested file</h1>
          <p className="text-muted-foreground text-sm">
            Only the request details needed to fulfill this upload are shown.
          </p>
        </header>

        {fulfillment ? (
          <Card>
            <CardHeader>
              <CardTitle>{fulfillment.title}</CardTitle>
              <CardDescription>{fulfillmentDescription(fulfillment)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {fulfillment.instructions ? (
                <p className="whitespace-pre-wrap text-sm">{fulfillment.instructions}</p>
              ) : (
                <p className="text-muted-foreground text-sm">No additional instructions were provided.</p>
              )}
              <div className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Upload policy</span>
                  <span className="text-muted-foreground">
                    {fulfillment.allowedContentTypes.join(", ")} · {formatBytes(fulfillment.maxBytes)} maximum
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CalendarClock aria-hidden="true" />
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">Due date</span>
                    <span className="text-muted-foreground">
                      {fulfillment.dueAt
                        ? fulfillment.dueAt.toLocaleDateString("en-US", { dateStyle: "long" })
                        : "No due date"}
                    </span>
                  </div>
                </div>
              </div>
              <FulfillmentForm acceptedTypes={[...fulfillment.allowedContentTypes]} token={token} />
            </CardContent>
          </Card>
        ) : (
          <InvalidLink />
        )}
      </div>
    </main>
  );
}
