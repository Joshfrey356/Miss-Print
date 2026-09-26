# Implementation Plan

The build is split into milestones. Each one leaves the system usable. **Phase 1 is complete** in this repository; later phases are planned below.

Legend: ✅ done · 🔜 next · ⏳ later

---

## Phase 1: Foundation ✅

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1 | Application shell | ✅ | Sidebar with 8 sections, one **+ New** button, ⌘K search, notification bell, phone tab bar |
| 2 | Authentication | ✅ | Email/password (bcrypt), hashed session tokens, httpOnly cookies, login rate limit, sliding 30-day sessions |
| 3 | Roles & permissions | ✅ | 7 roles; checked on the server for every page, action and API route; money, costs and margins removed from data for roles that can't see them |
| 4 | Database | ✅ | Drizzle schema, migrations, realistic seed (17 customers, ~800 jobs over 12 months, quotes, invoices, expenses) |
| 5 | Owner dashboard | ✅ | Needs Attention (each alert links to the affected jobs), Today tiles, 8 money cards, revenue-by-month, sales-by-product, win rate, jobs completed; per-role "My work" view |
| 6 | Customers | ✅ | Search and filters, profile answering who / what / history / balance, contacts, files, call log, duplicate warning |
| 7 | Quotes | ✅ | Live **recommended vs final** price, override reasons, **Similar Past Jobs** with historical average, price lookup ("4x8 banner"), send, accept/decline, **one-click Convert to Job** |
| 8 | Pricing system | ✅ | Per-category rules (per sq ft, quantity tiers, per piece, custom) + company business rules, admin UI with a "Try it" calculator |
| 9 | Jobs | ✅ | 18 statuses, one-click **Next Step** that skips steps the job doesn't need, automatic advances, location handoff (Munster → Hammond) |
| 10 | Production board | ✅ | Drag and drop (saved), filters, "what's next" sort, **TV mode** without financials |
| 11 | Job detail | ✅ | Items, assignments, notes, files, proofs, chat, tasks, money, history, printable job ticket |
| 12 | Files | ✅ | Folders per job, authenticated downloads, basic honest file check, phone camera upload |
| 13 | Proofs | ✅ | Versioned (never overwritten), secure customer link without an account, approve / request changes with audit trail, locked approved version |
| 14 | Internal communication | ✅ | Job chat with @mentions (including group mentions like @production), department channels, Mentions view |
| 15 | Tasks | ✅ | Inline add, assign, due date, check off; on dashboard and jobs |
| 16 | Calendar | ✅ | Day / week / month; job due dates, installs, deliveries, reminders |
| 17 | Money | ✅ | Invoices from jobs, payments, void with reason, quick expense entry with receipt and job link, AR aging with **Send Reminder**, profitability (quoted vs actual), CSV export |
| 18 | Global search | ✅ | ⌘K across jobs, customers, contacts, phone numbers, quotes, invoices; typing a job number opens the job |
| 19 | Notifications | ✅ | Mentions, assignments, proof responses, artwork uploaded; per-user preferences |
| 20 | Reports | ✅ | Revenue, profitability, operations, sales, customers; date presets; CSV |
| 21 | Business rules & knowledge | ✅ | Owner-editable rules; knowledge articles |
| 22 | Activity history | ✅ | Every important change logged with who, what, when and before/after |

### Before going live (checklist)

1. **Answer the owner questions** in [`QUESTIONS_FOR_OWNER.md`](./QUESTIONS_FOR_OWNER.md), at least pricing, locations, tax and invoice numbering.
2. **Enter real business rules and pricing** in Settings → Business Rules / Pricing Rules. The seeded numbers are placeholders.
3. **Create real users** in Settings → Team and deactivate the demo users. Better still, start from an empty database (see below).
4. **Hosting.** Any Node host (Vercel, Render, Fly, a small VPS) plus managed Postgres (Supabase, Neon, RDS). Set `DATABASE_URL`, `APP_URL`, `NODE_ENV=production`.
5. **File storage.** The local disk driver is fine on a single server with backups. On serverless hosting, implement the Supabase Storage or S3 driver in `src/lib/storage` (the interface is ready).
6. **Email.** Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, and verify the missprintusa.com domain in Resend (SPF/DKIM).
7. **Backups:**
   - Managed Postgres daily point-in-time recovery (at least 7 days).
   - A nightly `pg_dump` to separate storage (e.g. an S3 bucket in another account), kept 30 days.
   - Versioning or replication on the file bucket.
   - A **restore test** once per quarter.
8. **HTTPS only** (the host provides it). Cookies become `Secure` automatically in production.
9. Import existing customers (Phase 2 import wizard, or a one-time script).

To start clean in production: `OWNER_EMAIL=… OWNER_PASSWORD=… OWNER_NAME="…" npm run db:setup`. This migrates the database and creates the locations, product categories with starter pricing rules, vendors, materials and one owner account, with no demo customers or jobs.

