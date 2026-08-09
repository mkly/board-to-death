import Link from "next/link";

import { ArrowRightIcon, BookOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { SpeakerPortalRepository } from "@/server/speaker-portal/dashboard";

import { portalHref } from "../../../_lib/portal-session";
import { PortalSectionHeading } from "../../_components/portal-content";

type Resources = Awaited<ReturnType<SpeakerPortalRepository["getResources"]>>;

export function SpeakerResources({
  eventSlug,
  resources,
}: {
  readonly eventSlug: string;
  readonly resources: Resources;
}) {
  return (
    <>
      <PortalSectionHeading
        icon={BookOpenIcon}
        title="Speaker resources"
        description="Guides and information published by the event team."
      />
      {resources.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No resources published</EmptyTitle>
            <EmptyDescription>Event guidance and speaker materials will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-3">
          {resources.map((resource, index) => (
            <li key={resource.id}>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>
                    <span className="text-muted-foreground" aria-hidden="true">
                      {index + 1}.{" "}
                    </span>
                    {resource.title}
                  </CardTitle>
                  <CardDescription>{resource.summary ?? "Open this resource for details."}</CardDescription>
                  <CardAction>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={portalHref(eventSlug, `/resources/${encodeURIComponent(resource.slug)}`)}>
                        Open
                        <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                      </Link>
                    </Button>
                  </CardAction>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
