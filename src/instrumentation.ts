export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { getRuntimeConfig } = await import("./config/runtime-env.server.ts");
  const { RuntimeConfigError } = await import("./config/public-env.ts");

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
    const { writeSync } = await import("node:fs");
    writeSync(2, `${error.message}\n`);
    process.exit(1);
  }
}
