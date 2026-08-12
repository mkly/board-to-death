# Production operations

GatherPulse runs as a self-hosted Next.js Node server with PostgreSQL and a persistent local file volume. Put a
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

Production requires `AUTH_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_ALLOWED_EMAILS`, `DATABASE_URL`,
`NEXT_PUBLIC_APP_URL`, and file storage configuration. `FILE_STORAGE_DRIVER` defaults to `s3` in production, which
requires `FILE_STORAGE_S3_BUCKET` and `FILE_STORAGE_S3_REGION`; AWS credentials come from the standard SDK provider
chain (environment variables, profile, or instance/task role) and are never configured through the app's own keys.
`FILE_STORAGE_S3_ENDPOINT` and `FILE_STORAGE_S3_FORCE_PATH_STYLE` are optional, for S3-compatible stores such as
MinIO or R2. Setting `FILE_STORAGE_DRIVER=local` instead requires an absolute `FILE_STORAGE_PATH`; that path is
created with service-account-only permissions when absent and must live on a persistent mounted volume.

Production also requires a way to deliver magic links: either `AUTH_MAGIC_LINK_WEBHOOK_URL`, or both
`RESEND_API_KEY` and `RESEND_FROM_EMAIL` together. Setting only one of the Resend pair is rejected the same as
setting neither. `AUTH_MAGIC_LINK_WEBHOOK_TOKEN` is optional when the delivery endpoint does not authenticate
requests.

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

The Playwright test runner does not use this production launcher by default. `npm run test:browser` starts `npm run dev`
on `127.0.0.1:3100`, which keeps browser tests independent of production-only storage and secret requirements. Use
`PLAYWRIGHT_WEB_SERVER_COMMAND` only when the suite should start a different server command.

## Seed and demo access

`npm run runtime:seed` replaces the deterministic demo event at slug `board-to-death-demo`; rerunning it reuses the
same IDs instead of duplicating records, so it is safe to run again after a redeploy. The fixture includes a CFP form
and accepted submission, a speaker and session, an onboarding assignment, an evaluation plan and reviewer, an agenda
placement, and a completed Accelevents-style speaker resource sync.

The fixture labels its actors `demo-admin` and `demo-reviewer` and uses `ada@example.test` and
`reviewer@example.test`. These are data labels, not login accounts: seeding creates no passwords or authentication
sessions. To reach the demo event as an operator, the signed-in user needs an active membership in the demo event's
organization or an active organizer membership on the event.
Its integration configuration points at `local://adapters/accelevents/board-to-death-demo`, a deterministic local
adapter reference used only by the fixture, not a production credential.

### Tabletop Guild demo organization

The seed also creates a fuller demo organization, **Tabletop Guild** (slug `tabletop-guild`, IDs under the
`20000000-…` UUID prefix), with two events:

- **`protospiel-summit-2026`** — a post-CFP conference (Portland, Oct 16–19 2026) exercising most of the product:
  rooms, tracks, and CFP categories; a closed CFP with eight submissions covering every status from draft to
  confirmed; a two-round evaluation plan (closed blind screening, open identified final round) with reviewers, a
  program committee, completed and draft evaluations, a round advancement, and decisions; four program sessions
  (three promoted from submissions plus a manual keynote) with agenda placements and a published program snapshot;
  speaker task assignments in three states, communication templates, a reminder rule, and a message delivery with
  one delivered and one hard-bounced recipient; a speaker resource page; sponsor and exhibitor tiers, groups, and a
  published exhibitor intake form with pending and accepted submissions; file requests against a group and a
  submission; custom fields; a speaker-sourcing pipeline with an interest form, four stages, and three prospects; a
  participant portal, a saved session report, and a submissions-pipeline dashboard.
- **`winter-playtest-nights-2026`** — an early-stage meetup (Seattle, Dec 4–5 2026) with an open published CFP, one
  submitted proposal, and a sourcing prospect assigned to it from the summit's pipeline.

Unlike the representative fixture, this seed **does create login-capable users**. Five `user` rows are seeded with
verified emails, so anyone who can receive (or read the dev-server log for) a magic link can sign in as them:

