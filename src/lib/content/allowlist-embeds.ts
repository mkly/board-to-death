import type { Root } from "hast";
import { visit } from "unist-util-visit";

import { EMBED_HOST_ALLOWLIST } from "./schema.ts";

function isAllowedEmbedSrc(src: unknown): boolean {
  if (typeof src !== "string") return false;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  return EMBED_HOST_ALLOWLIST.includes(url.hostname.toLowerCase());
}

/**
 * Rehype plugin that removes any `<iframe>` whose `src` does not resolve to
 * an allowlisted host in {@link EMBED_HOST_ALLOWLIST}. Must run after
 * `rehype-sanitize` in the pipeline, since `hast-util-sanitize` schemas have
 * no concept of per-hostname allowlisting and would otherwise let an
 * `iframe` pointing anywhere through as long as the protocol matched.
 */
export function allowlistEmbeds() {
  return (tree: Root) => {
    visit<Root, "element">(tree, "element", (node, index, parent) => {
      if (node.tagName !== "iframe") return;
      if (isAllowedEmbedSrc(node.properties?.src)) return;
      if (parent && typeof index === "number") {
        parent.children.splice(index, 1);
        return index;
      }
    });
  };
}
