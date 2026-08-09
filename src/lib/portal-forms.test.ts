import { describe, expect, test } from "vitest";

import { parsePortalFormAnswers, parsePortalFormDefinition, validatePortalFormAnswers } from "./portal-forms";

const definition = parsePortalFormDefinition({
  kind: "portal-form",
  sections: [
    {
      id: "profile",
      title: "Profile",
      instructions: "Shown publicly.",
      fields: [
        { id: "email", label: "Public email", type: "email", required: true, reusableKey: "public-email" },
        { id: "consent", label: "I consent", type: "checkbox", required: true, reusableKey: null },
      ],
    },
  ],
  confirmation: { subject: "Received", message: "Thank you.", sendEmail: true },
});

describe("portal response forms", () => {
  test("preserves section and field order while parsing reusable fields", () => {
    expect(definition).not.toBeNull();
    expect(definition?.sections[0]?.fields.map(({ id }) => id)).toEqual(["email", "consent"]);
    expect(definition?.sections[0]?.fields[0]?.reusableKey).toBe("public-email");
  });

  test("rejects missing required values and invalid email addresses", () => {
    if (!definition) throw new Error("Expected the fixture definition to parse.");
    expect(validatePortalFormAnswers(definition, { email: "invalid", consent: false })).toEqual({
      consent: "I consent is required.",
      email: "Enter a valid email address.",
    });
  });

  test("keeps only scalar persisted answers", () => {
    expect(parsePortalFormAnswers({ email: "speaker@example.test", consent: true, nested: { ignored: true } })).toEqual(
      {
        email: "speaker@example.test",
        consent: true,
      },
    );
  });
});
