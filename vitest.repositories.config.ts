import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/server/communications/bulk-dispatch.integration.ts",
      "src/server/communications/templates.integration.ts",
      "src/server/cfp/thank-you.integration.ts",
    ],
  },
});
