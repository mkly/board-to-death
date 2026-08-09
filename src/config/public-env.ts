import { z } from "zod";

const RUNTIME_MODES = ["development", "test", "production"] as const;

export function hasAllowedUrlProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    // Let the preceding Zod URL validator report malformed values with the key.
    return true;
  }
}

export type RuntimeMode = (typeof RUNTIME_MODES)[number];
export type Environment = Readonly<Record<string, string | undefined>>;

export const PUBLIC_RUNTIME_KEYS = ["NEXT_PUBLIC_APP_URL"] as const;

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url("must be a valid URL")
    .refine((value) => hasAllowedUrlProtocol(value, ["http:", "https:"]), {
      message: "must use the http or https protocol",
    }),
});

export type PublicRuntimeConfig = z.infer<typeof publicSchema>;

export class RuntimeConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid runtime configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "RuntimeConfigError";
    this.issues = issues;
  }
}

export function getRuntimeMode(environment: Environment): RuntimeMode {
  const mode = environment.NODE_ENV ?? "development";

  if (!isRuntimeMode(mode)) {
    throw new RuntimeConfigError([
      `NODE_ENV must be one of ${RUNTIME_MODES.join(", ")}; received an unsupported value`,
    ]);
  }

  return mode;
}

function isRuntimeMode(value: string): value is RuntimeMode {
  return RUNTIME_MODES.some((runtimeMode) => runtimeMode === value);
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const key = issue.path[0];
    return `${typeof key === "string" ? key : "environment"} ${issue.message}`;
  });
}

export type PublicRuntimeConfigOptions = {
  // next build forces NODE_ENV=production before a deployable NEXT_PUBLIC_APP_URL
  // is necessarily known (e.g. a generic CI health-check build). Let those builds
  // fall back to the non-production default instead of failing; a real deploy
  // build still inlines whatever value the build environment provides.
  allowBuildDefault?: boolean;
};

// Vercel assigns a different host to every deployment and never sets our own
// origin variables, so a deploy that does not hardcode an origin would fail
// the production check outright — and hardcoding one value breaks every
// preview deployment, which each get their own host. VERCEL_URL is the
// unique per-deployment host; VERCEL_PROJECT_PRODUCTION_URL is the stable
// production domain, which is the right origin for auth callbacks and links
// in production. Neither carries a protocol; Vercel deployments are HTTPS.
// The NEXT_PUBLIC_* twins are the same values under the names Vercel exposes
// to client bundles; only those can be inlined into browser code.
export function getVercelDeploymentUrl(environment: Environment): string | undefined {
  const productionHost = (
    environment.VERCEL_PROJECT_PRODUCTION_URL ?? environment.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
  )?.trim();
  const deploymentHost = (environment.VERCEL_URL ?? environment.NEXT_PUBLIC_VERCEL_URL)?.trim();
  const deploymentEnvironment = environment.VERCEL_ENV ?? environment.NEXT_PUBLIC_VERCEL_ENV;
  const host = deploymentEnvironment === "production" ? productionHost || deploymentHost : deploymentHost;

  return host ? `https://${host}` : undefined;
}

function getPublicAppUrl(environment: Environment, mode: RuntimeMode, options: PublicRuntimeConfigOptions): string {
  const configuredValue = environment.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredValue) {
    return configuredValue;
  }

  const vercelUrl = getVercelDeploymentUrl(environment);

  if (vercelUrl) {
    return vercelUrl;
  }

  if (mode !== "production" || options.allowBuildDefault) {
    return "http://localhost:3000";
  }

  throw new RuntimeConfigError(["NEXT_PUBLIC_APP_URL is required when NODE_ENV=production"]);
}

export function parsePublicRuntimeConfig(
  environment: Environment,
  options: PublicRuntimeConfigOptions = {},
): PublicRuntimeConfig {
  const result = publicSchema.safeParse({
    NEXT_PUBLIC_APP_URL: getPublicAppUrl(environment, getRuntimeMode(environment), options),
  });

  if (!result.success) {
    throw new RuntimeConfigError(formatIssues(result.error));
  }

  return result.data;
}
