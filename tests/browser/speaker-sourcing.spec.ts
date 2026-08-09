import { expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const fixtureScript = path.join(process.cwd(), "tests/browser/fixtures/speaker-sourcing.ts");

interface Fixture {
  readonly activeEventId: string;
  readonly eventSlug: string;
  readonly publicId: string;
  readonly sessionCookie: string;
}

async function runFixture<T>(command: "seed" | "cleanup"): Promise<T> {
  const { stdout } = await executeFile(process.execPath, [fixtureScript, command], {
    env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl },
  });
  return JSON.parse(stdout) as T;
}

test.describe
  .serial("speaker sourcing", () => {
    let fixture: Fixture;

    test.beforeAll(async () => {
      fixture = await runFixture<Fixture>("seed");
    });

    test.afterAll(async () => {
      await runFixture("cleanup");
    });

    test("captures public interest and manages the prospect through event assignment", async ({ context, page }) => {
      await page.goto(`/speaker-interest/${fixture.publicId}`);
      await expect(page.getByRole("heading", { name: "Share your tabletop expertise" })).toBeVisible();
      await page.getByLabel("First name").fill("Avery");
      await page.getByLabel("Last name").fill("Public");
      await page.getByLabel("Email").fill("public@example.test");
      await page.getByLabel("Organization").fill("Open Tables");
      await page.getByRole("button", { name: "Share my interest" }).click();
      await expect(page.getByText("Interest received")).toBeVisible();

      await context.addCookies([
        { name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL },
        { name: "board_to_death_active_event", value: fixture.activeEventId, url: baseURL },
      ]);
      await page.goto(`/dashboard/events/${fixture.eventSlug}/speaker-sourcing`);
      await expect(page.getByRole("heading", { name: "Speaker sourcing" })).toBeVisible();
      await expect(page.getByText("Avery Public")).toBeVisible();
      await expect(
        page.getByLabel("Prospect pipeline").getByText("Share your tabletop expertise", { exact: true }),
      ).toBeVisible();

      await page.getByLabel("Directory person").selectOption({ label: "Morgan Manual · manual@example.test" });
      await page.getByRole("button", { name: "Enroll prospect" }).click();
      await expect(page.getByText("Prospect enrolled in the sourcing pipeline.")).toBeVisible();
      await expect(page.getByText("Morgan Manual")).toBeVisible();

      const prospectCard = page.getByText("Avery Public").locator("xpath=ancestor::*[@data-slot='card'][1]");
      await prospectCard.getByLabel("Move card").selectOption({ label: "Nurture" });
      await prospectCard.getByRole("button", { name: "Move" }).click();
      await expect(page.getByText("Prospect stage updated.")).toBeVisible();

      const movedCard = page.getByText("Avery Public").locator("xpath=ancestor::*[@data-slot='card'][1]");
      await movedCard.getByLabel("Internal note").fill("Invite for the design track.");
      await movedCard.getByRole("button", { name: "Add note" }).click();
      await expect(page.getByText("Invite for the design track.")).toBeVisible();

      const notedCard = page.getByText("Avery Public").locator("xpath=ancestor::*[@data-slot='card'][1]");
      await expect(notedCard.getByText("Automated", { exact: true }).first()).toBeVisible();
      await expect(notedCard.getByText("Team member", { exact: true }).first()).toBeVisible();

      await page
        .getByText("Avery Public")
        .locator("xpath=ancestor::*[@data-slot='card'][1]")
        .getByRole("button", {
          name: "Assign to Speaker Sourcing Browser Event",
        })
        .click();
      await expect(
        page.getByText(/assigned to Speaker Sourcing Browser Event and added to event contacts/i),
      ).toBeVisible();
      await expect(page.getByText("Assigned to Speaker Sourcing Browser Event", { exact: true })).toBeVisible();
    });
  });
