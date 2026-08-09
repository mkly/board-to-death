import { RuntimeConfigError } from "./config/public-env.ts";
import { getRuntimeConfig } from "./config/runtime-env.server.ts";
import { writeSync } from "node:fs";

try {
  getRuntimeConfig();
} catch (error) {
  if (!(error instanceof RuntimeConfigError)) {
    throw error;
  }

  // Next.js reports instrumentation failures as an unhandled rejection
  // without stopping the process, which would leave a misconfigured
  // server accepting traffic. Write synchronously and exit immediately so
  // orchestration treats a bad config as a failed start instead of a
  // running-but-broken one; process.exit() can otherwise race the async
  // stderr flush and drop the message.
  writeSync(2, `${error.message}\n`);
  process.exit(1);
}
