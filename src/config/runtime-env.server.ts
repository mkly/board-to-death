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
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "FILE_STORAGE_DRIVER",
  "FILE_STORAGE_PATH",
  "FILE_STORAGE_S3_BUCKET",
  "FILE_STORAGE_S3_REGION",
  "FILE_STORAGE_S3_ENDPOINT",
  "FILE_STORAGE_S3_FORCE_PATH_STYLE",
] as const;
const REQUIRED_PRODUCTION_SERVER_KEYS = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "AUTH_ALLOWED_EMAILS",
] as const;

type ServerRuntimeKey = (typeof SERVER_KEYS)[number];
type ServerRuntimeValues = Partial<Record<ServerRuntimeKey, string>>;

const DEFAULTS: Record<Exclude<RuntimeMode, "production">, ServerRuntimeValues> = {
  development: {
    AUTH_SECRET: "local-development-auth-secret-change-me",
    DATABASE_URL: "postgresql://board_to_death:board_to_death@localhost:5432/board_to_death",
    BETTER_AUTH_SECRET: "local-development-better-auth-secret",
    BETTER_AUTH_URL: "http://localhost:3000",
    AUTH_ALLOWED_EMAILS: "admin@example.com",
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_PATH: "./.data/files",
  },
  test: {
    AUTH_SECRET: "test-only-auth-secret-not-for-production",
    DATABASE_URL: "postgresql://board_to_death:board_to_death@localhost:5432/board_to_death_test",
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-not-for-production",
    BETTER_AUTH_URL: "http://localhost:3000",
    AUTH_ALLOWED_EMAILS: "admin@example.test",
    FILE_STORAGE_DRIVER: "local",
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
  RESEND_API_KEY: z.string().min(1, "must not be empty").optional(),
  RESEND_FROM_EMAIL: z.string().email("must be a valid email address").optional(),
  FILE_STORAGE_DRIVER: z.enum(["local", "s3"], { message: "must be local or s3" }),
  FILE_STORAGE_PATH: z.string().min(1, "must not be empty").optional(),
  FILE_STORAGE_S3_BUCKET: z.string().min(1, "must not be empty").optional(),
  FILE_STORAGE_S3_REGION: z.string().min(1, "must not be empty").optional(),
  FILE_STORAGE_S3_ENDPOINT: z
    .string()
    .url("must be a valid URL")
    .refine((value) => hasAllowedUrlProtocol(value, ["http:", "https:"]), {
      message: "must use the http or https protocol",
    })
    .optional(),
  FILE_STORAGE_S3_FORCE_PATH_STYLE: z.enum(["true", "false"], { message: "must be true or false" }).optional(),
});

export type ServerRuntimeConfig = z.infer<typeof serverSchema>;

// Vercel functions get a read-only filesystem with /tmp as the only writable
// location, and no stable per-deployment URL to hardcode. Supply both rather
// than failing the production check on values the platform cannot be told.
// /tmp is per-instance and ephemeral, so this is scratch space only.
export const VERCEL_FILE_STORAGE_PATH = "/tmp/gatherpulse/files";

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

  // Production stores files in S3; the local-disk driver is the development
  // and test default and stays available only as explicit configuration.
  values.FILE_STORAGE_DRIVER ??= mode === "production" ? "s3" : "local";

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

  const hasResendApiKey = result.data.RESEND_API_KEY !== undefined;
  const hasResendFromEmail = result.data.RESEND_FROM_EMAIL !== undefined;

  if (hasResendApiKey !== hasResendFromEmail) {
    throw new RuntimeConfigError([
      `${hasResendApiKey ? "RESEND_FROM_EMAIL" : "RESEND_API_KEY"} is required when Resend delivery is configured`,
    ]);
  }

  if (mode === "production" && !result.data.AUTH_MAGIC_LINK_WEBHOOK_URL && !hasResendApiKey) {
    throw new RuntimeConfigError([
      "AUTH_MAGIC_LINK_WEBHOOK_URL or both RESEND_API_KEY and RESEND_FROM_EMAIL are required when NODE_ENV=production",
    ]);
  }

  if (result.data.FILE_STORAGE_DRIVER === "s3") {
    const missingS3Keys = (["FILE_STORAGE_S3_BUCKET", "FILE_STORAGE_S3_REGION"] as const).filter(
      (key) => result.data[key] === undefined,
    );
    if (missingS3Keys.length > 0) {
      throw new RuntimeConfigError(missingS3Keys.map((key) => `${key} is required when FILE_STORAGE_DRIVER=s3`));
    }
  } else {
    if (result.data.FILE_STORAGE_PATH === undefined) {
      throw new RuntimeConfigError([
        mode === "production"
          ? "FILE_STORAGE_PATH is required when NODE_ENV=production"
          : "FILE_STORAGE_PATH is required when FILE_STORAGE_DRIVER=local",
      ]);
    }
    if (mode === "production" && !isAbsolute(result.data.FILE_STORAGE_PATH)) {
      throw new RuntimeConfigError(["FILE_STORAGE_PATH must be an absolute path when NODE_ENV=production"]);
    }
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
