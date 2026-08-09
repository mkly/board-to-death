import { RuntimeConfigError } from "./config/public-env.ts";
import { getRuntimeConfig } from "./config/runtime-env.server.ts";
import { writeSync } from "node:fs";

try {
  getRuntimeConfig();
} catch (error) {
  if (!(error instanceof RuntimeConfigError)) {
    throw error;
  }

  writeSync(2, `${error.message}\n`);

  // On a managed serverless host there is no orchestrator watching exit codes:
  // process.exit() kills the invocation with an opaque runtime error and takes
  // the request down with no attribution. Rethrowing surfaces the config
  // issue in the platform's function logs instead.
  if (process.env.VERCEL) {
    throw error;
  }

  // Next.js reports instrumentation failures as an unhandled rejection
  // without stopping the process, which would leave a misconfigured
  // server accepting traffic. Write synchronously and exit immediately so
  // orchestration treats a bad config as a failed start instead of a
  // running-but-broken one; process.exit() can otherwise race the async
  // stderr flush and drop the message.
  process.exit(1);
}
