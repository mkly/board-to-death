import { NextRequest } from "next/server";

import { describe, expect, test } from "vitest";

import { proxy } from "./proxy";

describe("dashboard proxy", () => {
  test("redirects a direct anonymous dashboard request to magic-link sign-in", () => {
    const response = proxy(new NextRequest("http://localhost:3000/dashboard/default"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/auth/v1/login?returnTo=%2Fdashboard%2Fdefault",
    );
  });

  test("uses the cookie only as an optimistic check", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/dashboard/default", {
        headers: { cookie: "better-auth.session_token=forged.invalid" },
      }),
    );

    expect(response.status).toBe(200);
  });
});
