import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped database metrics.
 *
 * Everything recorded here is a count, a duration, or a Prisma
 * `model.operation` pair. Query arguments, selected rows, and connection
 * strings are deliberately never touched: a performance artifact is committed
 * to the repository and uploaded from CI, so it has to stay free of secrets
 * and of any single event's data. `query-metrics.test.ts` holds that line.
 */
export interface QueryMetricsSnapshot {
  readonly queryCount: number;
  readonly databaseDurationMs: number;
  /** `model.operation` (for example `cfpSubmission.findMany`) to call count. */
  readonly operations: Readonly<Record<string, number>>;
}

/** A Prisma `model.operation` pair, the only shape this module will record. */
const OPERATION_PATTERN = /^\$?[A-Za-z][A-Za-z0-9]*\.\$?[A-Za-z][A-Za-z0-9]*$/;

class QueryMetricsCollector {
  #queryCount = 0;
  #databaseDurationMs = 0;
  readonly #operations = new Map<string, number>();

  record(operation: string, durationMs: number): void {
    this.#queryCount += 1;
    this.#databaseDurationMs += durationMs;
    this.#operations.set(operation, (this.#operations.get(operation) ?? 0) + 1);
  }

  snapshot(): QueryMetricsSnapshot {
    return {
      queryCount: this.#queryCount,
      databaseDurationMs: round(this.#databaseDurationMs),
      operations: Object.fromEntries([...this.#operations].sort(([left], [right]) => left.localeCompare(right))),
    };
  }
}

const storage = new AsyncLocalStorage<QueryMetricsCollector>();

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Records one database round trip against the active scope. Operations that do
 * not look like a Prisma `model.operation` pair are bucketed as `unknown` rather
 * than passed through, so a caller cannot smuggle data into an artifact.
 */
export function recordQuery(operation: string, durationMs: number): void {
  storage.getStore()?.record(OPERATION_PATTERN.test(operation) ? operation : "unknown", Math.max(0, durationMs));
}

/** The metrics collected so far in the active scope, or `null` outside one. */
export function currentQueryMetrics(): QueryMetricsSnapshot | null {
  return storage.getStore()?.snapshot() ?? null;
}

export interface MeasuredQueryMetrics<T> {
  readonly result: T;
  readonly metrics: QueryMetricsSnapshot;
  readonly totalDurationMs: number;
}

/** Runs `operation` in a fresh metrics scope and returns its result alongside the totals. */
export async function withQueryMetrics<T>(operation: () => Promise<T>): Promise<MeasuredQueryMetrics<T>> {
  const collector = new QueryMetricsCollector();
  const startedAt = performance.now();
  const result = await storage.run(collector, operation);
  return { result, metrics: collector.snapshot(), totalDurationMs: round(performance.now() - startedAt) };
}

export interface ServerTimingInput {
  readonly metrics?: QueryMetricsSnapshot | null;
  readonly totalDurationMs?: number;
}

/**
 * Builds a `Server-Timing` header value. The `desc` carries the query count so a
 * client can read the count without a second channel; it never carries a query,
 * a route parameter, or an identifier.
 */
export function serverTimingHeader({ metrics, totalDurationMs }: ServerTimingInput): string {
  const entries: string[] = [];
  if (typeof totalDurationMs === "number") entries.push(`app;dur=${round(totalDurationMs)}`);
  if (metrics) {
    entries.push(`db;dur=${round(metrics.databaseDurationMs)};desc="queries=${metrics.queryCount}"`);
  }
  return entries.join(", ");
}

/** Parses the `db` and `app` entries back out of a `Server-Timing` header value. */
export function parseServerTiming(header: string | null): {
  readonly appDurationMs: number | null;
  readonly databaseDurationMs: number | null;
  readonly queryCount: number | null;
} {
  if (!header) return { appDurationMs: null, databaseDurationMs: null, queryCount: null };
  const app = /(?:^|,)\s*app;dur=([0-9.]+)/.exec(header);
  const database = /(?:^|,)\s*db;dur=([0-9.]+)/.exec(header);
  const queries = /desc="queries=(\d+)"/.exec(header);
  return {
    appDurationMs: app ? Number(app[1]) : null,
    databaseDurationMs: database ? Number(database[1]) : null,
    queryCount: queries ? Number(queries[1]) : null,
  };
}