---

## Phase 2: Automate the busywork 🔜

Order chosen by time saved per week.

| # | Milestone | What it involves |
|---|---|---|
| 2.1 | **Customer email templates** | Template table or files for: quote ready, proof ready, proof reminder, artwork needed, job approved, in production, ready for pickup, installation scheduled, invoice sent, payment reminder, thank you, reorder reminder. Editable text with `{customer}`, `{job}` placeholders. Every send logged to `communications` (already done for the existing sends). |
| 2.2 | **Automations engine** | `automation_rules` + `automation_runs`. A cron route (`/api/cron/automations`, called every 15 min by the host) evaluates triggers: quote sent + N business days, proof sent + N days, invoice overdue, job due tomorrow. Actions: send email, notify employee, create task. **Off by default**, one rule per trigger, business days only, never twice to the same customer per window. Settings UI already exists (Settings → Automations). |
| 2.3 | **Invoice PDF + email** | Render invoice as PDF (Satori or Puppeteer) and attach it to the email. |
| 2.4 | **Installations view** | Phone-first installer page: today's installs, address → maps, site photos (already supported via `install_photos`), checklist, signature pad, big "INSTALLATION COMPLETE" button that moves the job and notifies the office. |
| 2.5 | **Inventory (critical materials only)** | `inventory_transactions`; low-stock alert on the dashboard; "use material" from the job page. |
| 2.6 | **Purchase orders** | Draft → ordered → received; linked to jobs and vendors; receiving updates inventory. |
| 2.7 | **Import wizard** | Upload CSV/XLSX → map columns → preview with validation errors → import in a batch that can be rolled back. Customers first, then historical jobs (for price lookup), then pricing lists and QuickBooks exports. |
| 2.8 | **File preflight** | Read PNG/JPEG/TIFF headers for pixel size; compute effective DPI from the job's dimensions; flag RGB vs CMYK where detectable; parse PDF page boxes for bleed. Still flagged as "Looks good / Review / Problem"; a person decides. |
| 2.9 | **Advanced reports** | Saved report views, year-over-year, salesperson commission basis. |

## Phase 3: Customers & intelligence ⏳

| # | Milestone | What it involves |
|---|---|---|
| 3.1 | **Customer portal** | Magic-link sign-in; current jobs and status, quotes, proofs to approve, invoices, past orders with **Reorder**, files. Uses a separate query layer that selects **only** customer-safe columns (no internal notes, cost, margin or staff chat). |
| 3.2 | **Online quote requests** | Public form per product (banner: size/qty/indoor-outdoor/finishing/deadline/artwork; wrap: year/make/model/body/coverage/existing graphics; sign: size/material/illuminated/install/location/photos). Creates an inquiry for a person to price. |
| 3.3 | **Email intake** | Inbound webhook for orders@missprintusa.com (Postmark or Resend inbound). AI extracts customer, product, quantity, dimensions, deadline and attachments into a **draft** that a person confirms before anything is created. |
| 3.4 | **Ask Miss Print** | Natural-language questions answered from **real database records** through a fixed set of safe, read-only query tools (due tomorrow, overdue, last banner for X, who owes > $1,000…). Shows the records it used; says "no data" when there is none; never invents numbers. Uses `AIProvider`. |
| 3.5 | **AI pricing assistant** | From a job description: similar jobs (semantic search via pgvector), estimated materials, historical price range, suggested starting price and target margin. **Suggestions only — a person sets and approves every price.** |
| 3.6 | **QuickBooks sync** | Implement `AccountingProvider` for QuickBooks Online (OAuth2). One-way push of customers, invoices and payments (expenses optional), storing `external_id`. QuickBooks stays the accounting system of record. |
| 3.7 | **SMS** | Twilio provider for proof-ready, ready-for-pickup and reminders, with opt-in tracking per contact. |
| 3.8 | **Google Calendar** | Two-way sync of install and delivery appointments using `calendar_events.external_id`. |

## Phase 4: Scale ⏳

- Corporate storefronts: private catalogs of approved items per customer, with employee ordering.
- Inventory forecasting from upcoming jobs.
- Production scheduling and machine/resource planning.
- Payments (Stripe) on invoices and in the portal.

---

## Engineering notes

- **Tests.** Unit tests cover the pricing engine and the workflow rules (`npm test`). Before Phase 2, add Playwright tests for the main flows: quote → job → proof → invoice → payment. The flows were verified manually and by script during Phase 1.
- **Performance.** Every list is paginated and filtered on the server; hot columns are indexed; the board loads only open jobs plus the last 7 days of completed ones.
- **Ownership of rules.** Pricing logic lives only in `src/lib/pricing/engine.ts`, and status logic only in `src/lib/jobs/workflow.ts` and `service.ts`. Change behavior there, not in pages.
- **Migrations.** Edit `schema.ts` → `npm run db:generate` → review the SQL → `npm run db:migrate`. Never edit an applied migration.
