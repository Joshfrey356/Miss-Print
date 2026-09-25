# Miss Print Command Center — Product Spec

> Working name: **MISS PRINT COMMAND CENTER**
> Status: Phase 1 in development · Last updated September 2026

## 1. The company

| | |
|---|---|
| **Name** | Miss Print — *Print · Design · Signs* |
| **Founded** | 1986 (public listings say "since 1986" / "38+ years") |
| **Owner** | Rick Baltensberger (per public business listings; confirm) |
| **Market** | Northwest Indiana and Chicagoland |
| **Main location** | 8244 Calumet Ave, Munster, IN 46321 · 219-836-2517 |
| **Orders email** | orders@missprintusa.com |
| **Websites** | https://missprintusa.com (primary), https://www.missprintindiana.com (older site, still indexed) |
| **Hours (public listings)** | Mon–Fri 8:30 am–5:00 pm · Sat 9:00 am–12:00 pm · Sun closed |
| **Size** | Lean staff (public listings put it at 11–50 employees) |

**Research notes.** The sandbox used to build this could not reach either company website, so everything above comes from search-engine results, Yelp, Yellow Pages, BBB, Facebook and Chamber of Commerce listings. Some of those listings are old. Two things to confirm with the owner:

- **Hammond address.** Yellow Pages lists *6937 Calumet Ave, Hammond, IN 46324 · (219) 933-0833*. This may be out of date. The software stores addresses in **Settings → Locations**, so fixing it is a quick edit.
- **Hours.** The Labor Day flyer shows the shop opening at 8:30 AM, which matches the listed weekday hours.

### Locations and what they do

| Location | Role | Typical work |
|---|---|---|
| **Munster** (8244 Calumet Ave) | Customer-facing. Front counter, intake, quoting | Business cards, brochures, flyers, envelopes, forms, letterhead, folders, mailers, digital and offset printing, variable data |
| **Hammond** | Production facility, not a retail counter | Signs, banners, large format, wall graphics, vehicle graphics and wraps, backlit signs, substrates |
| **Off-site** | Installations at the customer's site | Building signs, wraps, wall graphics |

A single job can pass through more than one location. For example, Munster intake → design → Hammond production → off-site installation. The system tracks **who owns the next step** for every job.

### What they sell

Commercial and digital print: business cards, brochures, flyers, posters, envelopes, forms, letterhead, folders, mailers, labels, stickers, offset printing, variable-data printing.
Signs and large format: banners, yard signs, commercial signs, backlit signs, retractable banner stands, wall graphics and wraps, decals, vehicle graphics and wraps, large-format printing.
Services: graphic design, installation, custom work.

**Much of the work is custom.** The software never assumes that every price can come from a formula.

## 2. Guiding principle

> *"Could a small-business owner who has run his company for decades open this tomorrow and understand it?"*

Before adding any feature, ask:

1. Does it save Miss Print time?
2. Does it prevent mistakes?
3. Does it make information easier to find?
4. Does it help employees communicate?
5. Does it move knowledge out of one person's head?
6. Does it show where the profit is?
7. Does it make customers easier to serve?

If the answer to all of these is no, don't build it.

Target outcomes:
- **Owner:** "I can see everything that's happening without having to ask everyone."
- **Employees:** "I always know what I need to work on next."

## 3. Users and roles

| Role | Sees | Cannot see or do |
|---|---|---|
| **Owner / Admin** | Everything: finances, margins, reports, pricing rules, team, settings, integrations | — |
| **Manager** | Jobs, customers, quotes, production, schedule, messages, basic reports | Margins and costs, pricing-rule editing, team management |
| **Sales / Front Counter** | Customers, inquiries, quotes, orders, artwork uploads, job status, communication | Costs, margins, money reports |
| **Designer** | Design queue, files, artwork, proofs, revisions, deadlines, messages | Prices, money |
| **Production** | Jobs ready for production: specs, quantities, materials, files, deadlines, priority, notes | Prices, money, customers' financial data |
| **Installer** | Installation jobs: addresses, contacts, dates, instructions, photos, checklist | Prices, money |
| **Accounting** | Invoices, payments, expenses, balances, reports | Pricing-rule editing, team management |

