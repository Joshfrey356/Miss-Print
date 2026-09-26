# Database Schema

The source of truth is [`src/lib/db/schema.ts`](../src/lib/db/schema.ts) (Drizzle ORM, PostgreSQL). Migrations live in `drizzle/`. This document explains the tables and why they exist.

## Conventions

| Rule | Why |
|---|---|
| **Multi-tenant: every business table has `tenant_id`** | Each print shop is a tenant (`tenants`). Every query is scoped with `tenant_id`, and references between business tables are composite foreign keys `(tenant_id, x_id) → x(tenant_id, id)`, so the database itself refuses a row that points at another shop's data. Only `tenants`, `sessions`, `login_attempts` and `mentions` have no `tenant_id`. |
| **Money is integer cents** (`*_cents`) | No floating-point rounding errors. `$185.00` is stored as `18500`. |
| **Dimensions in inches** (`width_in`, `height_in`, numeric) | One unit everywhere. The UI shows feet (`4' × 8'`) when the size is whole feet. |
| **Business dates are `date`** (`due_date`, `issue_date`) | "Due Friday" means Friday in shop time (America/Chicago), not a UTC instant. |
| **Moments are `timestamptz`** (`created_at`, `sent_at`) | The exact time something happened. |
| **Soft delete** (`archived_at`) | Business records are never casually deleted. |
| **Void, don't delete** (`invoices.voided_at` + `void_reason`, `payments.voided_at`) | Financial records need stronger protection. |
| **Human-readable numbers per shop** | Counters on `tenants` (`next_job_number` → **MP-10428**, `next_quote_number` → **Q-5012**, `next_invoice_number` → **INV-7001**), handed out by `nextNumber()` inside the inserting transaction. Numbers are unique per shop (`unique(tenant_id, number)`) and never collide, even when two people create jobs at the same moment. |
| **`external_id` columns** | Ready for QuickBooks / Google Calendar sync without schema changes. |
| **`pg_trgm` indexes** on names and titles | Fast fuzzy search ("munster polce" still finds Munster Police). |

## Entity map

```
tenants (one per print shop: name, logo, number counters)
   └─ every table below carries tenant_id

locations ─┬─ users ── sessions
           │
customers ─┼─ customer_contacts
           ├─ quotes ── quote_items
           ├─ jobs ──┬─ job_items
           │         ├─ job_status_history
           │         ├─ files ── proofs
           │         ├─ messages ── mentions
           │         ├─ tasks
           │         ├─ calendar_events
           │         └─ expenses
           ├─ invoices ── invoice_items
           │           └─ payments
           └─ communications (emails / calls log)

product_categories ── pricing_rules        materials ── vendors
company_settings (business rules)          knowledge_articles
activity_logs (who did what)               notifications
login_attempts (rate limiting)
```

## Tables

### People & access

| Table | Purpose | Key columns |
|---|---|---|
| `tenants` | One row per print shop using the app. White-label brand and per-shop number counters. | `slug` (for `/login?shop=`), `name` (brand name), `logo_storage_key`/`logo_mime_type` (served at `/brand/<id>/logo`), `next_job_number`, `next_quote_number`, `next_invoice_number`, `archived_at` (suspends the shop) |
| `locations` | A shop's places, e.g. Munster (customer-facing), Hammond (production), Off-site (installs). `code` is unique per shop. | `code`, `name`, `role`, `address`, `is_customer_facing` |
| `users` | Employees of one shop. One role each. **Email is unique across all shops** (it decides which shop you sign in to); `handle` is unique per shop. | `role` (owner, manager, sales, designer, production, installer, accounting), `handle` (used for @mentions), `password_hash` (bcrypt), `notification_prefs` (jsonb), `active` |
| `sessions` | Signed-in devices. **Only a SHA-256 hash of the token is stored.** | `id` (hash), `user_id`, `expires_at`, `ip`, `user_agent` |
| `login_attempts` | Rate limiting for sign-in (per email and per IP) | `key`, `success`, `created_at` |
| `company_settings` | Per-shop key/value company profile and **business rules**. Primary key `(tenant_id, key)`. | `key` = `business_rules` \| `company` \| `automations` \| `quote_valid_days` |

