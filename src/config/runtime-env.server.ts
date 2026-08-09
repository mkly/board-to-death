import { z } from "zod";

import {
  type Environment,
  formatIssues,
  getRuntimeMode,
  getVercelDeploymentUrl,
  hasAllowedUrlProtocol,
  type PublicRuntimeConfig,
  parsePublicRuntimeConfig,
  RuntimeConfigError,
  type RuntimeMode,
} from "./public-env.ts";
import { isAbsolute } from "node:path";

const SERVER_KEYS = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "AUTH_ALLOWED_EMAILS",
  "AUTH_MAGIC_LINK_WEBHOOK_URL",
  "AUTH_MAGIC_LINK_WEBHOOK_TOKEN",
  "FILE_STORAGE_PATH",
] as const;
const REQUIRED_PRODUCTION_SERVER_KEYS = SERVER_KEYS.filter((key) => key !== "AUTH_MAGIC_LINK_WEBHOOK_TOKEN");

type ServerRuntimeKey = (typeof SERVER_KEYS)[number];
type ServerRuntimeValues = Partial<Record<ServerRuntimeKey, string>>;

const DEFAULTS: Record<Exclude<RuntimeMode, "production">, ServerRuntimeValues> = {
  development: {
    AUTH_SECRET: "local-development-auth-secret-change-me",
    DATABASE_URL: "postgresql://board_to_death:board_to_death@localhost:5432/board_to_death",
    BETTER_AUTH_SECRET: "local-development-better-auth-secret",
    BETTER_AUTH_URL: "http://localhost:3000",
    AUTH_ALLOWED_EMAILS: "admin@example.com",
    FILE_STORAGE_PATH: "./.data/files",
  },
  test: {
    AUTH_SECRET: "test-only-auth-secret-not-for-production",
    DATABASE_URL: "postgresql://board_to_death:board_to_death@localhost:5432/board_to_death_test",
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-not-for-production",
    BETTER_AUTH_URL: "http://localhost:3000",
    AUTH_ALLOWED_EMAILS: "admin@example.test",
    FILE_STORAGE_PATH: "./.data/test-files",
  },
};

const serverSchema = z.object({
  AUTH_SECRET: z.string().min(32, "must contain at least 32 characters"),
  DATABASE_URL: z
    .string()
    .url("must be a valid URL")
    .refine((value) => hasAllowedUrlProtocol(value, ["postgres:", "postgresql:"]), {
      message: "must use the postgres or postgresql protocol",
    }),
  BETTER_AUTH_SECRET: z.string().min(32, "must contain at least 32 characters"),
  BETTER_AUTH_URL: z
    .string()
    .url("must be a valid URL")
    .refine((value) => hasAllowedUrlProtocol(value, ["http:", "https:"]), {
      message: "must use the http or https protocol",
    }),
  AUTH_ALLOWED_EMAILS: z.string().refine(
    (value) =>
      value
        .split(",")
        .map((email) => email.trim())
        .some(Boolean),
    "must contain at least one email address",
  ),
  AUTH_MAGIC_LINK_WEBHOOK_URL: z
    .string()
    .url("must be a valid URL")
    .refine((value) => hasAllowedUrlProtocol(value, ["http:", "https:"]), {
      message: "must use the http or https protocol",
    })
    .optional(),
  AUTH_MAGIC_LINK_WEBHOOK_TOKEN: z.string().optional(),
  FILE_STORAGE_PATH: z.string().min(1, "must not be empty"),
});

export type ServerRuntimeConfig = z.infer<typeof serverSchema>;

// Vercel functions get a read-only filesystem with /tmp as the only writable
// location, and no stable per-deployment URL to hardcode. Supply both rather
// than failing the production check on values the platform cannot be told.
// /tmp is per-instance and ephemeral, so this is scratch space only.
export const VERCEL_FILE_STORAGE_PATH = "/tmp/board-to-death/files";

function getVercelDefaults(environment: Environment): ServerRuntimeValues {
  if (!environment.VERCEL) {
    return {};
  }

  const deploymentUrl = getVercelDeploymentUrl(environment);

  return {
    FILE_STORAGE_PATH: VERCEL_FILE_STORAGE_PATH,
    ...(deploymentUrl ? { BETTER_AUTH_URL: deploymentUrl } : {}),
  };
}

function getServerValues(environment: Environment, mode: RuntimeMode): ServerRuntimeValues {
  const vercelDefaults = getVercelDefaults(environment);
  const values = Object.fromEntries(
    SERVER_KEYS.map((key) => {
      const configuredValue = environment[key]?.trim();
      const defaultValue = mode === "production" ? vercelDefaults[key] : (DEFAULTS[mode][key] ?? vercelDefaults[key]);

      return [key, configuredValue || defaultValue];
    }),
  ) as Record<ServerRuntimeKey, string | undefined>;

  const requiredKeys = mode === "production" ? REQUIRED_PRODUCTION_SERVER_KEYS : SERVER_KEYS.slice(0, 5);
  const missing = requiredKeys.filter((key) => values[key] === undefined);

  if (missing.length > 0) {
    throw new RuntimeConfigError(missing.map((key) => `${key} is required when NODE_ENV=production`));
  }

  return values as ServerRuntimeValues;
}

export function parseServerRuntimeConfig(environment: Environment): ServerRuntimeConfig {
  const mode = getRuntimeMode(environment);
  const result = serverSchema.safeParse(getServerValues(environment, mode));

  if (!result.success) {
    throw new RuntimeConfigError(formatIssues(result.error));
  }

  if (mode === "production" && !isAbsolute(result.data.FILE_STORAGE_PATH)) {
    throw new RuntimeConfigError(["FILE_STORAGE_PATH must be an absolute path when NODE_ENV=production"]);
  }

  return result.data;
}

export function parseRuntimeConfig(environment: Environment): {
  public: PublicRuntimeConfig;
  server: ServerRuntimeConfig;
} {
  const issues: string[] = [];
  let publicConfig: PublicRuntimeConfig | undefined;
  let serverConfig: ServerRuntimeConfig | undefined;

  try {
    serverConfig = parseServerRuntimeConfig(environment);
  } catch (error) {
    if (!(error instanceof RuntimeConfigError)) {
      throw error;
    }
    issues.push(...error.issues);
  }

  try {
    publicConfig = parsePublicRuntimeConfig(environment);
  } catch (error) {
    if (!(error instanceof RuntimeConfigError)) {
      throw error;
    }
    issues.push(...error.issues);
  }

  if (!serverConfig || !publicConfig) {
    throw new RuntimeConfigError(issues);
  }

  return { public: publicConfig, server: serverConfig };
}

export function getRuntimeConfig() {
  return parseRuntimeConfig(process.env);
}
