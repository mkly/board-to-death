import {
  executeRuntimeCommand,
  loadMountedEnvironment,
  ProductionRuntimeError,
  prepareProductionRuntime,
  runNextServer,
} from "./production-runtime.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function productionEnvironment(storagePath) {
  return {
    AUTH_ALLOWED_EMAILS: "admin@example.com",
    AUTH_MAGIC_LINK_WEBHOOK_URL: "https://mailer.example.com/magic-link",
    AUTH_SECRET: "production-auth-secret-with-enough-entropy",
    BETTER_AUTH_SECRET: "production-better-auth-secret-with-enough-entropy",
    BETTER_AUTH_URL: "https://events.example.com",
    DATABASE_URL: "postgresql://app:password@database.example.com:5432/board_to_death",
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_PATH: storagePath,
    NEXT_PUBLIC_APP_URL: "https://events.example.com",
    NODE_ENV: "production",
  };
}

test("production validation rejects missing configuration without echoing supplied secrets", async () => {
  const secret = "must-not-appear-in-errors";

  await assert.rejects(
    prepareProductionRuntime({ environment: { NODE_ENV: "production", AUTH_SECRET: secret } }),
    (error) => {
      assert.match(error.message, /DATABASE_URL is required/);
      assert.match(error.message, /BETTER_AUTH_SECRET is required/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("a mounted environment file must use an absolute path and loads without overriding the process API", () => {
  assert.throws(
    () => loadMountedEnvironment({ RUNTIME_ENV_FILE: "relative/runtime.env" }, () => undefined),
    (error) => error instanceof ProductionRuntimeError && /absolute path/.test(error.message),
  );

  let loadedPath;
  loadMountedEnvironment({ RUNTIME_ENV_FILE: "/run/secrets/board-to-death.env" }, (path) => {
    loadedPath = path;
  });
  assert.equal(loadedPath, "/run/secrets/board-to-death.env");
});

test("validation prepares the configured persistent storage path for restart-safe reuse", async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "board-to-death-runtime-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const storagePath = join(temporaryRoot, "mounted", "files");
  const environment = productionEnvironment(storagePath);

  const first = await prepareProductionRuntime({ environment });
  const second = await prepareProductionRuntime({ environment });

  assert.equal(first.server.FILE_STORAGE_PATH, storagePath);
  assert.equal(second.server.FILE_STORAGE_PATH, storagePath);
});

test("the S3 driver needs no local storage preparation", async () => {
  const environment = {
    ...productionEnvironment(undefined),
    FILE_STORAGE_DRIVER: undefined,
    FILE_STORAGE_PATH: undefined,
    FILE_STORAGE_S3_BUCKET: "board-to-death-files",
    FILE_STORAGE_S3_REGION: "us-east-1",
  };
  const refuse = async () => {
    throw new Error("the filesystem must not be touched for the S3 driver");
  };

  const config = await prepareProductionRuntime({ environment, makeDirectory: refuse, checkAccess: refuse });

  assert.equal(config.server.FILE_STORAGE_DRIVER, "s3");
  assert.equal(config.server.FILE_STORAGE_S3_BUCKET, "board-to-death-files");
});

test("migration failures are returned to the deployment caller and prevent startup", async () => {
  let starts = 0;
  const result = await executeRuntimeCommand("migrate", [], {
    prepare: async () => undefined,
    run: async () => ({ code: 17, signal: null }),
    start: async () => {
      starts += 1;
      return { code: 0, signal: null };
    },
  });

  assert.deepEqual(result, { code: 17, signal: null });
  assert.equal(starts, 0);
});

test("the launcher forwards graceful shutdown signals and removes handlers before restart", async () => {
  const processHost = new EventEmitter();
  const receivedSignals = [];
  const children = [];
  const spawnChild = () => {
    const child = new EventEmitter();
    child.kill = (signal) => {
      receivedSignals.push(signal);
      queueMicrotask(() => child.emit("exit", null, signal));
      return true;
    };
    children.push(child);
    return child;
  };

  const firstRun = runNextServer([], { processHost, spawnChild });
  processHost.emit("SIGTERM");
  assert.deepEqual(await firstRun, { code: null, signal: "SIGTERM" });
  assert.deepEqual(receivedSignals, ["SIGTERM"]);
  assert.equal(processHost.listenerCount("SIGTERM"), 0);
  assert.equal(processHost.listenerCount("SIGINT"), 0);

  const secondRun = runNextServer([], { processHost, spawnChild });
  queueMicrotask(() => children[1].emit("exit", 0, null));
  assert.deepEqual(await secondRun, { code: 0, signal: null });
  assert.equal(processHost.listenerCount("SIGTERM"), 0);
  assert.equal(processHost.listenerCount("SIGINT"), 0);
});
