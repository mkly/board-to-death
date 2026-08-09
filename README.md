# Next.js Admin Template with TypeScript & Shadcn UI

**Studio Admin** - Includes multiple dashboards, authentication layouts, customizable theme presets, and more.

<img src="https://github.com/arhamkhnz/next-shadcn-admin-dashboard/blob/main/media/dashboard.png?version=5" alt="Dashboard Screenshot">

Most admin templates I found, free or paid, felt cluttered, outdated, or too rigid. I built this as a cleaner alternative with features often missing in others, such as theme toggling and layout controls, while keeping the design modern, minimal, and flexible.

> **View demo:** [studio admin](https://next-shadcn-admin-dashboard.vercel.app)

> [!NOTE]
> Looking for the Base UI version? Check out [next-shadcn-admin-dashboard-baseui](https://github.com/arhamkhnz/next-shadcn-admin-dashboard-baseui).
>
> Looking for the React Aria version? Check out [arhamkhnz/next-shadcn-admin-dashboard-aria](https://github.com/arhamkhnz/next-shadcn-admin-dashboard-aria).
>
> Looking for the TanStack Start version? Check out [tanstack-shadcn-admin-dashboard](https://github.com/arhamkhnz/tanstack-shadcn-admin-dashboard).

> [!TIP]
> I’m also working on Nuxt.js and Svelte versions of this dashboard. They’ll be live soon.

## Features

- Built with Next.js 16, TypeScript, Tailwind CSS v4, and Shadcn UI  
- Responsive and mobile-friendly  
- Customizable theme presets (light/dark modes with color schemes like Tangerine, Brutalist, and more)  
- Flexible layouts (collapsible sidebar, variable content widths)  
- Authentication flows and screens  
- Prebuilt dashboards (Default, CRM, Finance, Analytics, Productivity) plus legacy variants  
- Role-Based Access Control (RBAC) with config-driven UI and multi-tenant support *(planned)*  

> [!NOTE]
> The default dashboard uses the **shadcn neutral** theme.  
> It also includes additional color presets inspired by [Tweakcn](https://tweakcn.com):  
>
> - Tangerine  
> - Neo Brutalism  
> - Soft Pop  
>
> You can create more presets by following the same structure as the existing ones.

> Looking for the **Next.js 15** version?  
> Check out the [`archive/next15`](https://github.com/arhamkhnz/next-shadcn-admin-dashboard/tree/archive/next15) branch.  
> This branch contains the setup prior to upgrading to Next 16 and the React Compiler.

> Looking for the **Next.js 14 + Tailwind CSS v3** version?  
> Check out the [`archive/next14-tailwindv3`](https://github.com/arhamkhnz/next-shadcn-admin-dashboard/tree/archive/next14-tailwindv3) branch.  
> It has a different color theme and is not actively maintained, but I try to keep it updated with major changes.  

## Tech Stack

- **Framework**: Next.js 16 (App Router), TypeScript, Tailwind CSS v4  
- **UI Components**: Shadcn UI  
- **Validation**: Zod  
- **Forms & State Management**: React Hook Form, Zustand  
- **Tables & Data Handling**: TanStack Table  
- **Tooling & DX**: Biome, Husky  

## Screens

### Available
- Default Dashboard  
- CRM Dashboard  
- Finance Dashboard  
- Analytics Dashboard  
- Productivity Dashboard  
- E-commerce Dashboard  
- Academy Dashboard  
- Logistics Dashboard  
- Infrastructure Dashboard  
- File Manager  
- Patient Monitoring  
- Chat Page  
- Email Page  
- Users Management  
- Roles Management  
- Kanban Board  
- Tasks Page  
- Invoice Page  
- Calendar Page  
- Authentication (4 screens)  
- Legacy: Default v1, CRM v1, Finance v1, Analytics v1

### Planned
I’ve added all the planned screens. Feel free to open an issue for requesting something specific.

## Colocation File System Architecture

This project follows a **colocation-based architecture** each feature keeps its own pages, components, and logic inside its route folder.  
Shared UI, hooks, and configuration live at the top level, making the codebase modular, scalable, and easier to maintain as the app grows.

For a full breakdown of the structure with examples, see the [Next Colocation Template](https://github.com/arhamkhnz/next-colocation-template).

## Getting Started

You can run this project locally, or deploy it instantly with Vercel.

### Deploy with Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Farhamkhnz%2Fnext-shadcn-admin-dashboard)

_Deploy your own copy with one click._

### Run locally

1. **Clone the repository**
   ```bash
   git clone https://github.com/arhamkhnz/next-shadcn-admin-dashboard.git
   ```
   
2. **Navigate into the project**
   ```bash
    cd next-shadcn-admin-dashboard
   ```
   
3. **Install dependencies**
   ```bash
    npm install
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

Your app will be running at [http://localhost:3000](http://localhost:3000)

### PostgreSQL persistence

The application uses PostgreSQL 16 through Prisma. Copy `.env.example` to `.env` and keep `DATABASE_URL` for local
application data separate from `TEST_DATABASE_URL`, which must name a database ending in `_test`.

```bash
npm run db:generate                # regenerate the typed Prisma client
npm run db:migrate -- --name NAME  # create and apply a development migration
npm run db:deploy                  # apply committed migrations without generating new ones
npm run db:status                  # compare committed and applied migration history
npm run db:test:reset              # destructively reset only the guarded *_test database
npm run db:test:smoke              # rebuild the test schema and verify every migration
npm run db:seed                    # replace the deterministic representative demo event
```

`npm run db:seed` replaces only the event whose slug is `board-to-death-demo`; running it repeatedly produces the
same stable IDs and does not duplicate records. The fixture includes a CFP form and accepted submission, speaker and
session, onboarding assignment, evaluation plan and reviewer, agenda placement, and a completed Accelevents-style
speaker resource sync.

The fixture labels its actors as `demo-admin` and `demo-reviewer` and uses `ada@example.test` and
`reviewer@example.test`. These are data labels, not login accounts, and the seed creates no passwords or authentication
sessions. Its integration configuration points to `local://adapters/accelevents/board-to-death-demo`; this is a
deterministic local adapter reference, not a production credential. The stored sync request context is redacted and
the adapter's in-memory state starts fresh with each application process.

Prisma records applied migrations in `_prisma_migrations`. Commit `prisma/schema.prisma` and every generated migration
directory together. `db:migrate` is for development only; deployments use `db:deploy`.

To recover from a failed deployment migration, fix or revert the migration SQL, use `prisma migrate diff` to prepare any
required compensating SQL, apply it with `prisma db execute`, and mark the failed migration with
`prisma migrate resolve --rolled-back MIGRATION_NAME` before redeploying. Do not edit or mark a successfully applied
migration as rolled back; revert the Prisma schema and create a new forward migration instead.

### Production operations

See [Production operations](docs/operations.md) for runtime configuration, mounted secrets, migration and startup
commands, health checks, graceful shutdown, persistent storage, backup, and recovery guidance.

### Formatting and Linting

Format, lint, and organize imports
```bash
npx @biomejs/biome check --write
```
> For more information on available rules, fixes, and CLI options, refer to the [Biome documentation](https://biomejs.dev/).

### Browser tests

Reset the guarded test database, then run the Playwright suite:

```bash
npm run db:test:reset
npm run test:browser
```

Playwright starts the Next.js development server on `127.0.0.1:3100` by default, so the browser suite does not need a
production build or production-only runtime secrets. Set `PLAYWRIGHT_WEB_SERVER_COMMAND` to use another server command,
or `PLAYWRIGHT_BASE_URL` to test an already running application at another URL.

---

> [!IMPORTANT]  
> This project is updated frequently. If you’re working from a fork or an older clone, pull the latest changes before syncing. Some updates may include breaking changes.

---

Contributions are welcome. Feel free to open issues, feature requests, or start a discussion.


**Happy Vibe Coding!**
