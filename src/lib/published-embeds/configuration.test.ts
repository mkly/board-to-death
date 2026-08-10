import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMBED_CONFIGURATION,
  embedUrl,
  iframeEmbedSnippet,
  normalizeEmbedConfiguration,
  parseEmbedSearchParams,
  serializeEmbedConfiguration,
  webComponentEmbedSnippet,
} from "./configuration";

describe("published embed configuration", () => {
  it("round-trips allowlisted options in a stable order", () => {
    const serialized = serializeEmbedConfiguration({
      kind: "speaker-gallery",
      theme: "dark",
      density: "compact",
      filters: ["organization", "search"],
    });

    expect(serialized).toBe("kind=speaker-gallery&theme=dark&density=compact&filter=organization&filter=search");
    expect(parseEmbedSearchParams(new URLSearchParams(serialized))).toEqual({
      kind: "speaker-gallery",
      theme: "dark",
      density: "compact",
      filters: ["organization", "search"],
    });
  });

  it("drops unsafe and incompatible values", () => {
    expect(
      normalizeEmbedConfiguration({
        kind: "speaker-list",
        theme: "dark<script>alert(1)</script>",
        density: "style=position:fixed",
        filters: ["search", "room", "javascript:alert(1)", "search"],
        origin: "https://evil.example",
        script: "alert(1)",
      }),
    ).toEqual({ kind: "speaker-list", theme: "system", density: "comfortable", filters: ["search"] });
    expect(normalizeEmbedConfiguration("javascript:alert(1)")).toEqual(DEFAULT_EMBED_CONFIGURATION);
  });

  it("allows all public session facets while rejecting them on incompatible widgets", () => {
    expect(
      normalizeEmbedConfiguration({
        kind: "session-list",
        filters: ["track", "format", "room"],
      }),
    ).toMatchObject({ filters: ["track", "format", "room"] });
    expect(
      normalizeEmbedConfiguration({
        kind: "speaker-list",
        filters: ["format", "room", "search"],
      }),
    ).toMatchObject({ filters: ["search"] });
  });

  it("creates snippets from the same canonical URL with guarded resize messaging", () => {
    const url = embedUrl("https://events.example", "board games", "instance-1", DEFAULT_EMBED_CONFIGURATION);
    const iframe = iframeEmbedSnippet(url, "instance-1");
    const component = webComponentEmbedSnippet(url, "instance-1");

    expect(url).toContain("https://events.example/embed/board%20games?");
    expect(iframe).toContain(`src="${url.replaceAll("&", "&amp;")}"`);
    expect(iframe).toContain("event.origin !== expectedOrigin || event.source !== frame.contentWindow");
    expect(iframe).toContain('data.instance !== "instance-1"');
    expect(iframe).toContain("controller.abort()");
    expect(component).toContain(`src="${url.replaceAll("&", "&amp;")}"`);
    expect(component).toContain("https://events.example/embed/board-to-death.js");
  });

  it("rejects executable URL protocols", () => {
    expect(() => iframeEmbedSnippet("javascript:alert(1)", "unsafe")).toThrow("HTTP or HTTPS");
    expect(() => webComponentEmbedSnippet("data:text/html,unsafe", "unsafe")).toThrow("HTTP or HTTPS");
    expect(() => iframeEmbedSnippet("https://events.example/embed", "</script><script>alert(1)</script>")).toThrow(
      "letters, numbers, dashes, or underscores",
    );
  });
});
