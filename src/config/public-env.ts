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

function getPublicAppUrl(environment: Environment, mode: RuntimeMode, options: PublicRuntimeConfigOptions): string {
  const configuredValue = environment.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredValue) {
    return configuredValue;
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