Permissions are enforced **on the server** for every page, API route and form submission. Hiding a button is only for convenience. Anything a role may not see (cost, margin, internal price) is removed from the data **before** it reaches the browser.

## 4. Operational workflow

```
CUSTOMER → INQUIRY → QUOTE → APPROVAL → ARTWORK → PROOF → CUSTOMER APPROVAL
→ PRODUCTION → QUALITY CHECK → READY (PICKUP / DELIVERY / INSTALL)
→ INVOICE → PAYMENT → COMPLETE → EASY REORDER
```

Jobs are **not forced through every step**. Each job has three switches: *needs design*, *needs proof* and *needs installation*. The **Next Step** button moves the job to the next step that applies to it:

- A repeat business-card order with approved artwork goes straight from *Approved* to *Approved for Production* to *Production* to *Ready for Pickup*.
- A vehicle wrap goes through design, proofing, production and installation.

### Job statuses

`New · Needs Quote · Quote Sent · Approved · Waiting for Artwork · Design · Proof Ready · Waiting for Customer Approval · Approved for Production · Production · Finishing · Quality Check · Ready for Pickup · Scheduled for Delivery · Scheduled for Installation · Completed · On Hold · Cancelled`

### Automatic status changes

| Event | Job becomes |
|---|---|
| Quote converted to a job | Approved, or *Waiting for Artwork* if design is needed and there is no artwork yet |
| Artwork uploaded while *Waiting for Artwork* | Design (if design needed), otherwise Approved for Production |
| Designer uploads a proof | Proof Ready |
| Proof sent to the customer | Waiting for Customer Approval |
| Customer approves the proof | Approved for Production |
| Customer requests changes | Design |
| Production marks the job done | Quality Check |
| Quality check passed | Ready for Pickup / Scheduled for Delivery / Scheduled for Installation |

People can always override the status manually. Every status change is recorded with who made it and when.

### Production board columns

| Column | Statuses |
|---|---|
| Incoming | New, Needs Quote, Quote Sent, Approved |
| Needs Artwork | Waiting for Artwork |
| Design | Design |
| Proof Approval | Proof Ready, Waiting for Customer Approval |
| Ready for Production | Approved for Production |
| Printing | Production |
| Finishing | Finishing, Quality Check |
| Installation | Scheduled for Installation |
| Ready | Ready for Pickup, Scheduled for Delivery |
| Complete | Completed (last 7 days) |

Dragging a card into a column sets the job to that column's main status and records it in the job history.

## 5. Architecture

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router) + React 19 + TypeScript** | Server components keep data on the server; one codebase for UI and API |
| Styling | **Tailwind CSS v4** with small hand-written shadcn-style components | Clean and consistent, with no component-library lock-in |
| Database | **PostgreSQL** (works with Supabase, Neon, RDS or plain Postgres) | Relational data and strong integrity |
| ORM | **Drizzle ORM** + drizzle-kit migrations | Typed SQL, simple migrations, no heavy runtime |
| Auth | Built-in email/password: bcrypt hashes, random session tokens stored **hashed** in the database, httpOnly/SameSite cookies | No third-party dependency; can be swapped for Supabase Auth later |
| Mutations | Server Actions, each checking permissions on the server | Next.js provides CSRF protection for Server Actions |
| Files | `StorageProvider` interface. Local disk driver now; Supabase Storage or S3 driver later | Files are served only through an authenticated route that checks permissions |
| Email | `EmailProvider` interface. `console` driver in development, `resend` driver when `RESEND_API_KEY` is set | Swappable; every message is logged to the customer/job timeline |
| Accounting | `AccountingProvider` interface (`none` now, `quickbooks` later) | QuickBooks stays the accounting record; this app holds the operational data |
| AI | `AIProvider` interface (not active in Phase 1) | AI helps people; it never acts on its own |
| SMS / Payments | Twilio / Stripe, later, behind the same kind of provider interfaces | — |

### Code layout

