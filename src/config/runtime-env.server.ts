import { z } from "zod";

import {
  type Environment,
  formatIssues,
  getRuntimeMode,
  hasAllowedUrlProtocol,
  type PublicRuntimeConfig,
  parsePublicRuntimeConfig,
  RuntimeConfigError,
  type RuntimeMode,
} from "./public-env.ts";

const SERVER_KEYS = ["AUTH_SECRET", "DATABASE_URL"] as const;

type ServerRuntimeKey = (typeof SERVER_KEYS)[number];
type ServerRuntimeValues = Record<ServerRuntimeKey, string>;

const DEFAULTS: Record<Exclude<RuntimeMode, "production">, ServerRuntimeValues> = {
  development: {
    AUTH_SECRET: "local-development-auth-secret-change-me",
    DATABASE_URL: "postgresql://board_to_death:board_to_death@localhost:5432/board_to_death",
  },
  test: {
    AUTH_SECRET: "test-only-auth-secret-not-for-production",
    DATABASE_URL: "postgresql://board_to_death:board_to_death@localhost:5432/board_to_death_test",
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
});

export type ServerRuntimeConfig = z.infer<typeof serverSchema>;

function getServerValues(environment: Environment, mode: RuntimeMode): ServerRuntimeValues {
  const values = Object.fromEntries(
    SERVER_KEYS.map((key) => {
      const configuredValue = environment[key]?.trim();
      const defaultValue = mode === "production" ? undefined : DEFAULTS[mode][key];

      return [key, configuredValue || defaultValue];
    }),
  ) as Record<ServerRuntimeKey, string | undefined>;

  const missing = SERVER_KEYS.filter((key) => values[key] === undefined);

  if (missing.length > 0) {
    throw new RuntimeConfigError(missing.map((key) => `${key} is required when NODE_ENV=production`));
  }

  return values as ServerRuntimeValues;
}

export function parseServerRuntimeConfig(environment: Environment): ServerRuntimeConfig {
  const result = serverSchema.safeParse(getServerValues(environment, getRuntimeMode(environment)));

  if (!result.success) {
    throw new RuntimeConfigError(formatIssues(result.error));
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
