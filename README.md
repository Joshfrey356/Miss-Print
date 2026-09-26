# Miss Print Command Center

Internal operations software for **Miss Print** (Print · Design · Signs), serving Munster & Hammond, Indiana since 1986.

One place to see and run the business: jobs, quotes, customers, production, proofs, messages, calendar and money. Built to be simple enough that no one needs training.

| For the owner | For employees |
|---|---|
| "I can see everything that's happening without having to ask everyone." | "I always know what I need to work on next." |

## What's in it (Phase 1)

- **Dashboard.** A *Needs Attention* list (each alert opens the affected jobs), today's counts, sales/cash/AR/profit cards and a few useful charts. Every role gets its own "My work" view.
- **Jobs.** An MP-##### number, 18 clear statuses and a one-click **Next Step** that skips steps a job doesn't need. Jobs are automatically handed from Munster to Hammond when they reach production. Each job has files, a chat, tasks, money and a full history.
- **Production board.** Drag and drop between stages, with filters for today / this week / location / department / person / rush. **TV mode** (`/tv`) shows a shop monitor view with no prices.
- **Quotes.**
  - A live **recommended price** from editable pricing rules, plus the **final price** you set.
  - Override reasons are kept.
  - **Similar past jobs** with the historical average.
  - Price lookup ("show me every 4x8 banner").
  - **One-click Convert to Job**.
- **Proofs.** Versions V1, V2, V3… are never overwritten. **Send Proof** gives the customer a secure link (no account needed) to **Approve** or **Request changes**, with a full audit trail.
- **Customers.** Who they are, what we're doing for them, what they ordered before, and whether they owe money. **Reorder** on any past job.
- **Money.**
  - Invoices from jobs, payments, and quick expenses with receipt photos.
  - AR aging with a **Send Reminder** button.
  - Quoted vs. actual job profit.
  - CSV export.
- **Calendar, tasks, messages** (job chat with @mentions), **notifications**, **reports**, **business rules**, **knowledge**, and **⌘K / Ctrl+K search** across everything.
- **Roles:** Owner/Admin, Manager, Sales/Front Counter, Designer, Production, Installer, Accounting. Everyone sees only what matters to their role; this is enforced on the server.

## Quick start (development)

Requires Node 20.9+ and PostgreSQL 14+ (with the `pg_trgm` extension, which is standard on Supabase, Neon and RDS).

```bash
cp .env.example .env.local        # set DATABASE_URL
npm install
npm run db:migrate                # create tables
npm run db:seed                   # demo data (optional)
npm run dev                       # http://localhost:3000
```

Demo sign-ins (password `missprint2026`):

| Email | Role |
|---|---|
| owner@missprintusa.com | Owner / Admin |
| jen@missprintusa.com | Manager |
| alex@missprintusa.com | Sales / Front Counter |
| sarah@missprintusa.com | Designer |
| mike@missprintusa.com | Production |
| tony@missprintusa.com | Installer |
| dana@missprintusa.com | Accounting |

Useful scripts: `npm run db:setup` (go-live: migrate + starter categories/pricing + owner account from `OWNER_EMAIL`/`OWNER_PASSWORD`, no demo data), `npm run db:reset` (dev only: drop, migrate, seed), `npm run typecheck`, `npm test`, `npm run build`.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · PostgreSQL · Drizzle ORM. Email, file storage, accounting (QuickBooks) and AI each sit behind a provider interface, so vendors can change without rewriting the app.

## Documentation

- [Product spec](docs/MISS_PRINT_PRODUCT_SPEC.md): company, users, workflow, architecture, roadmap
- [Database schema](docs/DATABASE_SCHEMA.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): milestones, go-live checklist, backups
- [Questions for the owner](docs/QUESTIONS_FOR_OWNER.md)
- [Code conventions](docs/CONVENTIONS.md)

## Security

- Passwords are bcrypt-hashed, and only a hash of each session token is stored. Cookies are httpOnly/SameSite and Secure in production. Sign-in is rate-limited.
- Every page, action and API route checks permissions on the server. Prices, costs and margins are removed from the data for roles that can't see them.
- Queries are parameterized, and there is no raw HTML rendering of user content. Files are downloaded only through an authenticated route, and inline SVG is sandboxed.
- Business records are archived, not deleted. Invoices and payments are voided with a reason. Every important change is written to the activity log with before/after values.
- Secrets live only in environment variables (`.env.local` is git-ignored).

## Preview mode (no setup)

If **no `DATABASE_URL` is set** (e.g. a fresh Vercel deploy), the app runs in **preview mode**: an in-memory Postgres (PGlite) loaded with the made-up demo data from `preview/demo.sql.gz`, with all dates shifted to look current. The sign-in page shows one-click "Enter as Owner / Production / …" buttons, no password needed. Changes are not permanent.

Preview mode can never touch real data: the password-free sign-in is refused as soon as `DATABASE_URL` is set, and the app then uses the real database. Regenerate the demo data after changing the seed with `./scripts/build-preview-data.sh`.
