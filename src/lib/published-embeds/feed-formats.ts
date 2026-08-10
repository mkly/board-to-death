export const PUBLISHED_SCHEDULE_FEED_FORMATS = ["html", "json", "xml", "ical"] as const;

export type PublishedScheduleFeedFormat = (typeof PUBLISHED_SCHEDULE_FEED_FORMATS)[number];

export const PUBLISHED_SCHEDULE_FEED_LABELS: Readonly<Record<PublishedScheduleFeedFormat, string>> = {
  html: "Basic HTML",
  json: "JSON",
  xml: "XML",
  ical: "iCal",
};

export function isPublishedScheduleFeedFormat(value: string): value is PublishedScheduleFeedFormat {
  return PUBLISHED_SCHEDULE_FEED_FORMATS.includes(value as PublishedScheduleFeedFormat);
}

export function publishedScheduleFeedUrl(
  origin: string,
  eventSlug: string,
  format: PublishedScheduleFeedFormat,
): string {
  return new URL(`/embed/${encodeURIComponent(eventSlug)}/feeds/${encodeURIComponent(format)}`, origin).toString();
}
