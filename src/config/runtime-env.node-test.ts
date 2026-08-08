import { parsePublicRuntimeConfig, RuntimeConfigError } from "./public-env.ts";
import { parseRuntimeConfig, parseServerRuntimeConfig } from "./runtime-env.server.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const productionEnvironment = {
  AUTH_SECRET: "a-production-secret-with-enough-entropy",
  DATABASE_URL: "postgresql://app:password@database.example.com:5432/board_to_death",
  NEXT_PUBLIC_APP_URL: "https://events.example.com",
  NODE_ENV: "production",
} as const;

const productionProcessEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !["AUTH_SECRET", "DATABASE_URL", "NEXT_PUBLIC_APP_URL", "NEXT_RUNTIME"].includes(key),
  ),
);

function runNodeModule(source: string, environment: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "--eval", source],
    {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
      env: environment,
    },
  );
}

test("development and test use isolated local defaults", () => {
  const development = parseServerRuntimeConfig({ NODE_ENV: "development" });
  const testConfig = parseServerRuntimeConfig({ NODE_ENV: "test" });

  assert.match(development.DATABASE_URL, /\/board_to_death$/);
  assert.match(testConfig.DATABASE_URL, /\/board_to_death_test$/);
  assert.notEqual(development.AUTH_SECRET, testConfig.AUTH_SECRET);
});

test("production requires every configured server and public value", () => {
  assert.throws(
    () => parseRuntimeConfig({ NODE_ENV: "production" }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeConfigError);
      assert.deepEqual(error.issues, [
        "AUTH_SECRET is required when NODE_ENV=production",
        "DATABASE_URL is required when NODE_ENV=production",
        "NEXT_PUBLIC_APP_URL is required when NODE_ENV=production",
      ]);
      return true;
    },
  );
});

test("invalid supplied values fail in development, test, and production", () => {
  for (const NODE_ENV of ["development", "test", "production"] as const) {
    assert.throws(
      () =>
        parseServerRuntimeConfig({
          ...productionEnvironment,
          AUTH_SECRET: "too-short",
          DATABASE_URL: "ftp://database.example.com/board_to_death",
          NODE_ENV,
        }),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeConfigError);
        assert.match(error.message, /AUTH_SECRET must contain at least 32 characters/);
        assert.match(error.message, /DATABASE_URL must use the postgres or postgresql protocol/);
        assert.doesNotMatch(error.message, /too-short|ftp|database\.example\.com/);
        return true;
      },
    );

    assert.throws(
      () =>
        parsePublicRuntimeConfig({
          ...productionEnvironment,
          NEXT_PUBLIC_APP_URL: "javascript:alert('unsafe')",
          NODE_ENV,
        }),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeConfigError);
        assert.match(error.message, /NEXT_PUBLIC_APP_URL must use the http or https protocol/);
        assert.doesNotMatch(error.message, /javascript|alert/);
        return true;
      },
    );
  }
});

test("malformed URLs produce keyed runtime configuration errors in every mode", () => {
  for (const NODE_ENV of ["development", "test", "production"] as const) {
    assert.throws(
      () =>
        parseServerRuntimeConfig({
          ...productionEnvironment,
          DATABASE_URL: "not-a-url",
          NODE_ENV,
        }),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeConfigError);
        assert.match(error.message, /DATABASE_URL must be a valid URL/);
        assert.doesNotMatch(error.message, /not-a-url|TypeError|Invalid URL/);
        return true;
      },
    );

    assert.throws(
      () =>
        parsePublicRuntimeConfig({
          ...productionEnvironment,
          NEXT_PUBLIC_APP_URL: "not-a-url",
          NODE_ENV,
        }),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeConfigError);
        assert.match(error.message, /NEXT_PUBLIC_APP_URL must be a valid URL/);
        assert.doesNotMatch(error.message, /not-a-url|TypeError|Invalid URL/);
        return true;
      },
    );
  }
});

test("the public parser returns only its explicit allowlist", () => {
  const publicConfig = parsePublicRuntimeConfig(productionEnvironment);

  assert.deepEqual(publicConfig, {
    NEXT_PUBLIC_APP_URL: "https://events.example.com",
  });
  assert.equal("AUTH_SECRET" in publicConfig, false);
  assert.equal("DATABASE_URL" in publicConfig, false);
});

test("a generic production build falls back when NEXT_PUBLIC_APP_URL is unset", () => {
  const publicConfig = parsePublicRuntimeConfig({ NODE_ENV: "production" }, { allowBuildDefault: true });

  assert.deepEqual(publicConfig, { NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
});

test("the public parser requires NEXT_PUBLIC_APP_URL in production without a build fallback", () => {
  assert.throws(
    () => parsePublicRuntimeConfig({ NODE_ENV: "production" }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeConfigError);
      assert.deepEqual(error.issues, ["NEXT_PUBLIC_APP_URL is required when NODE_ENV=production"]);
      return true;
    },
  );
});

test("next config loads for production builds without server credentials and warns about the public fallback", () => {
  const result = runNodeModule(
    `
      import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
      import loadConfig from "./next.config.mjs";
      loadConfig(PHASE_PRODUCTION_BUILD);
    `,
    { ...productionProcessEnvironment, NODE_ENV: "production" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /NEXT_PUBLIC_APP_URL is unset during next build/);
  assert.match(result.stderr, /http:\/\/localhost:3000/);
  assert.doesNotMatch(result.stderr, /AUTH_SECRET|DATABASE_URL/);
});

test("instrumentation exits production startup with key-only runtime configuration errors", () => {
  const authSecret = "leaked-auth-secret";
  const databaseUrl = "leaked-database-url";
  const result = runNodeModule(`import { register } from "./src/instrumentation.ts"; await register();`, {
    ...productionProcessEnvironment,
    AUTH_SECRET: authSecret,
    DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_APP_URL: productionEnvironment.NEXT_PUBLIC_APP_URL,
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /AUTH_SECRET must contain at least 32 characters/);
  assert.match(result.stderr, /DATABASE_URL must be a valid URL/);
  assert.doesNotMatch(
    result.stderr,
    new RegExp(`${authSecret}|${databaseUrl}|${productionEnvironment.NEXT_PUBLIC_APP_URL}`),
  );
  assert.doesNotMatch(result.stderr, /NEXT_PUBLIC_APP_URL/);
});

test("a real deploy build still inlines an explicitly configured NEXT_PUBLIC_APP_URL", () => {
  const publicConfig = parsePublicRuntimeConfig(
    { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://events.example.com" },
    { allowBuildDefault: true },
  );

  assert.deepEqual(publicConfig, { NEXT_PUBLIC_APP_URL: "https://events.example.com" });
});

test("the client entry point never references server-only keys", async () => {
  const clientModule = await readFile(new URL("./env.client.ts", import.meta.url), "utf8");
  const publicModule = await readFile(new URL("./public-env.ts", import.meta.url), "utf8");

  assert.doesNotMatch(clientModule, /AUTH_SECRET|DATABASE_URL/);
  assert.doesNotMatch(publicModule, /AUTH_SECRET|DATABASE_URL/);
  assert.match(clientModule, /process\.env\.NEXT_PUBLIC_APP_URL/);
});
