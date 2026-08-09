import { type BrowserContext, expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers/hydration.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface ContactCustomFieldFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly sessionCookie: string;
}

async function prepareFixture(context: BrowserContext): Promise<ContactCustomFieldFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/contact-custom-fields.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as ContactCustomFieldFixture;
  await context.addCookies([
    { name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL },
    { name: "board_to_death_active_event", value: fixture.eventId, url: baseURL },
  ]);
  return fixture;
}

test("captures and displays event-scoped custom values for contacts and groups", async ({ context, page }) => {
  test.setTimeout(90_000);
  const fixture = await prepareFixture(context);
  await page.goto(`/dashboard/events/${fixture.eventSlug}/contacts`);

  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
  await expect(page.getByText("Dana Reed", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Dietary notes")).toHaveValue("Vegan");
  await expect(page.getByText("Vegan", { exact: true })).toBeVisible();
  await expect(page.getByText("Private Person")).toHaveCount(0);
  await expect(page.getByText("Never render this")).toHaveCount(0);

  await waitForHydration(page.getByLabel("Dietary notes"));
  await page.getByLabel("Dietary notes").fill("Vegetarian");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact changes saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Dietary notes")).toHaveValue("Vegetarian");
  await expect(page.getByText("Vegetarian", { exact: true })).toBeVisible();

  await page.goto(`/dashboard/events/${fixture.eventSlug}/groups`);
  await expect(page.getByRole("heading", { name: "Sponsors and exhibitors" })).toBeVisible();
  const groupForm = page.locator('input[name="name"][value="Tabletop Partners"]').locator("xpath=ancestor::form");
  const boothLocation = groupForm.getByLabel("Booth location");
  await expect(boothLocation).toHaveValue("Hall A");
  await waitForHydration(boothLocation);
  await boothLocation.fill("Hall B");
  await groupForm.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Group updated.")).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator('input[name="name"][value="Tabletop Partners"]')
      .locator("xpath=ancestor::form")
      .getByLabel("Booth location"),
  ).toHaveValue("Hall B");
  await expect(page.getByText("Hall B", { exact: true })).toBeVisible();
});
