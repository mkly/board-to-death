import { describe, expect, test } from "vitest";

import {
  answersFromFormData,
  parsePortalFormAnswers,
  parsePortalFormDefinition,
  validatePortalFormAnswers,
  visiblePortalFormFieldIds,
} from "./portal-forms";

const definition = parsePortalFormDefinition({
  kind: "portal-form",
  sections: [
    {
      id: "profile",
      title: "Profile",
      instructions: "Shown publicly.",
      fields: [
        { id: "email", label: "Public email", type: "email", required: true, reusableKey: "public-email" },
        {
          id: "consent",
          label: "I consent",
          type: "checkbox",
          required: true,
          reusableKey: null,
          visibleWhen: { fieldId: "email", equals: "speaker@example.test" },
        },
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
      email: "Enter a valid email address.",
    });
    expect(validatePortalFormAnswers(definition, { email: "speaker@example.test", consent: false })).toEqual({
      consent: "I consent is required.",
    });
  });

  test("shows dependent fields only for matching visible controllers and drops hidden answers", () => {
    if (!definition) throw new Error("Expected the fixture definition to parse.");
    expect([...visiblePortalFormFieldIds(definition, { email: "other@example.test", consent: true })]).toEqual([
      "email",
    ]);
    expect([...visiblePortalFormFieldIds(definition, { email: "speaker@example.test", consent: true })]).toEqual([
      "email",
      "consent",
    ]);

    const formData = new FormData();
    formData.set("email", "other@example.test");
    formData.set("consent", "on");
    expect(answersFromFormData(definition, formData)).toEqual({ email: "other@example.test" });
  });

  test("rejects conditions that reference later fields", () => {
    expect(
      parsePortalFormDefinition({
        kind: "portal-form",
        sections: [
          {
            id: "profile",
            title: "Profile",
            fields: [
              {
                id: "details",
                label: "Details",
                type: "text",
                required: false,
                visibleWhen: { fieldId: "format", equals: "Online" },
              },
              { id: "format", label: "Format", type: "text", required: false },
            ],
          },
        ],
      }),
    ).toBeNull();
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
