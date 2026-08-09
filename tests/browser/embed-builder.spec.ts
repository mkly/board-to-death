import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { execFileSync } from "node:child_process";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new Pool({ connectionString: databaseUrl });
let eventSlug = "";
let sessionCookie = "";

test.beforeAll(() => {
  const fixture = JSON.parse(
    execFileSync(process.execPath, ["--experimental-strip-types", "tests/browser/fixtures/onboarding.ts"], {
      encoding: "utf8",
      env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl },
    }),
  ) as { eventSlug: string; sessionCookie: string };
  eventSlug = fixture.eventSlug;
  sessionCookie = fixture.sessionCookie;
});

test.afterAll(async () => {
  if (eventSlug) await database.query(`DELETE FROM "events" WHERE "slug" = $1`, [eventSlug]);
  await database.end();
});

test("configures, previews, persists, copies, validates, and adapts the embed builder", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  await context.addCookies([
    { name: "better-auth.session_token", value: sessionCookie, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);

  await page.goto(`/dashboard/events/${eventSlug}/publishing/embeds`);
  await expect(page.getByRole("heading", { name: "Embed builder" })).toBeVisible();
  await expect(page.getByText("Saved automatically")).toBeVisible();

  await page.getByRole("radio", { name: "Speaker gallery" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: "Speaker gallery" })).toBeChecked();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("radio", { name: "Compact" }).click();

  const preview = page.getByTitle("Speaker gallery embed preview");
  await expect(preview).toHaveAttribute("src", /kind=speaker-gallery&theme=dark&density=compact/);
  await expect(preview.contentFrame().getByRole("heading", { name: "Speaker gallery" })).toBeVisible();
  await expect(preview.contentFrame().getByText("Organization", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy snippet" }).click();
  await expect(page.getByText("Iframe snippet copied.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  const previewSrc = await preview.getAttribute("src");
  expect(clipboard).toContain((previewSrc ?? "").replaceAll("&", "&amp;"));
  expect(clipboard).toContain("event.origin !== expectedOrigin || event.source !== frame.contentWindow");
  expect(clipboard).toContain("controller.abort()");

  await page.getByRole("tab", { name: "Web component" }).click();
  await expect(page.getByLabel("Web component snippet")).toContainText("/embed/board-to-death.js");

  await page.reload();
  await expect(page.getByRole("radio", { name: "Speaker gallery" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Compact" })).toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Live preview", { exact: true })).toBeVisible();
  await expect(page.getByText("Install", { exact: true })).toBeVisible();

  await page.goto(
    `/embed/${eventSlug}?kind=javascript%3Aalert(1)&theme=%3Cscript%3E&density=position%3Afixed&filter=room`,
  );
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute(
    "data-embed-configuration",
    JSON.stringify({ kind: "agenda", theme: "system", density: "comfortable", filters: ["room"] }),
  );
});
