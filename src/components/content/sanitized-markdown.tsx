import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { allowlistEmbeds } from "@/lib/content/allowlist-embeds";
import { CONTENT_SANITIZE_SCHEMA } from "@/lib/content/schema";
import { cn } from "@/lib/utils";

interface SanitizedMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Shared React renderer for stored Markdown/HTML resource content. Both the
 * admin preview and the public published view render through this
 * component so they always sanitize against the same
 * `CONTENT_SANITIZE_SCHEMA` and `allowlistEmbeds` step used by
 * `renderMarkdownToSafeHtml` — there is no separate "preview" or
 * "published" sanitization path to drift out of sync.
 */
export function SanitizedMarkdown({ content, className }: SanitizedMarkdownProps) {
  return (
    <div className={cn("max-w-none text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, CONTENT_SANITIZE_SCHEMA], allowlistEmbeds]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
