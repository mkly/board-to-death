import { getTestDatabaseUrl } from "./test-database.mjs";
import { spawn } from "node:child_process";

const commandArguments = process.argv.slice(2);

if (commandArguments.length === 0) {
  throw new Error("Provide a command to run against TEST_DATABASE_URL");
}

const testDatabaseUrl = getTestDatabaseUrl();
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmExecutable, ["exec", "--", ...commandArguments], {
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
