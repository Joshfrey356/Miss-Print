# Print Shop Command Center

Operations software for print, sign and design shops — built first for **Miss Print** (Print · Design · Signs), serving Munster & Hammond, Indiana since 1986, and now **multi-tenant**: any number of print shops can each run their own, completely separate shop on one deployment, under their own name and logo.

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

## Multiple shops (multi-tenancy) & white-label

- **Each shop is a tenant.** Its jobs, quotes, customers, files, money, settings and people are visible only to its own team. Every business table carries `tenant_id`; every query is scoped to the signed-in person's shop, and composite foreign keys make the database refuse any row that points at another shop's data. `npm test` includes a check that fails on unscoped queries.
- **White-label.** In **Settings → Company Profile** each shop sets its **company name** and uploads a **logo** (PNG, JPG, WebP, GIF or SVG, up to 2 MB). They appear in the sidebar, the browser tab (title and icon), the sign-in page, customer proof pages, and as the sender name on customer emails (replies go to the shop's email). Without a logo, the name is shown as a wordmark.
- **New shops sign up at `/signup`.** They get a starter location, price list, vendors and materials, all editable in Settings (add more locations under **Settings → Locations**). Set `SIGNUP_CODE` to require a code for new shops, or `SIGNUP_DISABLED=1` to turn sign-up off.
- **Adding people.** Settings → Team → **Add person** emails them an invite to choose their own password (the link works for 7 days); the list shows "Invited" until they first sign in, and each person's menu can resend an invite or email a password reset link. The sign-in page has **Forgot password?**. If email isn't set up, the app shows the link so you can send it yourself. You can still set a temporary password instead.
- **Signing in.** A person's email decides their shop, so emails are unique across all shops. The sign-in page shows the brand of the shop last used on that device; share `/login?shop=<slug>` to show a specific shop's brand.
- Job, quote and invoice numbers are counted per shop.
- An existing single-shop database is upgraded automatically: everything becomes shop #1 (named from its company profile) and numbering continues where it left off.

## Estimating, front counter, import & QuickBooks (replacing Printer's Plan)

- **Print estimating.** Set up once in Settings:
  - **Paper & Stock:** sheet size and cost per 1,000.
  - **Presses & Equipment:** digital click charges; offset plates, make-ready, run speed and hourly rates.
  - **Bindery & Services:** cutting, folding, stapling, padding and more, priced per job, piece, 1,000, sheet or hour.

  Any product category can use **Print estimating (paper + press)**. The quote then works out:
  - how many pieces fit on a sheet, and how to cut parent sheets down to press size
  - spoilage
  - paper with markup
  - clicks, or plates plus press time and ink
  - bindery

  With no press picked it prices every press and suggests the cheapest ("best price"). A quote line can carry extra quantities ("500 for $X · 1,000 for $Y"), shown on the quote, in the email and on a printable customer quote. Job tickets show the shop floor how to run the job (press, paper, cut, N-up, sheets to pull) without prices. New shops start with a starter catalog and print-estimated categories for cards, flyers, brochures, postcards and letterhead.
- **Front counter** (`/counter`):
  - Walk-in and on-file sales from the price list or custom items.
  - Payment by cash (with change), check, card on your terminal, or card by phone (QR code, through the shop's Stripe account). Split payments are allowed, or a balance can be left owing.
  - "Needs production" also creates the job.
  - Deposits on jobs and quotes, payments on open invoices.
  - Printable 80 mm or emailed receipts.
  - An **end-of-day** cash count with over/short.
- **Card payments (Stripe).** Each shop connects its own Stripe account in Settings → Integrations (secret key + webhook signing secret; the page shows the webhook URL). Invoices get "Pay online" links and QR codes, and payment reminders include the link. Payments are recorded exactly once, from the webhook or when the customer returns.
- **Import data** (Settings → Import Data). Bring in customers, contacts, past jobs, paper & materials and vendors from Printer's Plan exports or any CSV/Excel file:
  - Columns are matched automatically, with a preview that flags problems.
  - Existing records are filled in, not duplicated.
  - Past jobs keep their old numbers.
  - Each import can be undone.
- **QuickBooks Online.** Each shop connects its own QuickBooks company in Settings → Integrations. Customers, invoices (as `INV-7001`), payments and voids are sent automatically in the background. The card shows what's synced and what failed, with Retry, and a start date keeps invoices already entered by hand from being doubled. QuickBooks Desktop isn't supported.
- **Server setup for these:** `APP_SECRET_KEY` (encrypts each shop's Stripe keys and QuickBooks tokens; must never change), `APP_URL` (public address for pay links, webhooks and the QuickBooks redirect), and for QuickBooks the platform's Intuit app keys `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` (redirect URI `<APP_URL>/api/quickbooks/callback`). See `.env.example`.

## Inventory, scheduling & customer portal

- **Inventory & purchasing** (`/inventory`):
  - Track paper and materials: on hand, reserved for jobs, on order and available, with Low / Out / "Short for jobs" warnings.
  - Jobs reserve the paper their estimate needs, and it's deducted when the job moves past production.
  - Receive, use, adjust and count stock, with a full history.
  - Purchase orders (PO-1001…): email or print to the vendor, receive in parts, and charge lines to a job.
  - Suggested orders by vendor.
  - QR shelf labels that open the item on a phone.
  - Job profit everywhere counts purchase-order and stock costs.
- **Equipment schedule** (`/schedule`):
  - Day and week board per machine with drag & drop.
  - A queue of work waiting to be scheduled, with run times taken from the estimate.
  - One-click or automatic scheduling.
  - Warnings for double-booking, going over capacity, outside hours or ending after the due date.
  - Machine hours and work days are set in Settings → Presses & Equipment, and the machines' day shows at `/tv?view=machines`.
- **Customer portal** (`/portal`, set up in Settings → Customer Portal):
  - Customers sign in with an emailed link, no password, and everything is branded as the shop.
  - They can see their orders and status, upload artwork, approve proofs, accept or decline quotes, pay invoices online, and request reorders, quotes or send a message.
  - Staff handle requests in **Requests**, and invite customers from the customer page.
- **Job number prefix** per shop (Settings → Company Profile), e.g. MP-10428 or LS-1002.
- **Front counter extras:** starting cash in the end-of-day count, a checkout bar on phones, add a customer without leaving the page, and reprint the last receipt.

## Quick start (development)

Requires Node 20.9+ and PostgreSQL 14+ (with the `pg_trgm` extension, which is standard on Supabase, Neon and RDS).

```bash
cp .env.example .env.local        # set DATABASE_URL
npm install
npm run db:migrate                # create tables
npm run db:seed                   # demo data (optional)
npm run dev                       # http://localhost:3000
```

Demo sign-ins (password `missprint2026`). The demo data has two shops: **Miss Print** and a small second shop, **Lakeshore Signs** (`owner@lakeshoresigns.example`), to show that shops can't see each other's data.

| Email | Role |
|---|---|
| owner@missprintusa.com | Owner / Admin |
| jen@missprintusa.com | Manager |
| alex@missprintusa.com | Sales / Front Counter |
| sarah@missprintusa.com | Designer |
| mike@missprintusa.com | Production |
| tony@missprintusa.com | Installer |
| dana@missprintusa.com | Accounting |

Useful scripts: `npm run db:setup` (go-live: migrate + Miss Print's starter categories/pricing + owner account from `OWNER_EMAIL`/`OWNER_PASSWORD`, no demo data), `npm run db:reset` (dev only: drop, migrate, seed), `npm run typecheck`, `npm test`, `npm run build`.

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

## Going live on Vercel + Supabase

1. In Vercel → miss-print → Environment Variables, set `DATABASE_URL` (Supabase **Transaction pooler** URI, port 6543), `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (the `sb_secret_…` key), `STORAGE_DRIVER=supabase` and `APP_URL`.
2. Redeploy. Production builds run the database migrations automatically (`scripts/migrate.ts --deploy`).
3. Open the site. On an empty database it sends you to **/setup** to create the first shop and its owner account; that also loads a starter location, pricing, vendors and materials. `/setup` closes for good once a user exists. Other shops then join at **/signup**.
4. **Email** (team invites, password resets, proofs, quotes, payment reminders): create a [Resend](https://resend.com) account, verify your sending domain there, and set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Command Center <orders@yourdomain.com>`, on the verified domain) and `APP_URL` (your site's address, used in emailed links). Without these, emails are only written to the server log — the app then shows invite links so you can send them yourself.
5. Optional: `APP_NAME` (the platform name shown before anyone signs in) and `SIGNUP_CODE` / `SIGNUP_DISABLED`. Each shop's name is used as the email sender name, and replies go to the shop's email.

Uploads go to a private Supabase Storage bucket (`miss-print-files`, created automatically), filed per shop, and are only ever served through the permission-checked `/api/files` routes. The one exception is each shop's logo, served publicly from `/brand/<shop id>/logo` so it can appear on the sign-in and proof pages.

## Preview mode (no setup)

If **no `DATABASE_URL` is set** (e.g. a fresh Vercel deploy), the app runs in **preview mode**: an in-memory Postgres (PGlite) loaded with the made-up demo data from `preview/demo.sql.gz`, with all dates shifted to look current. The sign-in page shows one-click "Enter as Owner / Production / …" buttons, no password needed. Changes are not permanent.

Preview mode can never touch real data: the password-free sign-in is refused as soon as `DATABASE_URL` is set, and the app then uses the real database. Regenerate the demo data after changing the seed with `./scripts/build-preview-data.sh`.
