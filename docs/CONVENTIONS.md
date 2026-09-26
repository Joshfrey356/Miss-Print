# Code Conventions

How the Command Center code is organized. Read this before adding a feature.

## Stack

Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Drizzle ORM, PostgreSQL. Next.js 16 differs from older versions: `params` and `searchParams` are Promises, and middleware is now `src/proxy.ts`. The version-matched docs are in `node_modules/next/dist/docs/`.

## Where things go

| What | Where |
|---|---|
| Pages | `src/app/(app)/<section>/page.tsx` (signed-in shell) |
| Server Actions for a section | `src/app/(app)/<section>/actions.ts` (`"use server"`) |
| Domain logic shared by sections | `src/lib/<domain>/…` (`import "server-only"`) |
| Shops (tenants) & white-label brand | `src/lib/tenant.ts` (`nextNumber`, `getTenant`), `src/lib/brand.ts` (`getBrand`, `<Logo brand>`), `src/lib/setup` (first-run setup and `/signup`) |
| Pure logic, safe on the client | `src/lib/format.ts`, `src/lib/jobs/workflow.ts`, `src/lib/pricing/engine.ts` |
| UI kit | `src/components/ui/*` (Button, Input, Card, Badge, Dialog, Dropdown, Table, EmptyState, PageHeader, LinkTabs, Confirm) |
| Domain components | `src/components/*` (status badges, file uploader, …) |

## Rules

1. **Multi-tenant: scope everything to the user's shop.** Every print shop is a tenant, and every business table has `tenantId`. Every query that reads, updates or deletes a business table filters `eq(<table>.tenantId, user.tenantId)`; every insert sets `tenantId`. Library functions take `tenantId` (right after `tx`, otherwise first) or a user/row that carries it. Anything looked up by an id or number from a URL or form must be scoped, so another shop's ids are simply "not found" (job numbers are only unique per shop). New job/quote/invoice numbers come from `nextNumber(tx, tenantId, kind)` in `src/lib/tenant.ts`. `tests/tenant-scope.test.ts` fails on unscoped queries; it can't read raw SQL, so filter `tenant_id` in `sql\`…\`` by hand. Use a `// tenant-scope: <reason>` comment only for queries that are safe without it (e.g. a lookup by a globally unique proof token).
2. **Every page** starts with `await requirePagePermission("<perm>")` (or `requireUser()`). **Every Server Action** starts with `await requirePermission("<perm>")`. Permissions live in `src/lib/permissions.ts`.
3. **Hide money from roles that shouldn't see it on the server.** If `!can(user.role, "financials.view")`, don't select or render prices. The same goes for `margins.view` and costs/margins.
4. **Money is integer cents.** Use `money()`, `parseMoney()` and `centsToInput()` from `@/lib/format`.
5. **Brand:** never hard-code a shop's name, logo or locations. Use `getBrand(tenantId)` / `<Logo brand={…} />` and `getSettings(tenantId).company`, and read locations from `getLocations(tenantId)`. Customer emails pass `fromName: company.name` and `replyTo: company.email`.
6. **Dates:** business dates are `YYYY-MM-DD` strings in shop time (America/Chicago). Use `today()`, `addDays()`, `fmtDate()` and `dueLabel()`.
7. **Change job status only through** `changeJobStatus()` in `src/lib/jobs/service.ts`. It records history and activity, handles location handoffs, and sends notifications.
8. **Record important changes** with `logActivity()`. Include `{ before, after }` in `data` for price, status and assignment changes (the `diff()` helper builds this).
9. **Notify people only when it's useful**, using `notify()` in `src/lib/notifications.ts`. It respects each user's preferences and skips the person who made the change.
10. **Never hard-delete business records.** Set `archivedAt`. Invoices and payments are voided with a reason.
11. **Server Actions** return `ActionResult` using `runAction()` from `src/lib/actions.ts`. Throw `UserError` for messages the user should see. On the client, use `useServerAction()` from `src/components/use-action.ts` for buttons, or `useActionState` for forms. Call `revalidatePath()` after mutations.
12. **Search params drive list state** (filters, sort, page, tab), so views can be bookmarked and shared.
13. **UI tone:** plain words, large readable text, and empty states that say what they mean ("No jobs are waiting for proof approval"). Confirm destructive actions with `<Confirm>`. Use toasts sparingly.
14. **Files:** upload through `<FileUploader>` (which posts to `/api/files`) and link to `/api/files/<id>`. Never expose storage paths.

## Scripts

```
npm run dev          # http://localhost:3000
npm run db:migrate   # apply migrations
npm run db:seed      # demo data (empty DB only)
npm run db:reset     # drop + migrate + seed (dev only)
npm run db:generate  # create a migration after editing src/lib/db/schema.ts
npm run typecheck
npm test             # unit tests (pricing engine, workflow, tenant scoping)
```
