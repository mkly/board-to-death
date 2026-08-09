import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { allowlistEmbeds } from "./allowlist-embeds.ts";
import { CONTENT_SANITIZE_SCHEMA } from "./schema.ts";

/**
 * Shared Markdown + controlled-HTML renderer. Used directly for non-React
 * output (e.g. emails) and mirrored by `SanitizedMarkdown` for React
 * rendering, both against the same `CONTENT_SANITIZE_SCHEMA` and
 * `allowlistEmbeds` step, so admin preview and public published output
 * sanitize identically.
 */
export function renderMarkdownToSafeHtml(markdown: string): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, CONTENT_SANITIZE_SCHEMA)
    .use(allowlistEmbeds)
    .use(rehypeStringify)
    .processSync(markdown);

  return String(file);
}
