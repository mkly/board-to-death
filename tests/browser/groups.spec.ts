import { type BrowserContext, expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers/hydration.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

async function prepareGroups(context: BrowserContext): Promise<string> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/groups.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as { eventSlug: string; sessionCookie: string };
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);
  return fixture.eventSlug;
}

test("manages tiers, reassigns primary contacts, filters groups, and targets tier communications", async ({
  context,
  page,
}) => {
  const eventSlug = await prepareGroups(context);
  await page.goto(`/dashboard/events/${eventSlug}/groups`);
  await expect(page.getByRole("heading", { name: "Sponsors and exhibitors" })).toBeVisible();
  await expect(page.getByText("Foreign Group")).toHaveCount(0);

  await page.getByLabel("New sponsor tier").fill("Community");
  await page.getByRole("button", { name: "Add tier" }).first().click();
  await expect(page.locator('input[value="Community"]')).toBeVisible();
  await page.getByLabel("Move Silver up").click();
  await expect(page.getByText("Tier order updated.")).toBeVisible();

  const groupForm = page.locator("form").filter({ has: page.locator('input[value="Analytical Engines"]') });
  await groupForm.getByLabel("Primary contact").selectOption({ label: "Grace Hopper · grace@example.test" });
  await groupForm.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Group updated.")).toBeVisible();

  await page.locator("#group-tier-filter").selectOption({ label: "Sponsor · Gold" });
  await page.getByLabel("Sort").selectOption("tier");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator('input[value="Analytical Engines"]')).toBeVisible();
  await expect(page.getByText("Compiler Collective")).toHaveCount(0);

  await page.goto(`/dashboard/events/${eventSlug}/communications/audience`);
  const goldTier = page.getByRole("checkbox", { name: "Sponsor · Gold" });
  await waitForHydration(goldTier);
  await goldTier.check();
  await page.getByRole("button", { name: "Preview audience" }).click();
  await expect(page.getByRole("row", { name: /Grace Hopper/ })).toContainText("Sponsor tier: Gold");
  await expect(page.getByText("Foreign Contact")).toHaveCount(0);
});
