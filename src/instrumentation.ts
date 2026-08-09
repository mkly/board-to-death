export async function register() {
  // Next.js calls register() in every runtime and compiles this module for all
  // of them, so the Node-only configuration guard has to live in a module that
  // the Edge bundle never pulls in. Importing node:fs or calling process.exit
  // from here fails the Edge compilation and takes middleware down with it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node.ts");
  }
}
