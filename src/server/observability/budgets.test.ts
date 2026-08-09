import { describe, expect, it } from "vitest";

import { compareToBudgets, formatBudgetReport, type PerformanceBudgets } from "./budgets.ts";

const budgets: PerformanceBudgets = {
  version: 1,
  profile: { eventSlug: "board-to-death-benchmark", speakers: 1_000, submissions: 10_000, sessions: 500 },
  surfaces: {
    agenda: { maxQueries: 10, maxDatabaseDurationMs: 1_000, maxTotalDurationMs: 2_000 },
    embeds: { maxQueries: 2, maxDatabaseDurationMs: 500, maxTotalDurationMs: 1_000, maxResponseBytes: 100_000 },
  },
};

describe("performance budgets", () => {
  it("passes when every budgeted surface is measured and within budget", () => {
    const comparison = compareToBudgets(budgets, [
      { surface: "agenda", queryCount: 7, databaseDurationMs: 120, totalDurationMs: 300 },
      { surface: "embeds", queryCount: 1, databaseDurationMs: 20, totalDurationMs: 40, responseBytes: 50_000 },
    ]);

    expect(comparison.passed).toBe(true);
    expect(comparison.violations).toEqual([]);
  });

  it("reports the metric, budget, and measurement for each overrun", () => {
    const comparison = compareToBudgets(budgets, [
      { surface: "agenda", queryCount: 511, databaseDurationMs: 4_000, totalDurationMs: 300 },
      { surface: "embeds", queryCount: 1, databaseDurationMs: 20, totalDurationMs: 40, responseBytes: 50_000 },
    ]);

    expect(comparison.passed).toBe(false);
    expect(comparison.violations).toEqual([
      { surface: "agenda", metric: "queryCount", budget: 10, measured: 511 },
      { surface: "agenda", metric: "databaseDurationMs", budget: 1_000, measured: 4_000 },
    ]);
  });

  // A benchmark that quietly stops measuring a surface would otherwise report a
  // clean run forever.
  it("fails when a budgeted surface was not measured", () => {
    const comparison = compareToBudgets(budgets, [
      { surface: "agenda", queryCount: 7, databaseDurationMs: 120, totalDurationMs: 300 },
    ]);

    expect(comparison.unmeasured).toEqual(["embeds"]);
    expect(comparison.passed).toBe(false);
  });

  it("names a measured surface that has no budget without failing the run", () => {
    const comparison = compareToBudgets(budgets, [
      { surface: "agenda", queryCount: 7, databaseDurationMs: 120, totalDurationMs: 300 },
      { surface: "embeds", queryCount: 1, databaseDurationMs: 20, totalDurationMs: 40, responseBytes: 50_000 },
      { surface: "speaker-portal", queryCount: 4, databaseDurationMs: 30, totalDurationMs: 60 },
    ]);

    expect(comparison.unbudgeted).toEqual(["speaker-portal"]);
    expect(comparison.passed).toBe(true);
  });

  it("skips metrics the surface does not report", () => {
    const comparison = compareToBudgets(budgets, [
      { surface: "agenda", queryCount: 7, databaseDurationMs: 120, totalDurationMs: 300 },
      { surface: "embeds", queryCount: 1, databaseDurationMs: 20, totalDurationMs: 40 },
    ]);

    expect(comparison.violations).toEqual([]);
  });

  it("formats a report naming each violation", () => {
    const measurements = [
      { surface: "agenda", queryCount: 511, databaseDurationMs: 4_000, totalDurationMs: 300 },
      { surface: "embeds", queryCount: 1, databaseDurationMs: 20, totalDurationMs: 40, responseBytes: 50_000 },
    ];
    const report = formatBudgetReport(compareToBudgets(budgets, measurements), measurements);

    expect(report).toContain("agenda: 511 queries");
    expect(report).toContain("OVER BUDGET agenda queryCount: 511 queries > 10 queries");
    expect(report).toContain("48.8 KiB");
  });
});