| Email | Name | Org role |
| --- | --- | --- |
| `mike@tabletopguild.test` | Mike Lay | Owner |
| `priya@tabletopguild.test` | Priya Raman | Owner |
| `marcus@tabletopguild.test` | Marcus Webb | Member |
| `elena@tabletopguild.test` | Elena Vasquez | Member |
| `tomas@tabletopguild.test` | Tomás Ferreira | Member |

Mike, Priya, and Marcus hold `ORGANIZER_ADMIN` event memberships on the summit (Mike and Marcus also on the
playtest event); Elena and Tomás are `REVIEWER`s on the summit. In development the magic-link URL is printed to the
dev-server console (`[auth] Magic link for <email>: <url>`), so no mailbox is needed. Because these are real,
verified accounts, do not run this seed against a production database unless you intend those emails to grant demo
access there. The other seeded people (`*@example.test` speakers, contacts, and prospects) have no dashboard user
accounts.

The speaker portal does not use dashboard accounts at all: `/portal/{eventSlug}/sign-in` emails a short-lived,
event-scoped link to any address that matches an event speaker record. The seeded summit speakers therefore work as
portal logins — enter, for example, `amara.osei@example.test` at `/portal/protospiel-summit-2026/sign-in` and use the
magic-link URL from the dev-server console to see the speaker's own submissions, onboarding tasks, profile, and
files. Sponsors, exhibitors, applicants, and prospects have no login of any kind by design; they are reached through
contact records and the public CFP, interest, and intake forms.

Rerunning the seed deletes and recreates both demo events and the organization's members, invitations, and people,
so manual changes inside the demo org are discarded on reseed.

Seeding is not part of `runtime:migrate` or application startup — it only runs when invoked explicitly (`npm run
runtime:seed` in production, `npm run db:seed` otherwise). Running it against a database that already has real event
data is safe as long as nothing else uses the `board-to-death-demo`, `protospiel-summit-2026`, or
`winter-playtest-nights-2026` slugs or the `tabletop-guild` organization slug.

## Integration adapters and credentials

External integrations, currently Accelevents, are accessed through an adapter interface (`AcceleventsAdapter` in
`src/server/integrations/accelevents.ts`) rather than called directly from application code. The only implementation
in the repository today is `DeterministicAcceleventsAdapter`, which fabricates stable responses for tests and the
demo fixture; there is no live HTTP Accelevents adapter to configure yet, so an Accelevents integration in a running
environment today is exercising this deterministic adapter, not a real one.

Integration configuration stores a `credentialReference`, never a raw secret. `AcceleventsConfigurationRepository`
(`src/server/integrations/configuration.ts`) rejects any value that does not match `^(?:secret|env)://...`, for
example:

```
secret://accelevents/production
env://ACCELEVENTS_API_KEY
```

The reference only names where a credential lives; resolving it into an actual API key is deployment-specific and
outside this repository. Never put an API key, token, or password directly into integration configuration — the
validator rejects values that are not `secret://` or `env://` references, but reviewing configuration changes before
they reach production is still the operator's responsibility.

## Roles and security boundaries

Access control has two independent layers. `AUTH_ALLOWED_EMAILS` is retained only as a bootstrap configuration value;
it does not gate magic-link delivery or routine dashboard access.

Within an authenticated session, event-scoped resources (event programs, reviews, profiles, submissions, sessions,
files, tasks) are authorized per event against one or more `EventRole` values — `organizer-admin`, `reviewer`,
`applicant`, or `speaker` (`src/server/authorization/policy.ts`). An active organization member is an organizer for
that organization's events; active `EventMembership` rows add event-specific roles. A reviewer can act on assigned
reviews, while an applicant or speaker can act only on owned resources. Memberships are resolved on every request,
so revocation takes effect immediately.

Separately, each CFP form has its own `CfpAdminRole` — `OWNER`, `EDITOR`, or `REVIEWER` — assigned per form as
`CfpPolicyAdminAssignment` records through that form's setup screen in the dashboard. This controls who can edit a
specific form's questions, visibility rules, and category routing independently of the broader event roles above;
holding an event role does not by itself grant a CFP form admin role, and vice versa.

## Health and restart