Permissions are defined in code (`src/lib/permissions.ts`), not in tables. Seven fixed roles are easier to reason about than a permission editor. If a shop later needs custom roles, add `roles` and `role_permissions` tables.

### Customers (CRM)

| Table | Purpose | Key columns |
|---|---|---|
| `customers` | Company or individual | `name`, `phone`, `email`, address, `billing_address`, `tax_exempt` + `tax_exempt_id`, `payment_terms` (due on receipt / net 15/30/45/60), `po_required`, `discount_pct` (simple customer-specific pricing, 0–1), `salesperson_id`, `notes`, `customer_since`, `external_id` |
| `customer_contacts` | People at the customer | `name`, `title`, `email`, `phone`, `is_primary` |

Lifetime revenue and outstanding balance are **calculated** from invoices, never stored, so they can't drift.

### Products & pricing

| Table | Purpose | Key columns |
|---|---|---|
| `product_categories` | Banners, Business Cards, Vehicle Wraps… | `pricing_method` (per_sqft / quantity_tier / per_unit / custom), `default_location_id` (where production happens), `default_needs_proof`, `default_needs_install` |
| `pricing_rules` | One editable pricing recipe per category | `config` (jsonb, shape = `PricingConfig` in `src/lib/pricing/engine.ts`: price per sq ft, quantity tiers, setup, waste %, markup, machine time, finishing options, design/install hours, minimum, target margin, rush %), `notes` ("How we price banners") |
| `materials` | Substrates and stocks with our cost. Inventory fields (`quantity_on_hand`, `reorder_level`) are ready for Phase 2. | `unit`, `cost_cents`, `vendor_id`, `sku` |
| `vendors` | Suppliers (Grimco, Fellers, Veritiv…) | contact info, `account_number` |

Company-wide rules (minimum charge, design rate, install rate, labor cost, mileage, rush %, target margin, outsourced markup, sales-tax rate) live in `company_settings.business_rules`. Nothing about pricing is hard-coded.

### Quotes

