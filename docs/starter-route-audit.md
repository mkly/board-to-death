# Admin starter route audit

This audit classifies every `page.tsx` route directory that existed before the admin-starter cleanup. The baseline is
commit `dc33a0d` (the pinned Next.js admin starter import). “Commits” is the number of commits in
`dc33a0d..d4cd51e` touching that route directory. “Inbound” counts source files outside the route that contain its
literal URL; dynamic route families use the shared prefix count shown in the retained-family table. Exact literal
counts are deliberately conservative: a zero does not mean a route is unreachable when Next.js dispatches it or a
URL builder constructs it dynamically.

## Removed routes

These 26 routes were not in the product navigation. All zero-commit entries were unchanged starter code. The three
one-commit entries only received compatibility fixes in `baa7ecb`; that commit did not give them product behavior.
The standalone `/chat` and `/mail` routes were referenced only by the demo dashboard iframe routes removed with them.
The `/dashboard/default` literal occurs only in `src/proxy.test.ts`, where it is an arbitrary authenticated URL used
to exercise the dashboard matcher rather than an application link.

| Route directory | Commits | Inbound source files | Decision |
| --- | ---: | ---: | --- |
| `src/app/(main)/chat` | 0 | 1 (removed iframe) | Remove |
| `src/app/(main)/mail` | 0 | 1 (removed iframe) | Remove |
| `src/app/(main)/dashboard/(legacy)/analytics-v1` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/(legacy)/crm-v1` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/(legacy)/default-v1` | 1 | 0 | Remove |
| `src/app/(main)/dashboard/(legacy)/finance-v1` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/academy` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/analytics` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/calendar` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/chat` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/coming-soon` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/crm` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/default` | 1 | 1 (matcher test only) | Remove |
| `src/app/(main)/dashboard/ecommerce` | 1 | 0 | Remove |
| `src/app/(main)/dashboard/file-manager` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/finance` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/infrastructure` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/invoice` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/kanban` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/logistics` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/mail` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/patient-monitoring` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/productivity` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/roles` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/tasks` | 0 | 0 | Remove |
| `src/app/(main)/dashboard/users` | 0 | 0 | Remove |

Their co-located components were removed with the route directories. Three shared files became unused after that
deletion and were also removed: `src/components/date-range-picker.tsx`, `src/hooks/use-lg.ts`, and
`src/lib/data-table-features.ts`. `src/components/simple-icon.tsx`, `src/hooks/use-mobile.ts`, and
`src/lib/cookie.client.ts` remain because retained authentication, dashboard-shell, or preferences code still imports
them.

## Retained individual routes

These routes are application entry points, authentication/authorization surfaces, active product workspaces, or the
functional dashboard catch-all. The v2 authentication variants have no literal inbound links, but both were changed
after the baseline to use the real passwordless login and organization-registration forms and remain valid direct
entry points. `/unauthorized` is retained as the dedicated authorization terminal route. The catch-all is retained
because Next.js dispatches unmatched dashboard paths to it; it does not need an inbound literal.

| Route directory | Commits | Inbound source files | Keep evidence |
| --- | ---: | ---: | --- |
| `src/app/(external)` | 1 | framework entry | Redirects `/` into the dashboard |
| `src/app/(main)/auth/v1/login` | 3 | 8 | Active magic-link login |
| `src/app/(main)/auth/v1/register` | 2 | 3 | Active organization signup |
| `src/app/(main)/auth/v1/two-factor` | 1 | 2 | Added for administrator 2FA |
| `src/app/(main)/auth/v2/login` | 1 | 0 | Post-baseline real login variant |
| `src/app/(main)/auth/v2/register` | 1 | 0 | Post-baseline real signup variant |
| `src/app/(main)/dashboard/[...not-found]` | 0 | framework dispatch | Functional dashboard catch-all |
| `src/app/(main)/dashboard/account/security` | 1 | 1 | Added for administrator 2FA |
| `src/app/(main)/dashboard/event-settings` | 7 | 7 | Active event creation/settings workspace |
| `src/app/(main)/dashboard/onboarding-tasks` | 4 | 3 | Active onboarding workspace |
| `src/app/(main)/dashboard` | 206 (including descendants) | 3 exact root links | Active dashboard entry and event selection |
| `src/app/(main)/reviews` | 3 | 6-family | Active reviewer queue |
| `src/app/(main)/reviews/[assignmentId]` | 3 | 6-family | Active reviewer assignment detail |
| `src/app/(main)/unauthorized` | 0 | 0 | Dedicated authorization terminal route |

## Retained product route families

Every directory below contains a `page.tsx` and is retained. The family inbound count is the number of source files
containing the literal route-family prefix; individual URLs are also assembled by route helpers, server actions, and
dynamic parameters. Every route in these families has at least one post-baseline product commit.

| Family | Inbound source files | Post-baseline commits per listed directory |
| --- | ---: | --- |
| Dashboard event workspaces (`/dashboard/events/`) | 61 | 1–18 |
| Speaker portal (`/portal/`) | 11 | 2–21 |
| Public CFP (`/cfp/`) | 42 | 16–17 |
| Public embed (`/embed/`) | 5 | 15 |
| Published resources (`/events/`) | 151 | 1 |
| Public file requests (`/file-requests/`) | 4 | 1 |
| Event invitations (`/invitations/`) | 2 | 1 |
| Partner intake (`/partner-intake/`) | 1 | 1 |
| Speaker interest (`/speaker-interest/`) | 1 | 1 |

### Dashboard event workspaces

```text
src/app/(main)/dashboard/events/[eventSlug]/[workspace]
src/app/(main)/dashboard/events/[eventSlug]/agenda
src/app/(main)/dashboard/events/[eventSlug]/cfp
src/app/(main)/dashboard/events/[eventSlug]/cfp/forms/[formId]/setup
src/app/(main)/dashboard/events/[eventSlug]/communications/audience
src/app/(main)/dashboard/events/[eventSlug]/communications/deliveries/[deliveryId]
src/app/(main)/dashboard/events/[eventSlug]/communications/templates
src/app/(main)/dashboard/events/[eventSlug]/contacts
src/app/(main)/dashboard/events/[eventSlug]/contacts/[personId]
src/app/(main)/dashboard/events/[eventSlug]/dashboards
src/app/(main)/dashboard/events/[eventSlug]/evaluations
src/app/(main)/dashboard/events/[eventSlug]/evaluations/assignments
src/app/(main)/dashboard/events/[eventSlug]/evaluations/results
src/app/(main)/dashboard/events/[eventSlug]/file-requests
src/app/(main)/dashboard/events/[eventSlug]/file-requests/[requestId]
src/app/(main)/dashboard/events/[eventSlug]/groups
src/app/(main)/dashboard/events/[eventSlug]/imports
src/app/(main)/dashboard/events/[eventSlug]/integrations
src/app/(main)/dashboard/events/[eventSlug]/portals
src/app/(main)/dashboard/events/[eventSlug]/publishing
src/app/(main)/dashboard/events/[eventSlug]/publishing/embeds
src/app/(main)/dashboard/events/[eventSlug]/records
src/app/(main)/dashboard/events/[eventSlug]/reports
src/app/(main)/dashboard/events/[eventSlug]/sessions
src/app/(main)/dashboard/events/[eventSlug]/sessions/intake
src/app/(main)/dashboard/events/[eventSlug]/settings
src/app/(main)/dashboard/events/[eventSlug]/settings/custom-fields
src/app/(main)/dashboard/events/[eventSlug]/settings/team
src/app/(main)/dashboard/events/[eventSlug]/speaker-sourcing
src/app/(main)/dashboard/events/[eventSlug]/speakers
src/app/(main)/dashboard/events/[eventSlug]/speakers/[speakerId]
src/app/(main)/dashboard/events/[eventSlug]/speakers/tasks/[definitionId]
src/app/(main)/dashboard/events/[eventSlug]/submissions
src/app/(main)/dashboard/events/[eventSlug]/submissions/[submissionId]
```

### Speaker portal and public routes

```text
src/app/(speaker)/portal/[eventSlug]/(authenticated)
src/app/(speaker)/portal/[eventSlug]/(authenticated)/profile
src/app/(speaker)/portal/[eventSlug]/(authenticated)/resources
src/app/(speaker)/portal/[eventSlug]/(authenticated)/resources/[resourceSlug]
src/app/(speaker)/portal/[eventSlug]/(authenticated)/submissions
src/app/(speaker)/portal/[eventSlug]/(authenticated)/submissions/[submissionId]
src/app/(speaker)/portal/[eventSlug]/(authenticated)/tasks/[assignmentId]
src/app/(speaker)/portal/[eventSlug]/sign-in
src/app/cfp/[publicId]
src/app/cfp/[publicId]/start
src/app/embed/[eventSlug]
src/app/events/[eventSlug]/resources
src/app/events/[eventSlug]/resources/[resourceSlug]
src/app/file-requests/[token]
src/app/invitations/[token]
src/app/partner-intake/[publicId]
src/app/speaker-interest/[publicId]
```

The retained lists contain 65 routes; combined with the 26 removed routes, they account for all 91 route directories
present at the start of the audit.
