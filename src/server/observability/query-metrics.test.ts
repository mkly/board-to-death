import { describe, expect, it } from "vitest";

import {
  currentQueryMetrics,
  parseServerTiming,
  recordQuery,
  serverTimingHeader,
  withQueryMetrics,
} from "./query-metrics.ts";

describe("query metrics", () => {
  it("counts queries and sums durations inside a scope", async () => {
    const { result, metrics } = await withQueryMetrics(async () => {
      recordQuery("cfpSubmission.findMany", 10);
      recordQuery("cfpSubmission.findMany", 5);
      recordQuery("speaker.findMany", 2.5);
      return "done";
    });

    expect(result).toBe("done");
    expect(metrics.queryCount).toBe(3);
    expect(metrics.databaseDurationMs).toBe(17.5);
    expect(metrics.operations).toEqual({ "cfpSubmission.findMany": 2, "speaker.findMany": 1 });
  });

  it("records nothing outside a scope", () => {
    recordQuery("cfpSubmission.findMany", 10);
    expect(currentQueryMetrics()).toBeNull();
  });

  it("keeps concurrent scopes separate", async () => {
    const [left, right] = await Promise.all([
      withQueryMetrics(async () => {
        await Promise.resolve();
        recordQuery("speaker.findMany", 1);
      }),
      withQueryMetrics(async () => {
        recordQuery("programSession.findMany", 2);
        await Promise.resolve();
        recordQuery("programSession.findMany", 3);
      }),
    ]);

    expect(left.metrics.queryCount).toBe(1);
    expect(right.metrics.queryCount).toBe(2);
  });

  // The snapshot travels into CI artifacts, so it must never carry submission
  // content, speaker identities, or anything else pulled from `args`.
  it("reduces anything that is not a model.operation pair to `unknown`", async () => {
    const { metrics } = await withQueryMetrics(async () => {
      recordQuery("cfpSubmission.findMany WHERE email = 'speaker@example.test'", 1);
      recordQuery("SELECT * FROM cfp_submissions", 1);
      recordQuery("$raw.$queryRaw", 1);
    });

    expect(Object.keys(metrics.operations).sort()).toEqual(["$raw.$queryRaw", "unknown"]);
    expect(metrics.operations.unknown).toBe(2);
  });

  it("clamps negative durations rather than crediting them", async () => {
    const { metrics } = await withQueryMetrics(async () => {
      recordQuery("speaker.findMany", -50);
    });

    expect(metrics.databaseDurationMs).toBe(0);
  });

  it("round-trips a Server-Timing header", () => {
    const header = serverTimingHeader({
      metrics: { queryCount: 7, databaseDurationMs: 42.375, operations: {} },
      totalDurationMs: 91.5,
    });

    expect(header).toBe('app;dur=91.5, db;dur=42.38;desc="queries=7"');
    expect(parseServerTiming(header)).toEqual({ appDurationMs: 91.5, databaseDurationMs: 42.38, queryCount: 7 });
  });

  it("parses a missing header into nulls", () => {
    expect(parseServerTiming(null)).toEqual({ appDurationMs: null, databaseDurationMs: null, queryCount: null });
  });
});
