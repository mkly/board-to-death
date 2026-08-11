import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

import type { NextConfig } from "next";

import { parsePublicRuntimeConfig } from "./src/config/public-env.ts";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    serverActions: {
      // Speaker file uploads are Server Actions, and Next.js caps action
      // request bodies at 1MB by default — far below the per-purpose limits
      // enforced in src/server/speakers/file-policy.ts (slides allow 50 MB,
      // the largest). Raise the transport cap past the largest policy limit
      // plus multipart overhead so file-policy.ts stays the only place that
      // decides what is too big; a rejected upload then reports its real
      // reason instead of failing as an unhandled request. This supersedes the
      // earlier 6mb cap, which every other action body still fits under.
      bodySizeLimit: "52mb",
    },
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
};

export default (phase: string): NextConfig => {
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
