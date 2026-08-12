import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Short zone label ("PDT") for the given instant, so attendees reading the
 * embed from another region see a human name instead of an IANA identifier.
 */
export function zoneAbbreviation(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(new Date(value));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

/**
 * Track identity marker. The color comes from the organizer's published
 * program data, so it is applied inline rather than through theme tokens;
 * tracks without a color fall back to the theme primary.
 */
export function TrackDot({ color, className }: { readonly color?: string | null; readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full bg-primary", className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export function TrackChip({ name, color }: { readonly name: string; readonly color?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-muted-foreground text-xs">
      <TrackDot color={color} />
      {name}
    </span>
  );
}

/**
 * Shared widget masthead: an uppercase eyebrow naming the widget, the event
 * name as the page heading, and a muted meta line underneath. Keeping the
 * event as the h1 gives all five embed kinds the same hierarchy.
 */
export function EmbedHeader({
  eyebrow,
  title,
  titleId,
  description,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly titleId?: string;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex items-center gap-2 font-semibold text-[11px] text-primary uppercase tracking-[0.18em]">
          <span aria-hidden="true" className="h-px w-5 bg-primary/60" />
          {eyebrow}
        </p>
        <h1 className="font-heading font-bold text-2xl tracking-tight sm:text-3xl" id={titleId}>
          {title}
        </h1>
        {description ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">{description}</div>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </header>
  );
}
