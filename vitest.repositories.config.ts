import { defineConfig } from "vitest/config";

import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: [
      "src/server/communications/bulk-dispatch.integration.ts",
      "src/server/communications/templates.integration.ts",
      "src/server/cfp/thank-you.integration.ts",
    ],
  },
});