`GET /api/health` returns `200` only when PostgreSQL answers a query and file storage responds: with the S3 driver it
probes the bucket with the configured credentials, with the local driver it checks `FILE_STORAGE_PATH` is readable and
writable.
It returns `503` with only the failed check names otherwise; provider errors, URLs, paths, and credentials are never
included. Do not route user traffic until the endpoint reports `ready`, and remove the instance from rotation before
sending its shutdown signal.

A restart uses the same start command and persistent paths. Do not run migrations or seed automatically on restart.
The deployment service should use a bounded restart policy for unexpected exits and should not restart a configuration
or migration failure indefinitely.

## Vercel

Vercel is a supported target with two caveats: functions get a read-only filesystem, and migrations are not part of a
deployment. Everything else works from the repository defaults.

Set these project environment variables (Settings → Environment Variables):

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Must point at a **pooled** Postgres endpoint (Neon/Supabase pooler, PgBouncer, or Prisma Accelerate). |
| `AUTH_SECRET` | At least 32 characters. |
| `BETTER_AUTH_SECRET` | At least 32 characters. |
| `AUTH_ALLOWED_EMAILS` | Bootstrap-only legacy setting; not a runtime authorization gate. |
| `AUTH_MAGIC_LINK_WEBHOOK_URL` | Required in production; magic links are not printed to the console there. |
| `AUTH_MAGIC_LINK_WEBHOOK_TOKEN` | Optional. |

`BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, and `FILE_STORAGE_PATH` are **not** required on Vercel and are usually better
left unset. The runtime config derives the URLs from `VERCEL_PROJECT_PRODUCTION_URL` (production) or `VERCEL_URL`
(preview), so every preview deployment authenticates against its own host instead of a hardcoded origin. Setting them
explicitly still wins, but pins every preview to that one origin. Leave Vercel's "Automatically expose System
Environment Variables" setting on — the client bundle reads the `NEXT_PUBLIC_VERCEL_*` twins.

File storage on Vercel defaults to the S3 driver like any other production deployment, so also set
`FILE_STORAGE_S3_BUCKET`, `FILE_STORAGE_S3_REGION`, and AWS credentials (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`). Setting `FILE_STORAGE_DRIVER=local` instead falls back to `/tmp/gatherpulse/files`,
the only writable location in a Vercel function — per-instance scratch space that disappears between invocations,
so it satisfies the readiness probe but is **not** durable storage.

Migrations do not run on deploy. Apply them as a separate release step against the same database before promoting:

```sh
DATABASE_URL=... npm run db:deploy
```

Use the database's direct (non-pooled) connection string for that command; pooler endpoints reject the advisory locks
Prisma Migrate takes. Do not add `db:deploy` to the build command — Vercel builds preview and production deployments
against whatever `DATABASE_URL` is in scope, and a preview build would migrate production.

The build command is `npm run build`, which runs `prisma generate` first. That is deliberate: Vercel restores a
dependency cache and skips `postinstall` on subsequent deployments, which otherwise ships a Prisma Client generated
against an older schema.

## Self-hosted Incus deployment

`distrobuilder.yml`, `scripts/bootstrap-image.sh`, and `scripts/smoke-incus-image.sh` build and validate a base
Ubuntu 24.04 Incus image with the pinned Node.js, a local PostgreSQL server, and Playwright's Chromium preinstalled.
Those two scripts are a **contributor smoke test**: they deliberately run the application in development mode
(`npm run dev`) behind a disposable, generated secret so a throwaway container can be launched and deleted safely
end to end. Do not copy their generated `/etc/board-to-death.env` or systemd unit into a real deployment; build the
production-shaped equivalents below instead, using the commands already documented under "Install and configure" and
"Build and release".

To bring up a real instance from an image built or promoted by `./scripts/bootstrap-image.sh` (default alias
`board-to-death`):

1. **(One-time) Launch a container and attach a persistent storage volume for application data.**

   ```sh
   incus launch board-to-death my-app-instance
   incus storage volume create <pool> board-to-death-data
   incus config device add my-app-instance app-data disk pool=<pool> source=board-to-death-data \
     path=/var/lib/board-to-death
   ```

