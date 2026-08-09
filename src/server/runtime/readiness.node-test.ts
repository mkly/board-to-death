import { checkReadiness, createReadinessResponse } from "./readiness.ts";
import assert from "node:assert/strict";
import test from "node:test";

test("reports ready only after database and persistent storage probes succeed", async () => {
  const calls: string[] = [];
  const result = await checkReadiness({
    database: async () => {
      calls.push("database");
    },
    storage: async () => {
      calls.push("storage");
    },
  });

  assert.deepEqual(result, { ready: true });
  assert.deepEqual(calls.sort(), ["database", "storage"]);
});

test("reports failed check names without retaining secret-bearing provider errors", async () => {
  const secret = "postgresql://operator:do-not-leak@database/production";
  const result = await checkReadiness({
    database: async () => {
      throw new Error(secret);
    },
    storage: async () => {
      throw new Error("/mounted/private/storage");
    },
  });

  assert.deepEqual(result, { ready: false, failedChecks: ["database", "storage"] });
  assert.doesNotMatch(JSON.stringify(result), /do-not-leak|private/);
});

test("returns no-store HTTP readiness responses with useful but non-sensitive check names", async () => {
  const ready = createReadinessResponse({ ready: true });
  const unavailable = createReadinessResponse({ ready: false, failedChecks: ["database"] });

  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await ready.json(), { status: "ready", checks: { database: "up", storage: "up" } });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    status: "unavailable",
    checks: { database: "down", storage: "up" },
  });
});
