import { type BrowserContext, expect, test } from "@playwright/test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";

interface OverviewFixture {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly emptyEventId: string;
  readonly emptyEventSlug: string;
  readonly unscheduledSessionId: string;
  readonly sessionCookie: string;
}

async function prepareOverview(context: BrowserContext): Promise<OverviewFixture> {
  const { stdout } = await runFile(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/browser/fixtures/event-overview.ts"],
    { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: databaseUrl } },
  );
  const fixture = JSON.parse(stdout) as OverviewFixture;
  await context.addCookies([{ name: "better-auth.session_token", value: fixture.sessionCookie, url: baseURL }]);
  return fixture;
}

test.describe("event overview dashboard", () => {
  test.describe.configure({ mode: "serial" });

  test("summarizes the active event with actionable, event-scoped metrics", async ({ context, page }) => {
    test.setTimeout(60_000);
    const fixture = await prepareOverview(context);
    await context.addCookies([{ name: "board_to_death_active_event", value: fixture.eventId, url: baseURL }]);
    await page.goto(`/dashboard/events/${fixture.eventSlug}/overview`);

    await expect(page.getByRole("heading", { name: "Overview Summit" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Submissions 4 1 submitted in the last 7 days$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Participants 2 Unique speakers in this event$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Outstanding speaker tasks 1 1 overdue$/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Evaluation progress 50 1 of 2 assignments complete$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Missing biographies 1 Speakers without a submitted biography$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Missing headshots 1 Speakers without an uploaded headshot$/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^Overdue speaker tasks 1 Past their due date$/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Unscheduled sessions 1 Accepted sessions without an agenda placement$/ }),
    ).toBeVisible();

    // The most recent submission leads, applicants are named, and times carry the event's time zone.
    const recentSubmissions = page.getByRole("listitem").filter({ hasText: "CFP" });
    await expect(recentSubmissions.first()).toContainText("Workshop CFP");
    const keynoteEntry = recentSubmissions.filter({ hasText: "Keynote CFP" }).first();
    await expect(keynoteEntry).toContainText("Ada Lovelace, Grace Hopper");
    await expect(keynoteEntry).toContainText("Jan 4, 2026");
    await expect(keynoteEntry).toContainText("PST");

    // Only the accepted promotion still needs a slot; the rejected one and the other event stay out.
    await expect(page.getByRole("link", { name: "Unscheduled keynote" })).toBeVisible();
    await expect(page.getByText("Withdrawn keynote")).toHaveCount(0);
    await expect(page.getByText("Other event secret talk")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Grace Hopper" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Ada Lovelace" })).toHaveCount(0);

    // Assert the destinations rather than clicking through them: a click landing while the overview
    // is still hydrating is dropped, and the contract under test is that each summary points at the
    // matching event-scoped, pre-filtered view.
    const base = `/dashboard/events/${fixture.eventSlug}`;
    await expect(page.getByRole("link", { name: "Rejected" })).toHaveAttribute(
      "href",
      `${base}/submissions?status=REJECTED`,
    );
    await expect(page.getByRole("link", { name: /^Overdue speaker tasks/ })).toHaveAttribute(
      "href",
      `${base}/speakers?state=overdue`,
    );
  });

  test("renders empty states for an event with no program data", async ({ context, page }) => {
    test.setTimeout(60_000);
    const fixture = await prepareOverview(context);
    await context.addCookies([{ name: "board_to_death_active_event", value: fixture.emptyEventId, url: baseURL }]);
    await page.goto(`/dashboard/events/${fixture.emptyEventSlug}/overview`);

    await expect(page.getByRole("heading", { name: "Empty Overview Event" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Submissions 0 0 submitted in the last 7 days$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Participants 0 Unique speakers in this event$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Evaluation progress 0 0 of 0 assignments complete$/ })).toBeVisible();
    await expect(page.getByText("No submissions yet")).toBeVisible();
    await expect(page.getByText("No submissions to summarize yet.")).toBeVisible();
    await expect(page.getByText("Every speaker has a biography on file.")).toBeVisible();
    await expect(page.getByText("Every speaker has a headshot on file.")).toBeVisible();
    await expect(page.getByText("Every accepted session is on the agenda.")).toBeVisible();
  });
});
