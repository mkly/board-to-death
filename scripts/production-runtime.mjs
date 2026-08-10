import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const SIGNALS = ["SIGINT", "SIGTERM"];

export class ProductionRuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionRuntimeError";
  }
}

export function loadMountedEnvironment(environment = process.env, loadEnvFile = process.loadEnvFile) {
  const environmentFile = environment.RUNTIME_ENV_FILE?.trim();
  if (!environmentFile) return;

  if (!isAbsolute(environmentFile)) {
    throw new ProductionRuntimeError("RUNTIME_ENV_FILE must be an absolute path");
  }

  try {
    loadEnvFile(environmentFile);
  } catch {
    throw new ProductionRuntimeError("RUNTIME_ENV_FILE could not be loaded");
  }
}

export async function prepareProductionRuntime({
  environment = process.env,
  loadEnvFile = process.loadEnvFile,
  makeDirectory = mkdir,
  checkAccess = access,
} = {}) {
  if (environment.NODE_ENV !== "production") {
    throw new ProductionRuntimeError("NODE_ENV must be production for production runtime commands");
  }

  loadMountedEnvironment(environment, loadEnvFile);
  const { parseRuntimeConfig } = await import("../src/config/runtime-env.server.ts");
  const config = parseRuntimeConfig(environment);

  if (config.server.FILE_STORAGE_DRIVER === "local") {
    try {
      await makeDirectory(config.server.FILE_STORAGE_PATH, { recursive: true, mode: 0o700 });
      await checkAccess(config.server.FILE_STORAGE_PATH, fsConstants.R_OK | fsConstants.W_OK);
    } catch {
      throw new ProductionRuntimeError("FILE_STORAGE_PATH could not be prepared for read/write access");
    }
  }

  return config;
}

export function runChild(command, args, options = {}) {
  const spawnChild = options.spawnChild ?? spawn;
  const child = spawnChild(command, args, {
    env: options.environment ?? process.env,
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function runNextServer(nextArguments = [], options = {}) {
  const processHost = options.processHost ?? process;
  const spawnChild = options.spawnChild ?? spawn;
  const child = spawnChild(process.execPath, ["node_modules/next/dist/bin/next", "start", ...nextArguments], {
    env: options.environment ?? process.env,
    stdio: "inherit",
  });
  const forwardSignal = (signal) => child.kill(signal);
  const handlers = new Map(SIGNALS.map((signal) => [signal, () => forwardSignal(signal)]));

  for (const [signal, handler] of handlers) processHost.on(signal, handler);

  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    for (const [signal, handler] of handlers) processHost.off(signal, handler);
  }
}

export async function executeRuntimeCommand(command, arguments_, dependencies = {}) {
  const prepare = dependencies.prepare ?? prepareProductionRuntime;
  const run = dependencies.run ?? runChild;
  const start = dependencies.start ?? runNextServer;

  await prepare();

  if (command === "validate") return { code: 0, signal: null };
  if (command === "migrate") {
    return run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  }
  if (command === "seed") return run(process.execPath, ["node_modules/prisma/build/index.js", "db", "seed"]);
  if (command === "start") return start(arguments_);

  throw new ProductionRuntimeError(`Unknown production runtime command: ${command ?? "(missing)"}`);
}

function exitCodeFor(result) {
  if (result.code !== null) return result.code;
  return result.signal ? 128 + (osConstants.signals[result.signal] ?? 0) : 1;
}

async function main() {
  try {
    const [command, ...arguments_] = process.argv.slice(2);
    const result = await executeRuntimeCommand(command, arguments_);
    if (command === "validate") process.stdout.write("Production runtime configuration and storage are ready.\n");
    process.exitCode = exitCodeFor(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Production runtime failed unexpectedly";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
