import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

import { parsePublicRuntimeConfig } from "./src/config/public-env.ts";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
};

export default (phase) => {
  // Only the public config is checked here, and only NEXT_PUBLIC_APP_URL is
  // inlined into client code at build time. Server secrets (AUTH_SECRET,
  // DATABASE_URL) are validated fail-fast at process start in
  // instrumentation.ts instead, so CI and container image builds don't need
  // production credentials. A generic build (phase-production-build) also
  // falls back to the non-production default when NEXT_PUBLIC_APP_URL is
  // unset; a real deploy build still inlines whatever value it's given, and
  // `next start` re-validates strictly since it isn't that phase.
  const allowBuildDefault = phase === PHASE_PRODUCTION_BUILD;

  if (allowBuildDefault && !process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    console.warn(
      "NEXT_PUBLIC_APP_URL is unset during next build; client bundles will use http://localhost:3000. Set NEXT_PUBLIC_APP_URL for deploy builds.",
    );
  }

  parsePublicRuntimeConfig(process.env, { allowBuildDefault });

  return nextConfig;
};
