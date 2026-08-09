import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATE_PREVIEW_VALUES, renderEmailTemplate, validateEmailTemplate } from "./email-templates";

const template = {
  key: "speaker-welcome",
  name: "Speaker welcome",
  subjectTemplate: "Welcome to {{event.name}}, {{speaker.name}}",
  bodyTemplate: "# Welcome\n\nYour session is **{{session.title}}**.",
  textTemplate: "Welcome {{speaker.name}} to {{event.name}}.",
};

describe("email templates", () => {
  it("validates an allowlisted template", () => {
    expect(validateEmailTemplate(template)).toEqual({
      ok: true,
      definition: template,
    });
  });

  it("reports unknown, malformed, unsafe, and multiline subject content", () => {
    const result = validateEmailTemplate({
      ...template,
      subjectTemplate: "Hello\n{{recipient}}",
      bodyTemplate: '<script>alert("xss")</script> {{private.token}}',
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues.map(({ message }) => message).join(" ")).toContain("single line");
    expect(result.issues.map(({ message }) => message).join(" ")).toContain("Raw HTML");
    expect(result.issues.map(({ message }) => message).join(" ")).toContain("Unknown variables: private.token");
    expect(result.issues.map(({ message }) => message).join(" ")).toContain("Invalid variable syntax: {{recipient}}");
  });

  it("reports missing values before rendering", () => {
    const result = renderEmailTemplate(template, { "event.name": "Board Game Summit" });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          field: "variables",
          message: "Missing values: speaker.name, session.title.",
        },
      ],
    });
  });

  it("escapes untrusted values after Markdown sanitization", () => {
    const result = renderEmailTemplate(template, {
      ...EMAIL_TEMPLATE_PREVIEW_VALUES,
      "speaker.name": '<img src=x onerror="alert(1)">',
      "session.title": "[Click me](javascript:alert(1)) & learn",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rendered.subject).toContain('<img src=x onerror="alert(1)">');
    expect(result.rendered.html).toContain("[Click me](javascript:alert(1)) &amp; learn");
    expect(result.rendered.html).not.toContain("<img");
    expect(result.rendered.html).not.toContain('href="javascript:');
    expect(result.rendered.previewMarkdown).toContain("\\[Click me\\]\\(javascript:alert\\(1\\)\\) &amp; learn");

    const bodyFallback = renderEmailTemplate(
      { ...template, textTemplate: null },
      {
        ...EMAIL_TEMPLATE_PREVIEW_VALUES,
        "speaker.name": '<img src=x onerror="alert(1)">',
        "session.title": "[Click me](javascript:alert(1)) & learn",
      },
    );
    expect(bodyFallback.ok).toBe(true);
    if (!bodyFallback.ok) return;
    expect(bodyFallback.rendered.text).toContain("[Click me](javascript:alert(1)) & learn");
  });

  it("normalizes untrusted line breaks out of rendered subjects", () => {
    const result = renderEmailTemplate(template, {
      ...EMAIL_TEMPLATE_PREVIEW_VALUES,
      "speaker.name": "Avery\r\nBcc: attacker@example.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rendered.subject).not.toMatch(/[\r\n]/);
  });
});
