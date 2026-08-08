#!/usr/bin/env node
// Run Biome over only the files that changed, using the reduced-rule
// biome.fast.json config.
//
// Biome's project rules (noFloatingPromises, noMisusedPromises, noImportCycles,
// noUndeclaredDependencies, noUnnecessaryConditions, useNullishCoalescing) build
// a whole-project module graph before linting anything, so a one-file run costs
// the same minutes as a full-repo run. biome.fast.json turns those rules off;
// what remains is per-file and finishes in milliseconds. `npm run check` still
// runs the full rule set and stays the authoritative gate.

import { spawnSync } from "node:child_process";
import process from "node:process";

const EXTENSIONS = /\.(m?[jt]sx?|c[jt]s|json|jsonc|css|html)$/;

const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  return result.stdout.split("\n").filter(Boolean);
};

const args = process.argv.slice(2);
const writeIndex = args.indexOf("--write");
const write = writeIndex !== -1;
if (write) args.splice(writeIndex, 1);

const sinceArg = args.find((arg) => arg.startsWith("--since="));
const since = sinceArg ? sinceArg.slice("--since=".length) : "HEAD";
const explicit = args.filter((arg) => !arg.startsWith("--"));

const files = (
  explicit.length > 0
    ? explicit
    : [...git("diff", "--name-only", "--diff-filter=ACMR", since), ...git("ls-files", "--others", "--exclude-standard")]
).filter((file) => EXTENSIONS.test(file));

const unique = [...new Set(files)];

if (unique.length === 0) {
  console.log(`No changed files to check (since ${since}).`);
  process.exit(0);
}

const biome = spawnSync(
  "npx",
  ["--no-install", "biome", "check", "--config-path=biome.fast.json", ...(write ? ["--write"] : []), ...unique],
  { stdio: "inherit" },
);

process.exit(biome.status ?? 1);
