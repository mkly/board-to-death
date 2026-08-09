import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/server/communications/bulk-dispatch.integration.ts"],
  },
});
