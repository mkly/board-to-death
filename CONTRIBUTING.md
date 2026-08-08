# Contributing to Studio Admin

Thanks for showing interest in improving **Studio Admin** (repo: `next-shadcn-admin-dashboard`).  
This guide will help you set up your environment and understand how to contribute.

---

## Overview

This project is built with **Next.js 16**, **TypeScript**, **Tailwind CSS v4**, and **Shadcn UI**.  
The goal is to keep the codebase modular, scalable, and easy to extend.

---

## Project Layout

We use a **colocation-based file system**. Each feature keeps its own pages, components, and logic.

```
src
├── app               # Next.js routes (App Router)
│   ├── (auth)        # Auth layouts & screens
│   ├── (main)        # Main dashboard routes
│   │   └── (dashboard)
│   │       ├── crm
│   │       ├── finance
│   │       ├── default
│   │       └── ...
│   └── layout.tsx
├── components        # Shared UI components
├── hooks             # Reusable hooks
├── lib               # Config & utilities
├── styles            # Tailwind / theme setup
└── types             # TypeScript definitions
```

If you’d like a more detailed example of this setup, check out the [Next Colocation Template](https://github.com/arhamkhnz/next-colocation-template), where the full structure is explained with examples.

---

## Getting Started

### Fork and Clone the Repository

1. Fork the Repository
   
   Click [here](https://github.com/arhamkhnz/next-shadcn-admin-dashboard/fork) to fork the repository.

2. Clone the Repository  
   ```bash
   git clone https://github.com/YOUR_USERNAME/next-shadcn-admin-dashboard.git
   ```
   
3. Navigate into the Project  
   ```bash
   cd next-shadcn-admin-dashboard
   ```

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Run the dev server**
   ```bash
   npm run dev
   ```
   App will be available at [http://localhost:3000](http://localhost:3000).

---

## Contribution Flow

- Always create a new branch before working on changes:
  ```bash
  git checkout -b feature/my-update
  ```

- Use clear commit messages:
  ```bash
  git commit -m "feat: add finance dashboard screen"
  ```

- Open a Pull Request once ready.
- If your change adds a new UI screen or component, include a screenshot in your PR description.

---

## Where to Contribute

- **External Pages**: Landing pages or other non-dashboard routes → `src/app/(external)/`  
- **Auth Screens**: Login, register, and authentication layouts → `src/app/(main)/auth/`  
- **Dashboard Screens**: Feature dashboards like CRM, Finance, Analytics → `src/app/(main)/dashboard/`
- **Components**: Reusable UI goes in `src/components/`  
- **Hooks**: Custom logic goes in `src/hooks/`  
- **Themes**: New presets under `src/styles/presets/`  

---

## Guidelines

- Prefer **TypeScript types** over `any`
- Husky pre-commit hooks are enabled - linting and formatting run automatically when you commit, and if there are errors the commit will be blocked until they are fixed. 
- Follow **Shadcn UI** style & Tailwind v4 conventions
- Keep accessibility in mind (ARIA, keyboard nav)
- Use clear commit messages with conventional prefixes (`feat:`, `fix:`, `chore:`, etc.)
- Avoid unnecessary dependencies — prefer existing utilities where possible

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
`DATABASE_URL`. Browser tests run the production server against that test database with local magic-link delivery,
so no production email, storage, or Accelevents credentials are required.

The browser stage writes screenshots and traces to `test-results/` and an HTML report to `playwright-report/` when it
fails. CI uploads both directories as the `playwright-failure-artifacts` artifact.

To run the browser specs on their own without waiting for a production build, point the Playwright web server at the
dev server, which compiles routes on demand:

```bash
npm run db:test:reset
PLAYWRIGHT_WEB_SERVER_COMMAND="npm run dev -- --hostname 127.0.0.1 --port 3100" npm run test:browser
```

This verifies the specs and the accessibility assertions but not the production build, so it is a development
shortcut and not a substitute for `npm run quality`. `PLAYWRIGHT_BASE_URL` overrides the URL the same way.

The separate Incus image smoke test is intentionally outside this portable gate. It requires an x86_64 Linux host
with Incus, `distrobuilder`, the `crabbox-btrfs` profile, passwordless access to the repository's documented `sudo`
operation, and a Crabbox build containing the image-ready optimization. On a prepared host, run
`./scripts/bootstrap-image.sh` independently.

---

## Submitting PRs

- Open a Pull Request once your changes are ready.  
- Ensure your branch is up to date with `main` before submitting.  
- Reference any related issue in your PR for context.

---

## Questions & Support

- Report bugs, suggestions, or issues via [GitHub Issues](https://github.com/arhamkhnz/next-shadcn-admin-dashboard/issues)

---

Your contributions keep this project growing. 🚀

**Happy Vibe Coding!**
