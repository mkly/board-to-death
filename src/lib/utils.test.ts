import { describe, expect, it } from "vitest";

import { cn, formatCurrency, getInitials } from "@/lib/utils";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("base", false, undefined, null, "extra")).toBe("base extra");
  });
});

describe("getInitials", () => {
  it("uppercases the first letter of each word", () => {
    expect(getInitials("studio admin")).toBe("SA");
  });

  it("falls back to a placeholder for blank input", () => {
    expect(getInitials("   ")).toBe("?");
  });
});

describe("formatCurrency", () => {
  it("formats using USD and en-US by default", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
  });

  it("supports overriding currency, locale, and decimals", () => {
    expect(formatCurrency(1000, { currency: "EUR", locale: "de-DE", noDecimals: true })).toBe("1.000 €");
  });
});
