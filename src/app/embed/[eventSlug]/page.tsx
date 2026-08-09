import { CalendarDays, Filter, LayoutList, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EMBED_FILTER_LABELS,
  EMBED_KIND_LABELS,
  type EmbedKind,
  parseEmbedSearchParams,
} from "@/lib/published-embeds/configuration";
import { cn } from "@/lib/utils";

import { EmbedFrameBridge } from "../_components/embed-frame-bridge";

const KIND_ICONS = {
  agenda: CalendarDays,
  "session-list": LayoutList,
  itinerary: CalendarDays,
  "speaker-list": Users,
  "speaker-gallery": Users,
} satisfies Record<EmbedKind, typeof CalendarDays>;

function toUrlSearchParams(values: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

export default async function PublishedEmbedPreview({
  params,
  searchParams,
}: {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ eventSlug }, rawSearchParams] = await Promise.all([params, searchParams]);
  const configuration = parseEmbedSearchParams(toUrlSearchParams(rawSearchParams));
  const instanceValue = rawSearchParams.instance;
  const instance =
    typeof instanceValue === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(instanceValue) ? instanceValue : "preview";
  const Icon = KIND_ICONS[configuration.kind];

  return (
    <main
      className={cn(
        "min-h-64 bg-background p-4 text-foreground",
        configuration.density === "compact" ? "sm:p-4" : "sm:p-6",
        configuration.theme === "dark" && "dark",
        configuration.theme === "light" && "light",
      )}
      data-embed-configuration={JSON.stringify(configuration)}
    >
      <EmbedFrameBridge instance={instance} />
      <Card size={configuration.density === "compact" ? "sm" : "default"}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Icon aria-hidden="true" />
            <CardTitle>
              <h1>{EMBED_KIND_LABELS[configuration.kind]}</h1>
            </CardTitle>
          </div>
          <CardDescription>Published program preview for {eventSlug}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {configuration.filters.length > 0 ? (
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Enabled filters</legend>
              <Filter aria-hidden="true" />
              {configuration.filters.map((filter) => (
                <Badge key={filter} variant="outline">
                  {EMBED_FILTER_LABELS[filter]}
                </Badge>
              ))}
            </fieldset>
          ) : null}
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium">Your published content will appear here</p>
            <p className="text-muted-foreground text-sm">
              This preview uses the exact configuration URL from the install snippet. Publish the program to populate
              the selected widget.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
