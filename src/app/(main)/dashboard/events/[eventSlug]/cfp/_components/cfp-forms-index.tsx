import Link from "next/link";

import { CircleIcon, ClipboardList, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CfpFormSummary } from "@/server/cfp/repositories";

import { CfpFormActions } from "./cfp-form-actions";
import { CreateFormButton } from "./create-form-button";

function statusLabel(status: CfpFormSummary["status"]): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatDeadline(deadline: Date | null, timezone: string): string {
  if (!deadline) return "Not set";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: timezone }).format(deadline);
}

function formSetupHref(eventSlug: string, formId: string): string {
  return `/dashboard/events/${encodeURIComponent(eventSlug)}/cfp/forms/${formId}/setup`;
}

export function CfpFormsIndex({
  event,
  forms,
}: {
  readonly event: { readonly name: string; readonly slug: string; readonly timezone: string };
  readonly forms: readonly CfpFormSummary[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-muted-foreground text-sm">{event.name}</p>
          <h1 className="font-heading font-semibold text-3xl leading-tight tracking-tight sm:text-4xl sm:leading-none">
            CFP forms
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            Create and manage the forms prospective speakers use to submit sessions.
          </p>
        </div>
        <CreateFormButton eventSlug={event.slug} />
      </header>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Forms</CardTitle>
          <CardDescription>
            {forms.length === 0
              ? "No forms have been created for this event."
              : `${forms.length} event form${forms.length === 1 ? "" : "s"}`}
          </CardDescription>
          <CardAction className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
            <ClipboardList aria-hidden="true" />
          </CardAction>
        </CardHeader>
        <CardContent className={forms.length === 0 ? undefined : "px-0"}>
          {forms.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardList />
                </EmptyMedia>
                <EmptyTitle>Create your first CFP form</EmptyTitle>
                <EmptyDescription>
                  Start with a draft, then configure its welcome message, questions, deadline, and submission rules.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <CreateFormButton eventSlug={event.slug} label="Create first form" />
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableCaption className="sr-only">Call for proposal forms for {event.name}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead>Public state</TableHead>
                  <TableHead className="hidden md:table-cell">Deadline</TableHead>
                  <TableHead className="text-right">Responses</TableHead>
                  <TableHead className="hidden lg:table-cell">Assigned admins</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.map((form) => {
                  const setupHref = formSetupHref(event.slug, form.id);

                  return (
                    <TableRow key={form.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Link className="font-medium underline-offset-4 hover:underline" href={setupHref}>
                            {form.title}
                          </Link>
                          <span className="text-muted-foreground text-xs">Version {form.versionNumber}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">Call for proposals</TableCell>
                      <TableCell>
                        <Badge variant={form.status === "PUBLISHED" ? "default" : "secondary"}>
                          <CircleIcon aria-hidden="true" className="fill-current" data-icon="inline-start" />
                          {statusLabel(form.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {formatDeadline(form.submissionClosesAt, event.timezone)}
                      </TableCell>
                      <TableCell className="text-right font-medium">{form.responseCount}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {form.assignedAdministrators.length === 0 ? (
                          <span className="text-muted-foreground">Unassigned</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <Users aria-hidden="true" className="size-4" />
                            {form.assignedAdministrators.join(", ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <CfpFormActions eventSlug={event.slug} form={form} setupHref={setupHref} />
                      </TableCell>
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
