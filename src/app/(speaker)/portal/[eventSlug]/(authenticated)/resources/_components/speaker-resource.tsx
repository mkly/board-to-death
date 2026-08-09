import Link from "next/link";

import { ArrowLeftIcon, ArrowRightIcon, BookOpenIcon } from "lucide-react";

import { SanitizedMarkdown } from "@/components/content/sanitized-markdown";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { portalHref } from "../../../_lib/portal-session";

type ResourceResult = NonNullable<Awaited<ReturnType<SpeakerPortalRepository["getResource"]>>>;

export function SpeakerResource({
  eventSlug,
  result,
}: {
  readonly eventSlug: string;
  readonly result: ResourceResult;
}) {
  const resourcesHref = portalHref(eventSlug, "/resources");
  const { next, previous, resource } = result;

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={resourcesHref}>Resources</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{resource.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <BookOpenIcon aria-hidden="true" />
            Speaker resource
          </div>
          <CardTitle>{resource.title}</CardTitle>
          {resource.summary ? <CardDescription>{resource.summary}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <article aria-label={resource.title}>
            <SanitizedMarkdown content={resource.bodyMarkdown} allowedEmbedUrls={resource.allowedEmbedUrls} />
          </article>
        </CardContent>
        {previous || next ? (
          <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {previous ? (
              <Button asChild variant="outline" size="sm">
                <Link href={portalHref(eventSlug, `/resources/${encodeURIComponent(previous.slug)}`)}>
                  <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
                  {previous.title}
                </Link>
              </Button>
            ) : null}
            {next ? (
              <Button asChild variant="outline" size="sm" className="sm:ml-auto">
                <Link href={portalHref(eventSlug, `/resources/${encodeURIComponent(next.slug)}`)}>
                  {next.title}
                  <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>
    </>
  );
}
