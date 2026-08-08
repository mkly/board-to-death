import { parsePublicRuntimeConfig } from "@/config/public-env";

// Keep this object literal as the complete browser allowlist. Next.js only
// inlines statically referenced NEXT_PUBLIC_* variables into client bundles.
export const publicEnv = parsePublicRuntimeConfig({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NODE_ENV: process.env.NODE_ENV,
});
