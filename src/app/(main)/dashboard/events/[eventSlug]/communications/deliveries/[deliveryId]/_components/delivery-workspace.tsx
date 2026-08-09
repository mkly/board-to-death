import Link from "next/link";

import { Ban, CheckCircle2, Clock3, MailWarning } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BulkDelivery } from "@/server/communications";

import { CancelDeliveryButton } from "./cancel-delivery-button";

interface DeliveryWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly delivery: BulkDelivery;
}

function StatusBadge({ status }: { readonly status: BulkDelivery["recipients"][number]["status"] }) {
  if (status === "delivered") {
    return (
      <Badge>
        <CheckCircle2 /> Delivered
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <MailWarning /> Failed
      </Badge>
    );
  }
  if (status === "retry-scheduled") {
    return (
      <Badge variant="secondary">
        <Clock3 /> Retry scheduled
      </Badge>
    );
  }
  return <Badge variant="outline">Queued</Badge>;
}

export function DeliveryWorkspace({ event, delivery }: DeliveryWorkspaceProps) {
  const completed = delivery.recipients.filter(({ status }) => status === "delivered").length;
  const failed = delivery.recipients.filter(({ status }) => status === "failed").length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Bulk delivery</h1>
          <p className="text-muted-foreground text-sm">
            {delivery.templateName} · version {delivery.templateVersion}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/events/${encodeURIComponent(event.slug)}/communications/audience`}>
            Back to audience
          </Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{delivery.recipients.length.toString()} snapshotted recipients</CardTitle>
          <CardDescription>
            {completed.toString()} delivered · {failed.toString()} terminal failures · created{" "}
            {delivery.createdAt.toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Subject snapshot</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {delivery.recipients.map((recipient) => (
                <TableRow key={recipient.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{recipient.displayName ?? "Unknown speaker"}</span>
                      <span className="text-muted-foreground text-xs">{recipient.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>{recipient.subjectSnapshot}</TableCell>
                  <TableCell>
                    <StatusBadge status={recipient.status} />
                  </TableCell>
                  <TableCell>{recipient.attempts.length.toString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter>
          {delivery.cancelledAt ? (
            <Badge variant="secondary">
              <Ban /> Cancelled {delivery.cancelledAt.toLocaleString()}
            </Badge>
          ) : (
            <CancelDeliveryButton eventSlug={event.slug} deliveryId={delivery.id} />
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