| Table | Purpose | Key columns |
|---|---|---|
| `quotes` | A priced proposal | `number` (Q-####), `status` (draft → sent → accepted/declined/expired → converted), `needs_design`, `needs_install`, `is_rush`, `due_date`, `valid_until`, totals in cents, `estimated_cost_cents`, `sent_at`, `responded_at`, `lost_reason` |
| `quote_items` | Lines | `category_id`, `description`, `quantity`, size, `material_id`/`material`, `finishing`, `specs`, `pricing_input` (what the engine priced), `pricing_breakdown` (why), **`recommended_cents`** vs **`price_cents`** (final), **`override_reason`**, `estimated_cost_cents`, `taxable` |

Keeping *recommended* and *final* side by side on every line shows how often, and why, people override the formula. That tells us where the pricing rules need tuning.

### Jobs

| Table | Purpose | Key columns |
|---|---|---|
| `jobs` | The unit of work | `number` (MP-#####), `status` (18 statuses), `priority` (normal / rush / critical), `location_id` (**who owns the next step**), `fulfillment` (pickup / delivery / install / ship), `needs_design` / `needs_proof` / `needs_install` (the workflow adapts to these), `salesperson_id` / `designer_id` / `production_id` / `installer_id`, `due_date`, `production_due_date`, `fulfillment_at`, `site_address`, `po_number`, totals, `estimated_cost_cents`, `labor_hours` (for actual cost), `internal_notes` vs `customer_notes`, `quote_id`, `reorder_of_job_id`, `completed_at` |
| `job_items` | Lines, copied from quote items on conversion | same shape as `quote_items` |
| `job_status_history` | Every status change, used for turnaround reports | `from_status`, `to_status`, `changed_by`, `note`, `changed_at` |

### Files & proofs

| Table | Purpose | Key columns |
|---|---|---|
| `files` | Every uploaded file | `folder` (customer, original_artwork, working, proof, production, install_photos, completed_photos, receipt), `storage_key` (random; objects are immutable and never overwritten), `mime_type`, `size_bytes`, `preflight_status` (looks_good / review / problem) + `preflight` notes |
| `proofs` | **Versioned** proofs (V1, V2, V3…), unique per job + version | `status` (draft / sent / approved / changes_requested / superseded), `token_hash` (SHA-256 of the customer link token), `token_expires_at`, `sent_to`, and the approval audit trail: `responded_at`, `responder_name`, `responder_email`, `responder_ip`, `responder_user_agent`, `customer_comment`, `approval_statement` |

Proof approvals are stored on the proof row, so there is no separate `proof_approvals` table. A proof gets exactly one customer response. After that, a new version is uploaded.

### Communication & work tracking

| Table | Purpose |
|---|---|
| `messages` | Internal chat. Either `job_id` (job conversation — the priority) or `channel` (general, front_counter, design, production, installations, management). `important` flag, optional `file_id`. |
| `mentions` | Who was @mentioned in which message (drives notifications and the Mentions view) |
| `communications` | Customer-facing log: emails sent (quote, proof, reminder), calls and notes logged, and proof responses received |
| `tasks` | Simple to-dos, optionally on a job or customer; assigned to a person; due date; completed |
| `calendar_events` | Reminders, deliveries, drop-offs — anything **not** already implied by job dates (job due dates and install times come from `jobs` directly, so they're never duplicated). `external_id` for Google Calendar later. |
| `notifications` | Per-user bell items with a `link`. Respect `users.notification_prefs`. |
| `activity_logs` | **Who did what, when.** `action` (e.g. `job.status_changed`, `quote.price_changed`, `payment.received`), links to job / customer / quote, `summary`, `data` = `{ before, after }` for changes that matter |

### Money

| Table | Purpose | Key columns |
|---|---|---|
| `invoices` | One active invoice per job (usually) | `number` (INV-####), `status` (draft / sent / partial / paid / void), `issue_date`, `due_date` (from customer terms), `po_number`, totals, `paid_cents`, `last_reminder_at`, `voided_at` + `void_reason`, `external_id` (QuickBooks) |
| `invoice_items` | Lines copied from the job | `description`, `quantity`, `amount_cents`, `taxable` |
| `payments` | Money received | `amount_cents`, `method` (cash/check/card/ach/other), `reference` (check #), `received_on`, `voided_at` |
| `expenses` | Quick expense entry | `vendor_name`/`vendor_id`, `amount_cents`, `category` (materials, ink/toner, paper, vinyl, substrates, outside services, shipping, equipment, vehicle, installation, office, marketing, payroll-related, other), `spent_on`, **`job_id`** (makes actual job profit possible), `receipt_file_id` |

**Job profitability:** actual cost = expenses attached to the job + `labor_hours` × the labor cost rate. Quoted margin comes from `estimated_cost_cents`. Both are computed when needed (`src/lib/jobs/profit.ts`, `src/lib/money/queries.ts`).

**Sales tax** is stored per quote, job and invoice (`tax_rate`, `tax_cents`), so changing the rate later never rewrites history. Tax-exempt customers get 0.

### Knowledge

| Table | Purpose |
|---|---|
| `knowledge_articles` | Institutional knowledge: pricing notes, checklists, procedures, phone numbers |

## Planned tables (not created yet)

Built only when the feature ships, so the schema doesn't carry empty tables.

| Phase | Table | Notes |
|---|---|---|
| 2 | `inventory_transactions` | Receive / use / adjust materials; `materials.quantity_on_hand` becomes the running total |
| 2 | `purchase_orders`, `purchase_order_items` | Vendor, items, qty, cost, expected date, related jobs; status draft / ordered / partially received / received |
| 2 | `installations` | Only if the job's install fields aren't enough: checklist JSON, before/after photos (already `files.folder`), customer signature file |
| 2 | `automation_rules`, `automation_runs` | Trigger (`quote.sent`, `proof.sent`, `invoice.overdue`…) → action (`send_email`, `notify_employee`, `create_task`…), with a run log so no customer is emailed twice |
| 2 | `import_batches` | CSV/Excel import wizard: mapping, preview, validation errors, rollback |
| 3 | `portal_users` or magic links | Customer portal access (customers only ever see customer-safe fields) |
| 3 | `quote_requests` | Online request form submissions → inquiry |
| 3 | `inbound_emails` | Parsed emails sent to orders@, awaiting human confirmation |
| 3 | `job_item_embeddings` (pgvector) | Semantic search for Similar Past Jobs and Ask Miss Print |
| 4 | `catalogs`, `catalog_items` | Corporate storefronts with approved products per customer |
