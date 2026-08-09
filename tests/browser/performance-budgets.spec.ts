import { expect, test } from "@playwright/test";

import type { PerformanceBudgets } from "../../src/server/observability/budgets.ts";
import { parseServerTiming } from "../../src/server/observability/query-metrics.ts";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const budgets = JSON.parse(readFileSync("performance/budgets.json", "utf8")) as PerformanceBudgets;
// All three resources below are the same public program handler the `embeds`
// surface measures server side, so they share its budget.
const embedsBudget = budgets.surfaces.embeds;
const resources = ["sessions", "speakers", "agenda"] as const;

let eventSlug = "";

test.beforeAll(() => {
  // Seeding the fixed profile takes minutes; the fixture reuses one that is
  // already present so `npm run perf:seed` and this spec can share it.
  const output = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "tests/browser/fixtures/performance-profile.ts"],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 600_000 },
  );
  eventSlug = (JSON.parse(output) as { eventSlug: string }).eventSlug;
});

test.describe("public program route metrics under the fixed benchmark profile", () => {
  test.describe.configure({ timeout: 900_000 });

  for (const resource of resources) {
    test(`${resource} stays inside its committed budget`, async ({ request }) => {
      const response = await request.get(`/api/v1/events/${eventSlug}/${resource}?page=1&pageSize=50`);
      expect(response.status()).toBe(200);

      const timing = parseServerTiming(response.headers()["server-timing"] ?? null);
      const responseBytes = (await response.body()).byteLength;

      // The counts have to be present at all: a route that stops reporting them
      // would otherwise pass every budget it has.
      expect(timing.queryCount).not.toBeNull();
      expect(timing.databaseDurationMs).not.toBeNull();

      expect.soft(timing.queryCount ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(embedsBudget.maxQueries);
      expect
        .soft(timing.databaseDurationMs ?? Number.POSITIVE_INFINITY)
        .toBeLessThanOrEqual(embedsBudget.maxDatabaseDurationMs);
      expect
        .soft(timing.appDurationMs ?? Number.POSITIVE_INFINITY)
        .toBeLessThanOrEqual(embedsBudget.maxTotalDurationMs);
      if (typeof embedsBudget.maxResponseBytes === "number") {
        expect.soft(responseBytes).toBeLessThanOrEqual(embedsBudget.maxResponseBytes);
      }
    });
  }

  // A query count that grows with the row count is the regression this whole
  // profile exists to catch, and a page deep into 500 sessions is where it shows.
  test("a deep page costs no more queries than the first", async ({ request }) => {
    const [first, deep] = await Promise.all([
      request.get(`/api/v1/events/${eventSlug}/sessions?page=1&pageSize=50`),
      request.get(`/api/v1/events/${eventSlug}/sessions?page=8&pageSize=50`),
    ]);

    const firstQueries = parseServerTiming(first.headers()["server-timing"] ?? null).queryCount;
    const deepQueries = parseServerTiming(deep.headers()["server-timing"] ?? null).queryCount;

    expect(deep.status()).toBe(200);
    expect(deepQueries).toBe(firstQueries);
  });

  test("the Server-Timing header carries no event or speaker data", async ({ request }) => {
    const response = await request.get(`/api/v1/events/${eventSlug}/speakers?page=1&pageSize=50`);
    const header = response.headers()["server-timing"] ?? "";

    expect(header).toMatch(/^app;dur=[0-9.]+, db;dur=[0-9.]+;desc="queries=\d+"$/);
    expect(header).not.toContain(eventSlug);
  });

  test("the public embed renders the seeded profile within its total budget", async ({ page }) => {
    const startedAt = Date.now();
    await page.goto(`/embed/${eventSlug}?kind=agenda`);
    await expect(page.getByRole("main")).toBeVisible();

    expect(Date.now() - startedAt).toBeLessThanOrEqual(embedsBudget.maxTotalDurationMs * 10);
  });
});
