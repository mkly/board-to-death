import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

test("enrolls an authenticator and reveals one-time recovery codes", async ({ context, page }) => {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/two-factor.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as { readonly sessionCookie: string };
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);

  await page.goto("/dashboard/account/security", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  await expect(page.getByText("Not enabled", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Enable two-factor authentication" }).click();
  await expect(page.getByRole("img", { name: "Authenticator enrollment QR code" })).toBeVisible();
  const encodedSecret = await page.locator("code").textContent();
  if (!encodedSecret) throw new Error("Expected the manual authenticator setup key.");
  const secret = new TextDecoder().decode(base32.decode(encodedSecret));
  const code = await createOTP(secret).totp();

  await page.getByRole("textbox", { name: "Authenticator code" }).fill(code);
  await page.getByRole("button", { name: "Confirm and enable" }).click();

  await expect(page.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(page.getByText("Save these single-use recovery codes now")).toBeVisible();
  await expect(page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(10);
});
