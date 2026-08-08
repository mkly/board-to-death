import { describe, expect, it } from "vitest";

import { renderMarkdownToSafeHtml } from "./render-markdown";

describe("renderMarkdownToSafeHtml", () => {
  it("renders plain markdown formatting", () => {
    const html = renderMarkdownToSafeHtml("# Title\n\nSome **bold** and _italic_ text.");

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("keeps allowlisted links and images with safe protocols", () => {
    const html = renderMarkdownToSafeHtml(
      "[docs](https://example.com/docs) ![alt](https://example.com/pic.png) [mail](mailto:a@example.com)",
    );

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('src="https://example.com/pic.png"');
    expect(html).toContain('href="mailto:a@example.com"');
  });

  describe("script and active-content stripping", () => {
    it("strips raw <script> tags entirely", () => {
      const html = renderMarkdownToSafeHtml('Hello <script>alert("xss")</script> world');

      expect(html).not.toContain("<script");
      expect(html).not.toContain("alert(");
    });

    it("strips script tags nested inside allowed elements", () => {
      const html = renderMarkdownToSafeHtml("<p>before<script>alert(1)</script>after</p>");

      expect(html).not.toContain("<script");
      expect(html).not.toContain("alert(1)");
      expect(html).toContain("before");
      expect(html).toContain("after");
    });

    it("strips case-mixed and malformed script variants", () => {
      const variants = ["<ScRiPt>alert(1)</ScRiPt>", "<script >alert(1)</script >", "<script/xss>alert(1)</script>"];

      for (const variant of variants) {
        const html = renderMarkdownToSafeHtml(variant);
        // No live <script ...> element may survive; any leftover "alert(1)"
        // text must be HTML-escaped (inert), never inside an executable tag.
        expect(html.toLowerCase()).not.toContain("<script");
        if (html.includes("alert(1)")) {
          expect(html).not.toMatch(/<script[^>]*>[^<]*alert\(1\)/i);
        }
      }
    });

    it("strips inline event handler attributes", () => {
      const html = renderMarkdownToSafeHtml('<img src="https://example.com/pic.png" onerror="alert(1)">');

      expect(html).not.toContain("onerror");
      expect(html).not.toContain("alert(1)");
    });

    it("strips style attributes and <style> blocks", () => {
      const html = renderMarkdownToSafeHtml(
        '<style>body{background:url("javascript:alert(1)")}</style><p style="background:url(javascript:alert(1))">hi</p>',
      );

      expect(html).not.toContain("<style");
      expect(html).not.toContain("style=");
    });

    it("strips SVG foreignObject-based script smuggling", () => {
      const html = renderMarkdownToSafeHtml(
        '<svg><foreignObject><script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script></foreignObject></svg>',
      );

      expect(html).not.toContain("<svg");
      expect(html).not.toContain("<script");
      expect(html).not.toContain("alert(1)");
    });

    it("drops disallowed structural and interactive elements", () => {
      const html = renderMarkdownToSafeHtml(
        '<form action="https://evil.example"><input type="text"></form><object data="evil.swf"></object><embed src="evil.swf"><base href="https://evil.example/">',
      );

      expect(html).not.toMatch(/<(form|input|object|embed|base)[\s>]/i);
    });
  });

  describe("unsafe URL protocols", () => {
    it.each([
      ["javascript:alert(1)", "javascript:"],
      ["JaVaScRiPt:alert(1)", "mixed-case javascript:"],
      ["java\nscript:alert(1)", "javascript: with embedded newline"],
      ["java\tscript:alert(1)", "javascript: with embedded tab"],
      ["vbscript:msgbox(1)", "vbscript:"],
      ["data:text/html,<script>alert(1)</script>", "data: URI"],
    ])("strips href=%j (%s)", (href) => {
      const html = renderMarkdownToSafeHtml(`<a href="${href}">click</a>`);

      expect(html).not.toContain('href="');
      expect(html).not.toContain("alert(");
      expect(html).not.toContain("msgbox(");
    });

    it("strips percent- and entity-encoded javascript: URLs", () => {
      const encoded = renderMarkdownToSafeHtml('<a href="jav%61script:alert(1)">click</a>');
      const entityEncoded = renderMarkdownToSafeHtml('<a href="&#106;avascript:alert(1)">click</a>');

      expect(encoded).not.toContain("alert(1)");
      expect(entityEncoded).not.toContain("alert(1)");
    });

    it("does not allow data: URIs on images", () => {
      const html = renderMarkdownToSafeHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">');

      expect(html).not.toContain("data:image");
    });

    it("drops the target attribute on links so it cannot be paired with an unsafe rel-less _blank", () => {
      const html = renderMarkdownToSafeHtml('<a href="https://example.com" target="_blank">go</a>');

      expect(html).not.toContain("target=");
    });
  });

  describe("malformed and nested markup", () => {
    it("handles unclosed tags without leaking raw markup", () => {
      const html = renderMarkdownToSafeHtml("<p>unclosed <strong>bold text");

      expect(html).not.toContain("<p>unclosed <strong>bold text\n");
      expect(html).toContain("bold text");
    });

    it("handles deeply nested disallowed tags around allowed content", () => {
      const html = renderMarkdownToSafeHtml("<div><div><div><script>alert(1)</script><p>safe</p></div></div></div>");

      expect(html).not.toContain("<script");
      expect(html).not.toContain("alert(1)");
      expect(html).toContain("<p>safe</p>");
    });
  });

  describe("controlled embed allowlisting", () => {
    it("keeps an iframe from an allowlisted embed host", () => {
      const html = renderMarkdownToSafeHtml(
        '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="video"></iframe>',
      );

      expect(html).toContain("<iframe");
      expect(html).toContain("www.youtube.com");
    });

    it("drops an iframe from a non-allowlisted host", () => {
      const html = renderMarkdownToSafeHtml('<iframe src="https://evil.example/payload" title="video"></iframe>');

      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("evil.example");
    });

    it("drops an iframe using an unsafe protocol even on an allowlisted-looking host string", () => {
      const html = renderMarkdownToSafeHtml('<iframe src="javascript:alert(1)//www.youtube.com"></iframe>');

      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("alert(1)");
    });

    it("drops an iframe with a malformed src", () => {
      const html = renderMarkdownToSafeHtml('<iframe src="not a url"></iframe>');

      expect(html).not.toContain("<iframe");
    });
  });
});
