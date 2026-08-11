"use client";

import { useEffect, useId, useMemo, useState } from "react";

import {
  Braces,
  CalendarPlus,
  Check,
  Clipboard,
  Code2,
  ExternalLink,
  Eye,
  FileCode2,
  FileType2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DEFAULT_EMBED_CONFIGURATION,
  EMBED_DENSITIES,
  EMBED_FILTER_LABELS,
  EMBED_FILTERS_BY_KIND,
  EMBED_KIND_LABELS,
  EMBED_KINDS,
  EMBED_THEMES,
  type EmbedConfiguration,
  type EmbedDensity,
  type EmbedFilter,
  type EmbedKind,
  type EmbedTheme,
  embedUrl,
  iframeEmbedSnippet,
  normalizeEmbedConfiguration,
  webComponentEmbedSnippet,
} from "@/lib/published-embeds/configuration";
import {
  PUBLISHED_SCHEDULE_FEED_FORMATS,
  PUBLISHED_SCHEDULE_FEED_LABELS,
  type PublishedScheduleFeedFormat,
  publishedScheduleFeedUrl,
} from "@/lib/published-embeds/feed-formats";

const THEME_LABELS: Readonly<Record<EmbedTheme, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const DENSITY_LABELS: Readonly<Record<EmbedDensity, string>> = {
  comfortable: "Comfortable",
  compact: "Compact",
};

type OutputType = "iframe" | "web-component" | PublishedScheduleFeedFormat;

const OUTPUT_LABELS: Readonly<Record<OutputType, string>> = {
  iframe: "Iframe",
  "web-component": "Web component",
  ...PUBLISHED_SCHEDULE_FEED_LABELS,
};

const FEED_ICONS = {
  html: FileCode2,
  json: Braces,
  xml: FileType2,
  ical: CalendarPlus,
} satisfies Record<PublishedScheduleFeedFormat, typeof FileCode2>;

function parseStoredConfiguration(value: string | null): EmbedConfiguration {
  if (!value) return DEFAULT_EMBED_CONFIGURATION;
  try {
    return normalizeEmbedConfiguration(JSON.parse(value));
  } catch {
    return DEFAULT_EMBED_CONFIGURATION;
  }
}

function outputFor(embedPreviewUrl: string, feedUrl: string, type: OutputType, instance: string): string {
  if (type === "iframe") return embedPreviewUrl ? iframeEmbedSnippet(embedPreviewUrl, instance) : "";
  if (type === "web-component") return embedPreviewUrl ? webComponentEmbedSnippet(embedPreviewUrl, instance) : "";
  return feedUrl;
}

function isFeedOutput(type: OutputType): type is PublishedScheduleFeedFormat {
  return PUBLISHED_SCHEDULE_FEED_FORMATS.includes(type as PublishedScheduleFeedFormat);
}

