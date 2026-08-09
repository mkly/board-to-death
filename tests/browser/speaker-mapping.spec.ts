import { type BrowserContext, expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface SpeakerMappingFixture {
  readonly eventSlug: string;
  readonly sessionCookie: string;
}

async function prepareSpeakerMapping(context: BrowserContext): Promise<string> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/speaker-mapping.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as SpeakerMappingFixture;
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);
  return fixture.eventSlug;
}

test("previews mixed speaker actions, validates mapping changes, resumes them, paginates, and downloads safe CSV", async ({
  context,
  page,
}) => {
  test.slow();
  const eventSlug = await prepareSpeakerMapping(context);
  await page.goto(`/dashboard/events/${eventSlug}/integrations`);

  await expect(page.getByRole("heading", { name: "Accelevents speaker mapping" })).toBeVisible();
  await expect(page.getByText("Safe offline preview")).toBeVisible();
  await expect(page.getByText("Create", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Update", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Unchanged", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Skipped", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Invalid", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Withheld")).toBeVisible();
  await expect(page.getByText("invalid-email")).toBeVisible();
  await page.getByRole("link", { name: "Go to next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("Speaker 12 Example").first()).toBeVisible();

  await page.getByLabel("Remote last name").selectOption("profile.organization");
  await page.getByRole("button", { name: "Save mapping and refresh preview" }).click();
  await expect(page.getByText("Speaker mapping version 2 saved.")).toBeVisible();
  await expect(page.getByText("Mapping version 2.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Remote last name")).toHaveValue("profile.organization");

  await page.getByLabel("Remote email").evaluate((select) => {
    const option = document.createElement("option");
    option.value = "profile.secret";
    option.textContent = "Invalid source";
    select.append(option);
  });
  await page.getByLabel("Remote email").selectOption("profile.secret");
  await page.getByRole("button", { name: "Save mapping and refresh preview" }).click();
  await expect(page.getByText("Choose a valid local source for every field.")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download authorized CSV" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Expected a downloaded CSV path.");
  const csv = await import("node:fs/promises").then(({ readFile }) => readFile(path, "utf8"));
  expect(csv).toContain('"\'=2+3"');
  expect(csv).not.toContain("speaker-3@example.test");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/events/${eventSlug}/integrations`);
  await expect(page.getByRole("heading", { name: "Accelevents speaker mapping" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save mapping and refresh preview" })).toBeVisible();
});
