export const EMBED_KINDS = ["agenda", "session-list", "itinerary", "speaker-list", "speaker-gallery"] as const;
export const EMBED_THEMES = ["system", "light", "dark"] as const;
export const EMBED_DENSITIES = ["comfortable", "compact"] as const;
export const EMBED_FILTERS = ["search", "track", "room", "day", "organization"] as const;

export type EmbedKind = (typeof EMBED_KINDS)[number];
export type EmbedTheme = (typeof EMBED_THEMES)[number];
export type EmbedDensity = (typeof EMBED_DENSITIES)[number];
export type EmbedFilter = (typeof EMBED_FILTERS)[number];

export interface EmbedConfiguration {
  readonly kind: EmbedKind;
  readonly theme: EmbedTheme;
  readonly density: EmbedDensity;
  readonly filters: readonly EmbedFilter[];
}

export const DEFAULT_EMBED_CONFIGURATION: EmbedConfiguration = {
  kind: "agenda",
  theme: "system",
  density: "comfortable",
  filters: ["search", "track", "room", "day"],
};

export const EMBED_KIND_LABELS: Readonly<Record<EmbedKind, string>> = {
  agenda: "Agenda",
  "session-list": "Session list",
  itinerary: "Schedule itinerary",
  "speaker-list": "Speaker list",
  "speaker-gallery": "Speaker gallery",
};

export const EMBED_FILTER_LABELS: Readonly<Record<EmbedFilter, string>> = {
  search: "Search",
  track: "Track",
  room: "Room",
  day: "Day",
  organization: "Organization",
};

export const EMBED_FILTERS_BY_KIND: Readonly<Record<EmbedKind, readonly EmbedFilter[]>> = {
  agenda: ["search", "track", "room", "day"],
  "session-list": ["search", "track"],
  itinerary: ["search", "track", "day"],
  "speaker-list": ["search", "organization"],
  "speaker-gallery": ["search", "organization"],
};

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function normalizeEmbedConfiguration(value: unknown): EmbedConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_EMBED_CONFIGURATION;
  const candidate = value as Record<string, unknown>;
  const kind = isMember(EMBED_KINDS, candidate.kind) ? candidate.kind : DEFAULT_EMBED_CONFIGURATION.kind;
  const availableFilters = EMBED_FILTERS_BY_KIND[kind];
  const filters = Array.isArray(candidate.filters)
    ? [...new Set(candidate.filters.filter((filter): filter is EmbedFilter => isMember(availableFilters, filter)))]
    : DEFAULT_EMBED_CONFIGURATION.filters.filter((filter) => availableFilters.includes(filter));

  return {
    kind,
    theme: isMember(EMBED_THEMES, candidate.theme) ? candidate.theme : DEFAULT_EMBED_CONFIGURATION.theme,
    density: isMember(EMBED_DENSITIES, candidate.density) ? candidate.density : DEFAULT_EMBED_CONFIGURATION.density,
    filters,
  };
}

export function parseEmbedSearchParams(params: URLSearchParams): EmbedConfiguration {
  return normalizeEmbedConfiguration({
    kind: params.get("kind"),
    theme: params.get("theme"),
    density: params.get("density"),
    filters: params.getAll("filter"),
  });
}

export function serializeEmbedConfiguration(configuration: EmbedConfiguration): string {
  const safe = normalizeEmbedConfiguration(configuration);
  const params = new URLSearchParams({ kind: safe.kind, theme: safe.theme, density: safe.density });
  for (const filter of safe.filters) params.append("filter", filter);
  return params.toString();
}

export function embedUrl(
  origin: string,
  eventSlug: string,
  instance: string,
  configuration: EmbedConfiguration,
): string {
  const url = new URL(`/embed/${encodeURIComponent(eventSlug)}`, origin);
  url.search = serializeEmbedConfiguration(configuration);
  url.searchParams.set("instance", instance);
  return url.toString();
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function requireSafeInstance(instance: string): void {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(instance))
    throw new Error("Embed instances must use letters, numbers, dashes, or underscores.");
}

export function iframeEmbedSnippet(urlValue: string, instance: string): string {
  requireSafeInstance(instance);
  const safeUrl = new URL(urlValue);
  if (safeUrl.protocol !== "http:" && safeUrl.protocol !== "https:")
    throw new Error("Embed URLs must use HTTP or HTTPS.");
  const url = escapeHtmlAttribute(safeUrl.toString());
  const id = escapeHtmlAttribute(`board-to-death-${instance}`);
  const encodedInstance = JSON.stringify(instance);

  return `<iframe id="${id}" src="${url}" title="Published event program" loading="lazy" style="width:100%;height:480px;border:0" sandbox="allow-scripts allow-same-origin"></iframe>
<script>
(() => {
  const frame = document.getElementById(${JSON.stringify(`board-to-death-${instance}`)});
  if (!(frame instanceof HTMLIFrameElement)) return;
  const expectedOrigin = new URL(frame.src).origin;
  const controller = new AbortController();
  const observer = new MutationObserver(() => {
    if (!frame.isConnected) {
      controller.abort();
      observer.disconnect();
    }
  });
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.origin !== expectedOrigin || event.source !== frame.contentWindow) return;
    if (!data || data.type !== "board-to-death:resize" || data.instance !== ${encodedInstance}) return;
    if (!Number.isFinite(data.height) || data.height < 120 || data.height > 4000) return;
    frame.style.height = Math.ceil(data.height) + "px";
  }, { signal: controller.signal });
  window.addEventListener("pagehide", () => controller.abort(), { once: true, signal: controller.signal });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>`;
}

export function webComponentEmbedSnippet(urlValue: string, instance: string): string {
  requireSafeInstance(instance);
  const safeUrl = new URL(urlValue);
  if (safeUrl.protocol !== "http:" && safeUrl.protocol !== "https:")
    throw new Error("Embed URLs must use HTTP or HTTPS.");
  return `<script type="module" src="${escapeHtmlAttribute(new URL("/embed/board-to-death.js", safeUrl.origin).toString())}"></script>
<board-to-death-embed src="${escapeHtmlAttribute(safeUrl.toString())}" instance="${escapeHtmlAttribute(instance)}"></board-to-death-embed>`;
}
