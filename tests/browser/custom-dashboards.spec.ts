import { type BrowserContext, expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers/hydration";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface DashboardFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly sessionCookie: string;
}

async function prepareDashboard(context: BrowserContext): Promise<DashboardFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/event-overview.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as DashboardFixture;
  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL },
    { name: "board_to_death_active_event", value: fixture.eventId, url: baseURL },
  ]);
  return fixture;
}

test("creates, configures, reloads, isolates, reorders, and deletes a custom dashboard", async ({ context, page }) => {
  test.setTimeout(90_000);
  const fixture = await prepareDashboard(context);
  const dashboardUrl = `/dashboard/events/${fixture.eventSlug}/dashboards`;
  await page.goto(dashboardUrl);

  await expect(page.getByRole("heading", { name: "Custom dashboards" })).toBeVisible();
  await expect(page.getByText("No custom dashboards yet")).toBeVisible();

  const newDashboardButton = page.getByRole("button", { name: "New dashboard" }).first();
  await waitForHydration(newDashboardButton);
  await newDashboardButton.click();
  await page.getByLabel("Name").fill("Operations room");
  await page.getByLabel("Template").click();
  await page.getByRole("option", { name: "Event Overview" }).click();
  await page.getByRole("button", { name: "Create dashboard" }).click();

  await expect(page.getByText("No custom dashboards yet")).not.toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("Submissions", { exact: true })).toBeVisible();
  await expect(main.getByText("Speakers", { exact: true })).toBeVisible();
  await expect(main.getByText("Review progress", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unscheduled keynote" })).toBeVisible();
  await expect(page.getByText("Other event secret talk")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Dashboard name").fill("Program control");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByLabel("Track filter").click();
  await page.getByRole("option", { name: "Game Design" }).click();
  await page.getByRole("button", { name: "Save filter" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Track: Game Design")).toBeVisible();

  await page.getByRole("button", { name: "Add widget" }).first().click();
  const addWidgetDialog = page.getByRole("dialog", { name: "Add widget" });
  await addWidgetDialog.getByRole("combobox", { name: "Widget", exact: true }).click();
  await page.getByRole("option", { name: "Recent submissions" }).click();
  await addWidgetDialog.getByRole("button", { name: "Add widget", exact: true }).click();
  await expect(page.getByRole("button", { name: "Configure Recent submissions" })).toBeVisible();

  await page.getByRole("button", { name: "Configure Recent submissions" }).click();
  const configureWidgetDialog = page.getByRole("dialog", { name: "Configure widget" });
  await configureWidgetDialog.getByLabel("Title").fill("Latest proposals");
  await configureWidgetDialog.getByLabel("Width").click();
  await page.getByRole("option", { name: "Compact" }).click();
  await configureWidgetDialog.getByRole("button", { name: "Save widget" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Latest proposals", { exact: true })).toBeVisible();

  const latestCard = page.locator('[data-slot="card"]').filter({ hasText: "Latest proposals" });
  await latestCard.getByRole("button", { name: "Move widget up" }).click();
  await page.reload();
  await expect(page.getByText("Program control", { exact: true })).toBeVisible();
  await expect(page.getByText("Latest proposals", { exact: true })).toBeVisible();
  await expect(page.getByText("Track: Game Design")).toBeVisible();

  await page.goto("/dashboard/events/other-overview-event/dashboards");
  await expect(page.getByText("No custom dashboards yet")).toBeVisible();
  await expect(page.getByText("Program control", { exact: true })).toHaveCount(0);

  await page.goto(dashboardUrl);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete dashboard" }).click();
  await expect(page.getByText("No custom dashboards yet")).toBeVisible();
});
