import type { Schema } from "hast-util-sanitize";

/**
 * Hostnames permitted for controlled `<iframe>` embeds (session recordings,
 * slide decks, calendar invites). Anything else is stripped by
 * `allowlistEmbeds`, regardless of what `CONTENT_SANITIZE_SCHEMA` allows
 * structurally. Extend this list, not the schema, to trust a new provider.
 */
export const EMBED_HOST_ALLOWLIST: readonly string[] = [
  "www.youtube.com",
  "youtube.com",
  "player.vimeo.com",
  "docs.google.com",
  "calendar.google.com",
];

/**
 * Allowlist schema for `hast-util-sanitize`, applied to every render path
 * (admin preview and public published output) via the same
 * `CONTENT_SANITIZE_SCHEMA` instance so behavior cannot drift between them.
 *
 * Design notes:
 * - Only structural/formatting tags plus a controlled `iframe` are allowed.
 *   `script`, `style`, `object`, `embed`, `form`, `input`, `button`, `svg`,
 *   `math`, `link`, `meta`, and `base` are all omitted, so they are dropped
 *   regardless of case, nesting, or namespace tricks.
 * - No `on*` event handler attributes are allowlisted on any tag, so inline
 *   handlers (`onerror`, `onload`, ...) are always stripped.
 * - `href`/`src` only accept the `http`, `https`, and `mailto` protocols
 *   (for `href`) or `http`/`https` (for `src`); `javascript:`, `data:`,
 *   `vbscript:`, and similar schemes are rejected even when
 *   percent-encoded, case-mixed, or whitespace-padded, because
 *   `hast-util-sanitize` parses the resolved protocol rather than
 *   string-matching the raw attribute value.
 * - `target` is intentionally not allowlisted on `<a>`, which removes the
 *   reverse-tabnabbing risk of `target="_blank"` without `rel="noopener"`
 *   instead of trying to enforce a paired attribute.
 * - `<iframe>` is structurally allowed here but is further restricted to
 *   `EMBED_HOST_ALLOWLIST` by the `allowlistEmbeds` rehype plugin, since
 *   `hast-util-sanitize` schemas cannot filter by hostname.
 */
export const CONTENT_SANITIZE_SCHEMA: Schema = {
  tagNames: [
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "del",
    "blockquote",
    "ul",
    "ol",
    "li",
    "code",
    "pre",
    "a",
    "img",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "span",
    "iframe",
  ],
  attributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    iframe: ["src", "title", "width", "height", "allow", "allowfullscreen"],
    "*": [],
  },
  protocols: {
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
  strip: ["script", "style"],
};
