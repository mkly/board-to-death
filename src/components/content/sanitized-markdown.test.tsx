// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SanitizedMarkdown } from "./sanitized-markdown";

describe("SanitizedMarkdown", () => {
  it("renders safe markdown content", () => {
    render(<SanitizedMarkdown content={"# Hello\n\nSome **bold** text."} />);

    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeTruthy();
    expect(screen.getByText("bold")).toBeTruthy();
  });

  it("does not render script tags or execute inline event handlers", () => {
    const { container } = render(
      <SanitizedMarkdown
        content={'<p>hi</p><script>window.__xss = true;</script><img src="x" onerror="window.__xss = true;">'}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
  });

  it("drops non-allowlisted iframe embeds while keeping allowlisted ones", () => {
    const { container } = render(
      <SanitizedMarkdown
        content={
          '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="allowed"></iframe><iframe src="https://evil.example/payload" title="blocked"></iframe>'
        }
      />,
    );

    const iframes = container.querySelectorAll("iframe");
    expect(iframes).toHaveLength(1);
    expect(iframes[0]?.getAttribute("src")).toContain("youtube.com");
  });

  it("renders the same sanitized output for repeated (preview vs. published) mounts", () => {
    const content = 'Shared content with <a href="javascript:alert(1)">link</a>';

    const first = render(<SanitizedMarkdown content={content} />);
    const firstHtml = first.container.innerHTML;
    first.unmount();

    const second = render(<SanitizedMarkdown content={content} />);
    const secondHtml = second.container.innerHTML;

    expect(firstHtml).toBe(secondHtml);
    expect(firstHtml).not.toContain("javascript:");
  });
});