2. **(Per release) Copy a release checkout into the container and install dependencies.** Copy a tagged
   release tree, not a working checkout with uncommitted changes. Install the full dependency tree, not
   `--omit=dev`: the build in step 4 needs the development dependencies.

   ```sh
   incus exec my-app-instance -- mkdir -p /opt/board-to-death
   git ls-files -z | tar --create --file=- --directory=. --null --files-from=- \
     | incus exec my-app-instance -- tar --extract --file=- --directory=/opt/board-to-death
   incus exec my-app-instance -- sh -c 'cd /opt/board-to-death && npm ci'
   ```

3. **(One-time, update on rotation) Write `/etc/board-to-death.env` with real production values**, pointing
   `FILE_STORAGE_PATH` at the mounted volume. Replace every placeholder below; do not reuse these example values.

   ```sh
   incus exec my-app-instance -- sh -c 'umask 077; cat > /etc/board-to-death.env' <<'EOF'
   NODE_ENV=production
   DATABASE_URL=postgresql://USER:PASSWORD@db-host:5432/board_to_death?schema=public
   AUTH_SECRET=replace-with-a-32-plus-character-secret
   BETTER_AUTH_SECRET=replace-with-a-different-32-plus-character-secret
   BETTER_AUTH_URL=https://events.example.com
   NEXT_PUBLIC_APP_URL=https://events.example.com
   AUTH_ALLOWED_EMAILS=admin@example.com
   AUTH_MAGIC_LINK_WEBHOOK_URL=https://events.example.com/hooks/magic-link
   FILE_STORAGE_DRIVER=local
   FILE_STORAGE_PATH=/var/lib/board-to-death/files
   EOF
   incus exec my-app-instance -- install -d -m 0700 /var/lib/board-to-death/files
   ```

4. **(Per release) Build, then apply migrations**, using the same production commands as a non-container deploy:

   ```sh
   incus exec my-app-instance -- sh -c \
     "set -a; . /etc/board-to-death.env; set +a; cd /opt/board-to-death && npm run build"
   incus exec my-app-instance -- sh -c \
     "set -a; . /etc/board-to-death.env; set +a; cd /opt/board-to-death && npm run runtime:migrate"
   ```

   A nonzero migration result means the release stops here; do not proceed to restart the service.

5. **(One-time) Install a systemd unit that runs the production launcher** (`npm run start`, never `npm run dev`).
   If PostgreSQL runs outside this container, as it should for anything beyond a single-box trial, point
   `DATABASE_URL` at that external server instead of adding a local dependency.

   ```sh
   incus exec my-app-instance -- sh -c 'cat > /etc/systemd/system/board-to-death.service' <<'EOF'
   [Unit]
   Description=GatherPulse application
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/board-to-death
   EnvironmentFile=/etc/board-to-death.env
   Environment=PATH=/usr/local/bin:/usr/bin:/bin
   ExecStart=/usr/local/bin/npm run start -- --hostname 127.0.0.1 --port 3000
   Restart=on-failure
   RestartSec=2

   [Install]
   WantedBy=multi-user.target
   EOF
   incus exec my-app-instance -- systemctl daemon-reload
   incus exec my-app-instance -- systemctl enable --now board-to-death.service
   ```

6. **(Per release) Verify readiness before sending traffic**, then front the instance with a reverse proxy that
   terminates TLS at `BETTER_AUTH_URL`'s origin.

   ```sh
   incus exec my-app-instance -- curl --fail --silent http://127.0.0.1:3000/api/health
   ```

A redeploy repeats steps 2 and 4–6 against the existing container and volume; it does not recreate the volume
(step 1) or rewrite the env file (step 3) unless a secret or configuration value is actually changing.

## Persistence, backup, and recovery

Back up PostgreSQL and the file store — the S3 bucket (bucket versioning or replication), or with the local driver the
volume mounted at `FILE_STORAGE_PATH` — together according to the application's recovery-point
requirements. The `.next` directory is a replaceable build artifact, not application data. Restore the database and
file volume to a consistent point, validate configuration, run `runtime:migrate`, then start and wait for `/api/health`.

