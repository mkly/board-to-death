# Contributing to Board to Death

Board to Death is an event-program management application: CFP intake, review, scheduling, program
publication, public embeds and APIs, and an Accelevents integration. It is built with **Next.js 16**,
**React 19**, **TypeScript**, **Tailwind CSS v4**, **shadcn/ui**, and a **Prisma/PostgreSQL**
persistence layer. This guide covers environment setup and the contribution workflow.

---

## Project Layout

Feature code is co-located with the route that owns it.

```
src
├── app               # Next.js routes (App Router)
│   ├── (main)        # Dashboard and auth routes
│   │   └── dashboard/events/[eventSlug]/   # Event screens (agenda, integrations, ...)
│   └── (external)    # Public pages, embeds, CFP, portals
├── components        # Shared UI components (src/components/ui is vendored shadcn)
├── hooks             # Reusable hooks
├── lib               # Config & utilities
├── server            # Repositories, operations, auth, integrations
├── navigation        # Sidebar configuration
└── styles            # Tailwind / theme setup
```

See `CLAUDE.md` for the full co-location conventions.

---

## Getting Started

```bash
nvm use                # Node 24.19.0 with bundled npm 11.17.0 (see .nvmrc)
cp .env.example .env   # DATABASE_URL and TEST_DATABASE_URL; .env is gitignored
npm install
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000). Database-backed work
needs a local PostgreSQL matching `.env.example`; apply migrations with `npx prisma migrate deploy`.

---

## Contribution Flow

- Create a new branch before working on changes:
  ```bash
  git checkout -b feature/my-update
  ```
- Use clear commit messages with conventional prefixes:
  ```bash
  git commit -m "feat: add program publication card"
  ```
- Open a Pull Request once ready.
- If your change adds a new UI screen or a material visual change, include a screenshot in your PR
  description (mobile and dark-theme states when relevant).

---

## Guidelines

- Prefer **TypeScript types** over `any`; strict mode is enabled.
- Biome is the only formatter and linter; run `npm run check:fix` after editing. Husky pre-commit
  hooks apply it to staged files, so a commit can change files after you stage them.
- Follow **shadcn/ui** style and Tailwind v4 conventions; do not modify `src/components/ui/` or
  `src/components/calendar/`.
- Keep accessibility in mind (semantic HTML, ARIA, keyboard navigation).
- Avoid unnecessary dependencies — prefer existing utilities, and follow the lockfile rules in
  `CLAUDE.md` when a dependency change is warranted.

## Quality and release gate

Run the complete local release gate from a clean checkout with:

```bash
cp .env.example .env   # provides DATABASE_URL and TEST_DATABASE_URL; .env is gitignored
npm ci
npx playwright install --with-deps chromium
npm run quality
```

`npm run quality` stops at the first failing stage. It checks formatting and lint rules, TypeScript, unit and
infrastructure tests, database migrations and repository integration tests, authentication and authorization,
the production build, and Chromium browser and accessibility smoke tests. Database-backed stages use
`TEST_DATABASE_URL`; the guard requires its database name to end in `_test` and refuses to use the same database as
`DATABASE_URL`. Browser tests run the development server against that test database with local magic-link delivery,
so no production email, storage, or Accelevents credentials are required. The preceding build remains a separate
quality-gate stage.

The browser stage writes screenshots and traces to `test-results/` and an HTML report to `playwright-report/` when it
fails. CI uploads both directories as the `playwright-failure-artifacts` artifact.

To run the browser specs on their own without waiting for a production build, use the default Playwright web server,
which compiles routes on demand:

```bash
npm run db:test:reset
npm run test:browser
```

This verifies the specs and the accessibility assertions but not the production build, so it is a development
shortcut and not a substitute for `npm run quality`. `PLAYWRIGHT_BASE_URL` overrides the URL the same way.
Set `PLAYWRIGHT_WEB_SERVER_COMMAND` when Playwright should start a different server command.

The separate Incus image smoke test is intentionally outside this portable gate. It requires an x86_64 Linux host
with Incus, `distrobuilder`, the `crabbox-btrfs` profile, passwordless access to the repository's documented `sudo`
operation, and a Crabbox build containing the image-ready optimization. On a prepared host, run
`./scripts/bootstrap-image.sh` independently.

The bootstrap command validates and builds `distrobuilder.yml`, imports the resulting `incus.tar.xz` and
`rootfs.squashfs` under a unique staging alias, and promotes it to `board-to-death` only after all smoke checks pass.
If that alias already exists, it is retained as a dated `board-to-death-prev-*` rollback alias. The application smoke
launches two clean containers, injects generated local-only runtime configuration, attaches a temporary custom storage
volume, installs the tracked checkout, deploys the local database migrations, and verifies the application systemd
service, its HTTP login page, a ready `GET /api/health`, stop/start/restart behavior, and a second launch. The
generated configuration points `FILE_STORAGE_PATH` at the mounted volume, so a ready health check proves PostgreSQL
and that volume are both usable by the application, and the second instance must recover a file the first one left
under `FILE_STORAGE_PATH`. On failure it prints the path to
retained Incus, systemd, and journal logs; those logs do not include the generated secret or environment file.

The application smoke resolves its storage pool from the default profile and then `crabbox-btrfs`. Set
`INCUS_STORAGE_POOL=<pool>` when neither profile should supply it. To validate an already-imported image without
rebuilding or changing aliases, run `./scripts/smoke-incus-image.sh <image-alias>`.

---

## Submitting PRs

- Open a Pull Request once your changes are ready.
- Ensure your branch is up to date with `main` before submitting.
- Reference any related issue in your PR for context, and explain any new reusable patterns or
  dependencies in the description.
