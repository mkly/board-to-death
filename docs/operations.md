# Production operations

Board to Death runs as a self-hosted Next.js Node server with PostgreSQL and a persistent local file volume. Put a
reverse proxy in front of the application and keep both the database and file volume on durable, backed-up storage.

## Install and configure

Use the pinned Node.js and npm versions from `.nvmrc`, then install from the committed lockfile:

```sh
nvm use
npm ci
```

Supply secrets as process environment variables, or mount a `KEY=VALUE` file and set `RUNTIME_ENV_FILE` to its
absolute path. Existing process environment values take precedence over values in the mounted file. Restrict the file
to the service account and never copy it into the repository or application image.

Production requires `AUTH_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_ALLOWED_EMAILS`,
`AUTH_MAGIC_LINK_WEBHOOK_URL`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, and an absolute `FILE_STORAGE_PATH`.
`AUTH_MAGIC_LINK_WEBHOOK_TOKEN` is optional when the delivery endpoint does not authenticate requests. The configured
file path is created with service-account-only permissions when absent and must live on a persistent mounted volume.

Validate configuration and storage access without printing values:

```sh
NODE_ENV=production npm run runtime:validate
```

## Build and release

Build the release artifact on the pinned toolchain. `NEXT_PUBLIC_APP_URL` is embedded in browser assets at build time,
so set it to the production origin for this command:

```sh
NODE_ENV=production NEXT_PUBLIC_APP_URL=https://events.example.com npm run build
```

Apply committed migrations as a release step. A nonzero result stops the release; do not start the new application
version after a failed migration.

```sh
NODE_ENV=production npm run runtime:migrate
```

Seeding is never part of startup or migration. Run it only when explicitly intended:

```sh
NODE_ENV=production npm run runtime:seed
```

After the build and release-time Prisma commands, remove development-only packages from the deployed tree and start
the server:

```sh
npm prune --omit=dev
NODE_ENV=production npm run start -- --hostname 127.0.0.1 --port 3000
```

The launcher validates configuration and the file volume again before starting Next.js. It forwards `SIGINT` and
`SIGTERM`; allow 10–30 seconds for Next.js to drain in-flight requests before an orchestrator sends `SIGKILL`.

## Health and restart

`GET /api/health` returns `200` only when PostgreSQL answers a query and `FILE_STORAGE_PATH` is readable and writable.
It returns `503` with only the failed check names otherwise; provider errors, URLs, paths, and credentials are never
included. Do not route user traffic until the endpoint reports `ready`, and remove the instance from rotation before
sending its shutdown signal.

A restart uses the same start command and persistent paths. Do not run migrations or seed automatically on restart.
The deployment service should use a bounded restart policy for unexpected exits and should not restart a configuration
or migration failure indefinitely.

## Persistence, backup, and recovery

Back up PostgreSQL and the volume mounted at `FILE_STORAGE_PATH` together according to the application's recovery-point
requirements. The `.next` directory is a replaceable build artifact, not application data. Restore the database and
file volume to a consistent point, validate configuration, run `runtime:migrate`, then start and wait for `/api/health`.

For a failed Prisma deployment migration, inspect `npm run db:status`, repair with a forward migration or documented
`prisma migrate resolve` procedure, and rerun `runtime:migrate`. Never edit a successfully applied migration in place.