export function EmbedBuilder({ event }: { readonly event: { readonly name: string; readonly slug: string } }) {
  const reactId = useId();
  const instance = useMemo(() => `preview-${reactId.replaceAll(":", "")}`, [reactId]);
  const storageKey = `gatherpulse:embed-builder:${event.slug}`;
  const [configuration, setConfiguration] = useState<EmbedConfiguration>(DEFAULT_EMBED_CONFIGURATION);
  const [outputType, setOutputType] = useState<OutputType>("iframe");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    setConfiguration(parseStoredConfiguration(window.localStorage.getItem(storageKey)));
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(storageKey, JSON.stringify(configuration));
  }, [configuration, hydrated, storageKey]);

  const previewUrl = hydrated ? embedUrl(origin, event.slug, instance, configuration) : "";
  const selectedFeedUrl =
    hydrated && isFeedOutput(outputType) ? publishedScheduleFeedUrl(origin, event.slug, outputType) : "";
  const output = outputFor(previewUrl, selectedFeedUrl, outputType, instance);
  const feedSelected = isFeedOutput(outputType);
  const availableFilters = EMBED_FILTERS_BY_KIND[configuration.kind];

  const selectKind = (kind: EmbedKind) => {
    setConfiguration((current) => ({
      ...current,
      kind,
      filters: EMBED_FILTERS_BY_KIND[kind],
    }));
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopyFeedback(`${OUTPUT_LABELS[outputType]} ${feedSelected ? "link" : "snippet"} copied.`);
      toast.success(feedSelected ? "Feed link copied" : "Embed snippet copied");
    } catch {
      setCopyFeedback(`Copy failed. Select the ${feedSelected ? "link" : "snippet"} and copy it manually.`);
      toast.error(feedSelected ? "Could not copy the feed link" : "Could not copy the embed snippet");
    }
  };

  const reset = () => {
    setConfiguration(DEFAULT_EMBED_CONFIGURATION);
    setCopyFeedback("Configuration reset.");
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Embed builder</h1>
        <p className="text-muted-foreground text-sm">
          Configure a published-program widget, preview the exact URL, and copy an installation snippet.
        </p>
      </header>

      <Alert>
        <Check />
        <AlertTitle>Safe options only</AlertTitle>
        <AlertDescription>
          Theme, density, and filters are serialized from allowlisted values. Custom origins, styles, and scripts are
          not accepted.
        </AlertDescription>
      </Alert>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Choices are saved in this browser for {event.name}.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <FieldSet>
                <FieldLegend variant="label">Widget</FieldLegend>
                <FieldDescription>Choose the published-program view to install.</FieldDescription>
                <ToggleGroup
                  type="single"
                  value={configuration.kind}
                  onValueChange={(value) => {
                    if (value) selectKind(value as EmbedKind);
                  }}
                  variant="outline"
                  className="flex-wrap justify-start"
                  aria-label="Widget type"
                >
                  {EMBED_KINDS.map((kind) => (
                    <ToggleGroupItem key={kind} value={kind}>
                      {EMBED_KIND_LABELS[kind]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Theme</FieldLegend>
                <ToggleGroup
                  type="single"
                  value={configuration.theme}
                  onValueChange={(value) => {
                    if (value) setConfiguration((current) => ({ ...current, theme: value as EmbedTheme }));
                  }}
                  variant="outline"
                  aria-label="Theme"
                >
                  {EMBED_THEMES.map((theme) => (
                    <ToggleGroupItem key={theme} value={theme}>
                      {THEME_LABELS[theme]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Density</FieldLegend>
                <ToggleGroup
                  type="single"
                  value={configuration.density}
                  onValueChange={(value) => {
                    if (value) setConfiguration((current) => ({ ...current, density: value as EmbedDensity }));
                  }}
                  variant="outline"
                  aria-label="Density"
                >
                  {EMBED_DENSITIES.map((density) => (
                    <ToggleGroupItem key={density} value={density}>
                      {DENSITY_LABELS[density]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Filters</FieldLegend>
                <FieldDescription>Only filters supported by this widget can be included.</FieldDescription>
                <ToggleGroup
                  type="multiple"
                  value={[...configuration.filters]}
                  onValueChange={(values) =>
                    setConfiguration((current) => ({ ...current, filters: values as EmbedFilter[] }))
                  }
                  variant="outline"
                  className="flex-wrap justify-start"
                  aria-label="Enabled filters"
                >
                  {availableFilters.map((filter) => (
                    <ToggleGroupItem key={filter} value={filter}>
                      {EMBED_FILTER_LABELS[filter]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {hydrated ? "Saved automatically" : "Loading saved configuration…"}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              <RotateCcw data-icon="inline-start" />
              Reset
            </Button>
          </CardFooter>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Live preview</CardTitle>
              <CardDescription>The iframe below uses the same serialized URL as the copied snippet.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border bg-background">
                {previewUrl ? (
                  <iframe
                    key={previewUrl}
                    src={previewUrl}
                    title={`${EMBED_KIND_LABELS[configuration.kind]} embed preview`}
                    className="h-96 w-full"
                    sandbox="allow-scripts allow-same-origin"
                  />
                ) : (
                  <Skeleton className="h-96 w-full rounded-none" />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Install and share</CardTitle>
              <CardDescription>Copy an embed snippet or link directly to the published schedule data.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={outputType} onValueChange={(value) => setOutputType(value as OutputType)}>
                <TabsList className="h-auto w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
                  <TabsTrigger value="iframe">
                    <Eye />
                    Iframe
                  </TabsTrigger>
                  <TabsTrigger value="web-component">
                    <Code2 />
                    Web component
                  </TabsTrigger>
                  {PUBLISHED_SCHEDULE_FEED_FORMATS.map((format) => {
                    const Icon = FEED_ICONS[format];
                    return (
                      <TabsTrigger key={format} value={format}>
                        <Icon />
                        {PUBLISHED_SCHEDULE_FEED_LABELS[format]}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                <TabsContent value="iframe">
                  <Field>
                    <FieldTitle>Responsive iframe snippet</FieldTitle>
                    <Textarea
                      aria-label="Iframe snippet"
                      value={output}
                      readOnly
                      rows={12}
                      className="font-mono text-xs"
                    />
                  </Field>
                </TabsContent>
                <TabsContent value="web-component">
                  <Field>
                    <FieldTitle>Web component snippet</FieldTitle>
                    <Textarea
                      aria-label="Web component snippet"
                      value={output}
                      readOnly
                      rows={5}
                      className="font-mono text-xs"
                    />
                  </Field>
                </TabsContent>
                {PUBLISHED_SCHEDULE_FEED_FORMATS.map((format) => (
                  <TabsContent key={format} value={format}>
                    <Field>
                      <FieldTitle>{PUBLISHED_SCHEDULE_FEED_LABELS[format]} feed link</FieldTitle>
                      <FieldDescription>
                        Anonymous, cacheable output from the currently published program snapshot.
                      </FieldDescription>
                      <Textarea
                        aria-label={`${PUBLISHED_SCHEDULE_FEED_LABELS[format]} feed link`}
                        value={output}
                        readOnly
                        rows={3}
                        className="font-mono text-xs"
                      />
                    </Field>
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
            <CardFooter className="justify-between gap-3">
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {copyFeedback}
              </p>
              <div className="flex items-center gap-2">
                {feedSelected && selectedFeedUrl ? (
                  <Button variant="outline" asChild>
                    <a href={selectedFeedUrl} target="_blank" rel="noreferrer">
                      <ExternalLink data-icon="inline-start" />
                      Open feed
                    </a>
                  </Button>
                ) : null}
                <Button type="button" onClick={copyOutput} disabled={!output}>
                  <Clipboard data-icon="inline-start" />
                  Copy {feedSelected ? "link" : "snippet"}
                </Button>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
