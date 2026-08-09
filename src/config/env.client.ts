import { parsePublicRuntimeConfig } from "@/config/public-env";

// Keep this object literal as the complete browser allowlist. Next.js only
// inlines statically referenced NEXT_PUBLIC_* variables into client bundles.
// The NEXT_PUBLIC_VERCEL_* entries are set by Vercel's "Automatically expose
// System Environment Variables" setting (on by default) and let a deployment
// that has not hardcoded NEXT_PUBLIC_APP_URL resolve its own origin — which is
// the only workable answer for preview deployments, since each one gets a
// different host.
export const publicEnv = parsePublicRuntimeConfig({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
  NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  NODE_ENV: process.env.NODE_ENV,
});