```
src/
  app/
    (auth)/login            sign-in
    (app)/                  signed-in app shell (sidebar, top bar)
      dashboard  jobs  jobs/board  jobs/[number]  quotes  quotes/new  quotes/[id]
      customers  customers/[id]  calendar  messages  money  reports  tasks
      settings (team, pricing, business rules, locations)
    tv/                     Production TV mode (no financials)
    api/                    search, files, notifications
  components/               UI kit + feature components
  lib/
    db/ (schema, client)    auth/ permissions/ pricing/ jobs/ (status workflow)
    activity  notifications  storage/  email/  accounting/  ai/  events
scripts/                    migrate, seed, reset
drizzle/                    SQL migrations
docs/                       this folder
```

### Security

- Passwords hashed with bcrypt (cost 12). Sessions use 256-bit random tokens; only their SHA-256 hash is stored.
- Cookies: `httpOnly`, `sameSite=lax`, `secure` in production. Sessions expire after 30 days and are extended while in use.
- Sign-in attempts are rate-limited per IP address and per email.
- Every Server Action and API route calls `requireUser()` and `requirePermission()`.
- All queries are parameterized (Drizzle). React escapes output, and the app never uses raw HTML injection for user content.
- Files are stored under random keys and downloaded only through `/api/files/[id]` after a permission check.
- Secrets live only in environment variables (`.env.local`, never committed). `.env.example` documents them.
- Financial records are never hard-deleted. Invoices are *voided* with a reason, and customers and jobs are *archived*.
- An activity log records who did what, when, and the previous value where it matters.
- **Backups:** use the host's daily point-in-time Postgres backups (Supabase, Neon or RDS) plus a nightly `pg_dump` to separate storage, and turn on file-storage versioning. See `docs/IMPLEMENTATION_PLAN.md`.

## 6. Database

See [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md). Summary:

- Money is stored as **integer cents** so there are no rounding errors.
- Human-readable numbers come from database sequences: jobs `MP-10428`, quotes `Q-5012`, invoices `INV-7001`.
- Records are archived (soft-deleted) with `archived_at`, not removed.

## 7. UI principles

- **Eight top-level sections:** Dashboard, Jobs, Quotes, Customers, Calendar, Messages, Money, Reports. Settings sits in the user menu, for the owner only.
- **One obvious `+ New` button:** New Quote, New Job, New Customer, New Expense.
- **⌘K / Ctrl+K** global search from anywhere, with an exact job-number match opening the job.
- Large readable text (16px base), clear buttons, almost no animation.
- Desktop first. Tablets and phones get a bottom tab bar and larger tap targets.
- Empty states say what they mean: "No jobs are waiting for proof approval", not "No data".
- Destructive actions (void, archive, cancel) always ask for confirmation.
- Toasts are short and used sparingly.

## 8. Feature roadmap

### Phase 1 — Foundation (this build)
Authentication · roles and permissions · owner dashboard with *Needs Attention* · customers (CRM) · quotes with the pricing engine, recommended vs final price, override reasons and similar past jobs · one-click Convert to Job · jobs with a status workflow and auto-advance · drag-and-drop production board · job detail · Production TV mode · versioned job files · proofs with versions and approval links · job chat with @mentions · activity history · tasks · calendar (day/week/month) · basic invoices, payments and expenses · job profitability (quoted vs actual margin) · AR aging · reorder · global search · notifications · reports · business rules and pricing-rule admin.

### Phase 2 — Automate the busywork
Automated customer emails with templates · quote and proof follow-up automations (configurable, off by default) · invoice reminders · inventory (critical materials only) · purchase orders · installation mobile view with photos, checklist and signature · file preflight checks · CSV/Excel import wizard · knowledge base · advanced reports.

### Phase 3 — Customers and intelligence
Customer portal (no internal data) · online quote-request forms per product · customer self-reorder · email intake from orders@ · **Ask Miss Print** assistant (answers only from database records) · AI historical-pricing assistant (suggests prices, never sends them) · QuickBooks sync · SMS.

### Phase 4 — Scale
Corporate storefronts and private catalogs · inventory forecasting · production scheduling and machine planning.

## 9. Rules for AI features (future)

- AI helps people. It does not make decisions.
- It answers only from real database records and cites them. If there is no data, it says so.
- It never invents financial figures.
- It never sends prices, emails or invoices to a customer without a person's approval.
- Every AI call goes through `AIProvider`, so the model vendor can change.