For a failed Prisma deployment migration, inspect `npm run db:status`, repair with a forward migration or documented
`prisma migrate resolve` procedure, and rerun `runtime:migrate`. Never edit a successfully applied migration in place.

## Troubleshooting

**The process exits immediately with a configuration message and no server starts.** `runtime:validate`,
`runtime:migrate`, `runtime:seed`, and `npm run start` all parse configuration
(`src/config/runtime-env.server.ts`) before doing anything else, so a bad or missing variable fails fast with one
message per problem rather than a partial start. Common messages and their fix:

| Message | Fix |
| --- | --- |
| `<KEY> is required when NODE_ENV=production` | Set the named variable — `AUTH_SECRET`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_ALLOWED_EMAILS`, `NEXT_PUBLIC_APP_URL`, or (local driver only) `FILE_STORAGE_PATH`. |
| `<KEY> is required when FILE_STORAGE_DRIVER=s3` | The S3 driver is active (the production default) but `FILE_STORAGE_S3_BUCKET` or `FILE_STORAGE_S3_REGION` is unset. Set them, or set `FILE_STORAGE_DRIVER=local` with a `FILE_STORAGE_PATH`. |
| `must contain at least 32 characters` | `AUTH_SECRET` or `BETTER_AUTH_SECRET` is too short; generate a longer one, for example `openssl rand -hex 32`. |
| `must use the postgres or postgresql protocol` | `DATABASE_URL` has the wrong URL scheme. |
| `must use the http or https protocol` | `BETTER_AUTH_URL` (or `AUTH_MAGIC_LINK_WEBHOOK_URL`) has the wrong URL scheme. |
| `AUTH_MAGIC_LINK_WEBHOOK_URL or both RESEND_API_KEY and RESEND_FROM_EMAIL are required when NODE_ENV=production` | Neither delivery route is configured. Set the webhook URL, or set both Resend variables together. |
| `RESEND_API_KEY is required when Resend delivery is configured` (or `RESEND_FROM_EMAIL`) | Only one half of the Resend pair is set; supply the one named, or unset both and use the webhook URL. |
| `FILE_STORAGE_PATH must be an absolute path when NODE_ENV=production` | Use an absolute path such as `/var/lib/board-to-death/files`, not a relative one. |

The parser groups its checks rather than reporting all of them at once: it lists every missing required variable
together, then every malformed value together, then the delivery and storage-path checks. Fix everything a run
lists, then rerun — a clean pass can still surface a later group's message.

**`FILE_STORAGE_PATH could not be prepared for read/write access.`** (Local driver only.) The service account cannot create or write the
configured directory. Confirm the parent directory — typically the mounted persistent volume — exists, is owned by
the service account, and is not mounted read-only.

**`GET /api/health` returns `503`.** The body names only which checks failed (database, storage), never a
connection string, path, or credential. A failed database check usually means `DATABASE_URL` is unreachable or the
database has not finished starting; a failed storage check usually means the bucket is unreachable or the credentials
were rejected (S3 driver), or the persistent volume is not attached yet or lost its permissions across a restart
(local driver). Do not route traffic to an instance, and remove it from rotation before
sending its shutdown signal, until this returns `200`.

**A release-time migration (`runtime:migrate` / `db:deploy`) fails partway through.** Do not start the new
application version. Run `npm run db:status` to see which migrations applied, fix or revert the failing migration's
SQL, use `prisma migrate diff` to prepare any compensating SQL the partial apply left behind, apply it with
`prisma db execute`, then mark the failed migration resolved:

```sh
npx prisma migrate resolve --rolled-back <MIGRATION_NAME>
```

This is a **destructive, production-database** command — confirm the compensating SQL is correct first, and never
mark a migration that actually succeeded as rolled back.

**A systemd-managed instance won't come up (Incus or otherwise).** Check the service and its recent log before
anything else:

```sh
systemctl status --no-pager --full board-to-death.service
journalctl --no-pager -u board-to-death.service -n 300
```

Most failures trace back to one of the configuration or health-check causes above; a unit that keeps restarting
under a bounded restart policy without ever passing `/api/health` is almost always a configuration or storage
problem, not an application bug.
