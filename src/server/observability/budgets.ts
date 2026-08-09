/**
 * Comparing a benchmark run against `performance/budgets.json`.
 *
 * Query counts are the load-bearing budget: they are machine-independent, and
 * an N+1 or a newly unbounded read moves them immediately. Durations and
 * response sizes are budgeted too, but with ceilings loose enough that a slow
 * CI runner does not fail the build on its own.
 */

export interface SurfaceBudget {
  /** Queries the surface may issue against the benchmarked profile. */
  readonly maxQueries: number;
  readonly maxDatabaseDurationMs: number;
  readonly maxTotalDurationMs: number;
  /** Only surfaces that return an HTTP body declare one. */
  readonly maxResponseBytes?: number;
}

export interface BenchmarkProfile {
  readonly eventSlug: string;
  readonly speakers: number;
  readonly submissions: number;
  readonly sessions: number;
}

export interface PerformanceBudgets {
  readonly version: number;
  readonly profile: BenchmarkProfile;
  readonly surfaces: Readonly<Record<string, SurfaceBudget>>;
}

export interface SurfaceMeasurement {
  readonly surface: string;
  readonly queryCount: number;
  readonly databaseDurationMs: number;
  readonly totalDurationMs: number;
  readonly responseBytes?: number;
  readonly operations?: Readonly<Record<string, number>>;
}

export interface BudgetViolation {
  readonly surface: string;
  readonly metric: "queryCount" | "databaseDurationMs" | "totalDurationMs" | "responseBytes";
  readonly budget: number;
  readonly measured: number;
}

export interface BudgetComparison {
  readonly violations: readonly BudgetViolation[];
  /** Budgeted surfaces the run did not measure — a silently dropped benchmark. */
  readonly unmeasured: readonly string[];
  /** Measured surfaces with no budget — a new surface nobody has bounded yet. */
  readonly unbudgeted: readonly string[];
  readonly passed: boolean;
}

const METRICS = [
  { metric: "queryCount", budgetKey: "maxQueries" },
  { metric: "databaseDurationMs", budgetKey: "maxDatabaseDurationMs" },
  { metric: "totalDurationMs", budgetKey: "maxTotalDurationMs" },
  { metric: "responseBytes", budgetKey: "maxResponseBytes" },
] as const;

export function compareToBudgets(
  budgets: PerformanceBudgets,
  measurements: readonly SurfaceMeasurement[],
): BudgetComparison {
  const violations: BudgetViolation[] = [];
  const measured = new Set<string>();

  for (const measurement of measurements) {
    measured.add(measurement.surface);
    const budget = budgets.surfaces[measurement.surface];
    if (!budget) continue;

    for (const { metric, budgetKey } of METRICS) {
      const limit = budget[budgetKey];
      const value = measurement[metric];
      // A metric the surface does not report, or does not budget, is not a pass
      // or a failure — there is simply nothing to compare.
      if (typeof limit !== "number" || typeof value !== "number") continue;
      if (value > limit) violations.push({ surface: measurement.surface, metric, budget: limit, measured: value });
    }
  }

  const unmeasured = Object.keys(budgets.surfaces).filter((surface) => !measured.has(surface));
  const unbudgeted = [...measured].filter((surface) => !budgets.surfaces[surface]);

  return {
    violations,
    unmeasured,
    unbudgeted,
    passed: violations.length === 0 && unmeasured.length === 0,
  };
}

function formatMetric(metric: BudgetViolation["metric"], value: number): string {
  if (metric === "queryCount") return `${value} queries`;
  if (metric === "responseBytes") return `${(value / 1024).toFixed(1)} KiB`;
  return `${value.toFixed(1)} ms`;
}

export function formatBudgetReport(comparison: BudgetComparison, measurements: readonly SurfaceMeasurement[]): string {
  const lines = measurements.map(
    (measurement) =>
      `  ${measurement.surface}: ${measurement.queryCount} queries, ` +
      `db ${measurement.databaseDurationMs.toFixed(1)} ms, total ${measurement.totalDurationMs.toFixed(1)} ms` +
      (typeof measurement.responseBytes === "number" ? `, ${(measurement.responseBytes / 1024).toFixed(1)} KiB` : ""),
  );

  for (const surface of comparison.unmeasured) lines.push(`  ${surface}: NOT MEASURED`);
  for (const surface of comparison.unbudgeted) lines.push(`  ${surface}: no budget declared`);
  for (const violation of comparison.violations) {
    lines.push(
      `  OVER BUDGET ${violation.surface} ${violation.metric}: ` +
        `${formatMetric(violation.metric, violation.measured)} > ${formatMetric(violation.metric, violation.budget)}`,
    );
  }

  return lines.join("\n");
}
