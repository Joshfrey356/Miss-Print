/**
 * Command Center — database schema.
 *
 * Conventions
 * - Multi-tenant: every business table has `tenant_id`. Each print shop is one tenant, and
 *   every query must be scoped with `eq(<table>.tenantId, user.tenantId)`.
 *   References between business tables are composite `(tenant_id, x_id)` foreign keys, so the
 *   database itself refuses a row that points at another shop's data.
 * - Money is stored as integer cents (`*_cents`). Never floats.
 * - Dimensions are stored in inches (numeric).
 * - Business records are archived (`archived_at`), never hard-deleted.
 * - Human-readable numbers (MP-10428, Q-5012, INV-7001) are per shop, handed out by
 *   `nextNumber()` in src/lib/tenant.ts from the counters on `tenants`.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  date,
  jsonb,
  numeric,
  index,
  uniqueIndex,
  unique,
  primaryKey,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const roleEnum = pgEnum("role", [
  "owner",
  "manager",
  "sales",
  "designer",
  "production",
  "installer",
  "accounting",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "new",
  "needs_quote",
  "quote_sent",
  "approved",
  "waiting_artwork",
  "design",
  "proof_ready",
  "waiting_approval",
  "approved_for_production",
  "production",
  "finishing",
  "quality_check",
  "ready_pickup",
  "scheduled_delivery",
  "scheduled_install",
  "completed",
  "on_hold",
  "cancelled",
]);

export const priorityEnum = pgEnum("priority", ["normal", "rush", "critical"]);
export const fulfillmentEnum = pgEnum("fulfillment", ["pickup", "delivery", "install", "ship"]);
export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "converted",
]);
export const pricingMethodEnum = pgEnum("pricing_method", ["per_sqft", "quantity_tier", "per_unit", "sheet_fed", "custom"]);
export const fileFolderEnum = pgEnum("file_folder", [
  "customer",
  "original_artwork",
  "working",
  "proof",
  "production",
  "install_photos",
  "completed_photos",
  "receipt",
  "other",
]);
export const preflightEnum = pgEnum("preflight_status", ["looks_good", "review", "problem"]);
export const proofStatusEnum = pgEnum("proof_status", [
  "draft",
  "sent",
  "approved",
  "changes_requested",
  "superseded",
]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "sent", "partial", "paid", "void"]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "check", "card", "ach", "other"]);
export const expenseCategoryEnum = pgEnum("expense_category", [
  "materials",
  "ink_toner",
  "paper",
  "vinyl",
  "substrates",
  "outside_services",
  "shipping",
  "equipment",
  "vehicle",
  "installation",
  "office",
  "marketing",
  "payroll",
  "other",
]);
export const eventTypeEnum = pgEnum("event_type", ["install", "delivery", "pickup", "deadline", "reminder", "other"]);
export const commChannelEnum = pgEnum("comm_channel", ["email", "sms", "phone", "note"]);
export const paymentTermsEnum = pgEnum("payment_terms", ["due_on_receipt", "net_15", "net_30", "net_45", "net_60"]);

// ---------------------------------------------------------------------------
// Tenants (one row per print shop)
// ---------------------------------------------------------------------------
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  /** Used in links, e.g. /login?shop=miss-print */
  slug: text("slug").notNull().unique(),
  /** White-label brand name shown across the app, proof pages and emails. */
  name: text("name").notNull(),
  /** Uploaded logo (served publicly from /brand/<id>/logo). Null = show the name as a wordmark. */
  logoStorageKey: text("logo_storage_key"),
  logoMimeType: text("logo_mime_type"),
  logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
  /** Next human-readable numbers for this shop. Handed out by nextNumber(). */
  nextJobNumber: integer("next_job_number").notNull().default(1001),
  nextQuoteNumber: integer("next_quote_number").notNull().default(1001),
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1001),
  nextPoNumber: integer("next_po_number").notNull().default(1001),
  /** Shown before job numbers: "MP" → MP-10428. Set per shop in Settings → Company Profile. */
  jobPrefix: text("job_prefix").notNull().default("J"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set to suspend a shop: its people can no longer sign in. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** `tenant_id` column for business tables. */
const tenantId = () =>
  integer("tenant_id")
    .notNull()
    .references(() => tenants.id);

/** Every business table exposes (tenant_id, id) so others can reference it with a composite FK. */
const tenantKey = (name: string, t: { tenantId: AnyPgColumn; id: AnyPgColumn }) => unique(`${name}_tenant_id_key`).on(t.tenantId, t.id);

/** Same-tenant reference: (tenant_id, <col>) → <target>(tenant_id, id). */
const ref = (name: string, tenantCol: AnyPgColumn, col: AnyPgColumn, target: { tenantId: AnyPgColumn; id: AnyPgColumn }) =>
  foreignKey({ name, columns: [tenantCol, col], foreignColumns: [target.tenantId, target.id] });

// ---------------------------------------------------------------------------
// Company, locations, people
// ---------------------------------------------------------------------------
export const locations = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    code: text("code").notNull(), // MAIN, MUNSTER, HAMMOND, OFFSITE — unique per shop
    name: text("name").notNull(),
    role: text("role").notNull().default(""), // "Customer intake & commercial printing"
    address: text("address"),
    phone: text("phone"),
    isCustomerFacing: boolean("is_customer_facing").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [tenantKey("locations", t), uniqueIndex("locations_tenant_code_idx").on(t.tenantId, t.code)],
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    handle: text("handle").notNull(), // used for @mentions, e.g. "mike" — unique per shop
    email: text("email").notNull(), // unique across all shops: it decides which shop you sign in to
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(),
    phone: text("phone"),
    title: text("title"),
    color: text("color").notNull().default("#1a8fe3"),
    locationId: integer("location_id"),
    active: boolean("active").notNull().default(true),
    /** { mentions: true, assigned: true, proofs: true, quotes: true, dueSoon: true, invoices: true } */
    notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull().default({}),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** When the last invite email went out. Pending until they first sign in (lastLoginAt). */
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("users", t),
    uniqueIndex("users_email_idx").on(sql`lower(${t.email})`),
    uniqueIndex("users_tenant_handle_idx").on(t.tenantId, t.handle),
    ref("users_location_fk", t.tenantId, t.locationId, locations),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 hash of the session token. The raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * One-time links emailed to people: "invite" (choose your password) and "reset" (forgot password).
 * Like sessions, only a SHA-256 hash of the token is stored, and it's scoped through its user.
 */
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<"invite" | "reset">().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_tokens_user_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(), // "ip:1.2.3.4" or "email:x@y.com"
    success: boolean("success").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_key_idx").on(t.key, t.createdAt)],
);

/** Key/value company settings & business rules (tax rate, minimum charge, rates…), per shop. */
export const companySettings = pgTable(
  "company_settings",
  {
    tenantId: tenantId(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "company_settings_pkey", columns: [t.tenantId, t.key] }), ref("company_settings_updated_by_fk", t.tenantId, t.updatedBy, users)],
);

/**
 * One data import (e.g. customers exported from Printer's Plan). Imported rows carry its id,
 * so a mistaken import can be undone (its rows are archived, never deleted).
 */
export const imports = pgTable(
  "imports",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    kind: text("kind").$type<"customers" | "contacts" | "jobs" | "materials" | "vendors">().notNull(),
    filename: text("filename").notNull(),
    /** { created, updated, skipped, errors: [{ row, message }] } */
    summary: jsonb("summary").$type<{ created: number; updated: number; skipped: number; errors: { row: number; message: string }[] }>().notNull(),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: integer("undone_by"),
  },
  (t) => [tenantKey("imports", t), ref("imports_created_by_fk", t.tenantId, t.createdBy, users), ref("imports_undone_by_fk", t.tenantId, t.undoneBy, users)],
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(), // company name, or person's name for individuals
    isCompany: boolean("is_company").notNull().default(true),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    billingAddress: text("billing_address"), // full block; null = same as address
    taxExempt: boolean("tax_exempt").notNull().default(false),
    taxExemptId: text("tax_exempt_id"),
    paymentTerms: paymentTermsEnum("payment_terms").notNull().default("due_on_receipt"),
    poRequired: boolean("po_required").notNull().default(false),
    /** Simple customer pricing: percent off recommended prices. */
    discountPct: numeric("discount_pct", { precision: 5, scale: 4, mode: "number" }).notNull().default(0),
    salespersonId: integer("salesperson_id"),
    notes: text("notes"),
    customerSince: date("customer_since"),
    externalId: text("external_id"), // QuickBooks customer id
    /** Set when the customer came from a data import (Settings → Import). */
    importId: integer("import_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("customers", t),
    ref("customers_salesperson_fk", t.tenantId, t.salespersonId, users),
    ref("customers_import_fk", t.tenantId, t.importId, imports),
    index("customers_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    index("customers_phone_idx").on(t.tenantId, t.phone),
  ],
);

export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    customerId: integer("customer_id").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    importId: integer("import_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("customer_contacts", t),
    ref("contacts_import_fk", t.tenantId, t.importId, imports),
    ref("contacts_customer_fk", t.tenantId, t.customerId, customers),
    index("contacts_customer_idx").on(t.customerId),
    index("contacts_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

// ---------------------------------------------------------------------------
// Products & pricing
// ---------------------------------------------------------------------------
export const productCategories = pgTable(
  "product_categories",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    slug: text("slug").notNull(), // unique per shop
    name: text("name").notNull(),
    group: text("group").notNull().default("print"), // print | sign | wrap | design | other
    pricingMethod: pricingMethodEnum("pricing_method").notNull().default("custom"),
    defaultLocationId: integer("default_location_id"),
    /** Does this kind of work usually need these steps? (defaults for new quotes/jobs) */
    defaultNeedsProof: boolean("default_needs_proof").notNull().default(true),
    defaultNeedsInstall: boolean("default_needs_install").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    tenantKey("product_categories", t),
    uniqueIndex("product_categories_tenant_slug_idx").on(t.tenantId, t.slug),
    ref("product_categories_location_fk", t.tenantId, t.defaultLocationId, locations),
  ],
);

/**
 * One pricing rule per category (the editable "recipe").
 * `config` shape is defined by `PricingConfig` in src/lib/pricing/engine.ts.
 */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    categoryId: integer("category_id").notNull().unique(),
    config: jsonb("config").notNull(),
    notes: text("notes"), // "How we price banners" — owner's own words
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("pricing_rules", t),
    ref("pricing_rules_category_fk", t.tenantId, t.categoryId, productCategories),
    ref("pricing_rules_updated_by_fk", t.tenantId, t.updatedBy, users),
  ],
);

export const vendors = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    accountNumber: text("account_number"),
    notes: text("notes"),
    importId: integer("import_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [tenantKey("vendors", t), ref("vendors_import_fk", t.tenantId, t.importId, imports)],
);

/**
 * Materials/substrates and PAPER STOCKS. A paper stock is a material with unit "sheet", a sheet
 * size and a cost per 1,000 sheets; the print estimator (src/lib/pricing/print.ts) uses those.
 * Inventory fields are for Phase 2.
 */
export const materials = pgTable(
  "materials",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(), // "13oz Scrim Vinyl Banner", "100# Gloss Text 12x18"
    kind: text("kind").notNull().default("other"), // vinyl, paper, substrate, laminate, ink…
    unit: text("unit").notNull().default("sqft"), // sqft | sheet | roll | each | ream
    costCents: integer("cost_cents").notNull().default(0), // our cost per unit
    vendorId: integer("vendor_id"),
    sku: text("sku"),
    /** Paper stocks: sheet size as bought (a parent sheet may be cut down to fit the press). */
    sheetWidthIn: numeric("sheet_width_in", { precision: 8, scale: 3, mode: "number" }),
    sheetHeightIn: numeric("sheet_height_in", { precision: 8, scale: 3, mode: "number" }),
    /** Paper stocks: "100# Text", "14pt Cover"… */
    weight: text("weight"),
    /** Paper stocks: our cost per 1,000 sheets (paper is priced per M). */
    costPerMCents: integer("cost_per_m_cents"),
    /** Paper stocks: extra charged on top of cost (0.3 = +30%). Null = the shop's default paper markup. */
    markupPct: numeric("markup_pct", { precision: 6, scale: 4, mode: "number" }),
    /** Inventory: count this item's stock (on hand, reserved for jobs, on order). */
    trackInventory: boolean("track_inventory").notNull().default(false),
    /** In the item's unit (sheets for paper). Changed only through inventory movements. */
    quantityOnHand: numeric("quantity_on_hand", { precision: 12, scale: 2, mode: "number" }),
    /** Reorder when available (on hand − reserved + on order) falls to this. */
    reorderLevel: numeric("reorder_level", { precision: 12, scale: 2, mode: "number" }),
    /** Usual amount to order. */
    reorderQuantity: numeric("reorder_quantity", { precision: 12, scale: 2, mode: "number" }),
    /** Where it's kept, e.g. "Hammond · rack B". */
    binLocation: text("bin_location"),
    importId: integer("import_id"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [tenantKey("materials", t), ref("materials_vendor_fk", t.tenantId, t.vendorId, vendors), ref("materials_import_fk", t.tenantId, t.importId, imports)],
);

/**
 * Presses and machines used by the print estimator: digital presses (click charges), offset presses
 * (plates, make-ready, run speed) and bindery equipment. Rates below a cent (clicks) are stored as
 * numeric cents with 4 decimals; every computed amount is rounded to whole cents.
 */
export const equipment = pgTable(
  "equipment",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(), // "Konica C4080", "Heidelberg GTO 52"
    kind: text("kind").$type<"digital" | "offset" | "wide_format" | "cutter" | "folder" | "bindery" | "other">().notNull(),
    locationId: integer("location_id"),
    /** Largest / smallest sheet the machine takes (press sheets). */
    maxSheetWidthIn: numeric("max_sheet_width_in", { precision: 8, scale: 3, mode: "number" }),
    maxSheetHeightIn: numeric("max_sheet_height_in", { precision: 8, scale: 3, mode: "number" }),
    minSheetWidthIn: numeric("min_sheet_width_in", { precision: 8, scale: 3, mode: "number" }),
    minSheetHeightIn: numeric("min_sheet_height_in", { precision: 8, scale: 3, mode: "number" }),
    /** Unprintable edge (gripper) on each side, inches. */
    gripperIn: numeric("gripper_in", { precision: 6, scale: 3, mode: "number" }).notNull().default(0.25),
    /** Most ink colors per side (4 = CMYK). */
    maxColors: integer("max_colors").notNull().default(4),
    /** Prints both sides in one pass. */
    perfecting: boolean("perfecting").notNull().default(false),
    /** Digital: charge and cost per printed side of one press sheet. */
    colorClickPriceCents: numeric("color_click_price_cents", { precision: 10, scale: 4, mode: "number" }),
    colorClickCostCents: numeric("color_click_cost_cents", { precision: 10, scale: 4, mode: "number" }),
    bwClickPriceCents: numeric("bw_click_price_cents", { precision: 10, scale: 4, mode: "number" }),
    bwClickCostCents: numeric("bw_click_cost_cents", { precision: 10, scale: 4, mode: "number" }),
    /** Offset: per plate (one per color per side). */
    platePriceCents: integer("plate_price_cents"),
    plateCostCents: integer("plate_cost_cents"),
    /** Offset: ink per 1,000 impressions per color. */
    inkCostPerMCents: integer("ink_cost_per_m_cents"),
    /** Setup / make-ready time per job (offset: per color), minutes. */
    setupMinutes: integer("setup_minutes").notNull().default(0),
    /** Run speed, sheets per hour. */
    sheetsPerHour: integer("sheets_per_hour"),
    /** Machine time: what we charge and what it costs us per hour. */
    hourlyPriceCents: integer("hourly_price_cents"),
    hourlyCostCents: integer("hourly_cost_cents"),
    /** Spoilage: sheets wasted in setup, plus a share of the run. */
    setupSpoilageSheets: integer("setup_spoilage_sheets").notNull().default(0),
    runSpoilagePct: numeric("run_spoilage_pct", { precision: 6, scale: 4, mode: "number" }).notNull().default(0),
    notes: text("notes"),
    /** Scheduling: hours this machine runs on a work day, and which days (0 = Sunday … 6 = Saturday). */
    hoursPerDay: numeric("hours_per_day", { precision: 5, scale: 2, mode: "number" }).notNull().default(8),
    workDays: jsonb("work_days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [tenantKey("equipment", t), ref("equipment_location_fk", t.tenantId, t.locationId, locations)],
);

/**
 * Bindery, finishing and pre-press services priced by the estimator: cutting, folding, stapling,
 * drilling, padding, laminating, file prep… Each is charged per job, per piece, per 1,000, per press
 * sheet or by the hour.
 */
export const operations = pgTable(
  "operations",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    category: text("category").$type<"prepress" | "bindery" | "finishing" | "packaging" | "shipping" | "other">().notNull().default("bindery"),
    basis: text("basis").$type<"per_job" | "per_piece" | "per_1000" | "per_sheet" | "per_hour">().notNull(),
    /** One-time charge / cost per job. */
    setupPriceCents: integer("setup_price_cents").notNull().default(0),
    setupCostCents: integer("setup_cost_cents").notNull().default(0),
    /** Per unit of the basis (per piece, per 1,000, per sheet, per hour). */
    ratePriceCents: numeric("rate_price_cents", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    rateCostCents: numeric("rate_cost_cents", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    /** per_hour: how many pieces an hour, to work out the time. */
    piecesPerHour: integer("pieces_per_hour"),
    minimumCents: integer("minimum_cents").notNull().default(0),
    equipmentId: integer("equipment_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [tenantKey("operations", t), ref("operations_equipment_fk", t.tenantId, t.equipmentId, equipment)],
);

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
export const quotes = pgTable(
  "quotes",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    number: integer("number").notNull(), // shown as Q-5012; from nextNumber(tx, tenantId, "quote")
    customerId: integer("customer_id").notNull(),
    contactId: integer("contact_id"),
    title: text("title").notNull(),
    status: quoteStatusEnum("status").notNull().default("draft"),
    salespersonId: integer("salesperson_id"),
    locationId: integer("location_id"),
    needsDesign: boolean("needs_design").notNull().default(false),
    needsInstall: boolean("needs_install").notNull().default(false),
    isRush: boolean("is_rush").notNull().default(false),
    dueDate: date("due_date"),
    validUntil: date("valid_until"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxRate: numeric("tax_rate", { precision: 6, scale: 4, mode: "number" }).notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    internalNotes: text("internal_notes"),
    customerNotes: text("customer_notes"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    /** Online acceptance from the customer portal: who, from where, and their note. */
    responseName: text("response_name"),
    responseEmail: text("response_email"),
    responseIp: text("response_ip"),
    responseNote: text("response_note"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("quotes", t),
    uniqueIndex("quotes_tenant_number_idx").on(t.tenantId, t.number),
    ref("quotes_customer_fk", t.tenantId, t.customerId, customers),
    ref("quotes_contact_fk", t.tenantId, t.contactId, customerContacts),
    ref("quotes_salesperson_fk", t.tenantId, t.salespersonId, users),
    ref("quotes_location_fk", t.tenantId, t.locationId, locations),
    ref("quotes_created_by_fk", t.tenantId, t.createdBy, users),
    index("quotes_customer_idx").on(t.customerId),
    index("quotes_status_idx").on(t.tenantId, t.status),
  ],
);

export const quoteItems = pgTable(
  "quote_items",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    quoteId: integer("quote_id").notNull(),
    categoryId: integer("category_id"),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    widthIn: numeric("width_in", { precision: 10, scale: 2, mode: "number" }),
    heightIn: numeric("height_in", { precision: 10, scale: 2, mode: "number" }),
    materialId: integer("material_id"),
    material: text("material"),
    finishing: text("finishing"),
    colors: text("colors"),
    specs: text("specs"),
    /** Inputs used by the pricing engine: selected finishing options, hours, etc. */
    pricingInput: jsonb("pricing_input"),
    /** Line-by-line explanation of the recommended price. */
    pricingBreakdown: jsonb("pricing_breakdown"),
    recommendedCents: integer("recommended_cents").notNull().default(0),
    priceCents: integer("price_cents").notNull().default(0), // FINAL price (line total)
    overrideReason: text("override_reason"),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    taxable: boolean("taxable").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    tenantKey("quote_items", t),
    ref("quote_items_quote_fk", t.tenantId, t.quoteId, quotes).onDelete("cascade"),
    ref("quote_items_category_fk", t.tenantId, t.categoryId, productCategories),
    ref("quote_items_material_fk", t.tenantId, t.materialId, materials),
    index("quote_items_quote_idx").on(t.quoteId),
    index("quote_items_category_idx").on(t.categoryId),
  ],
);

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    number: integer("number").notNull(), // shown with the shop's prefix, e.g. MP-10428; from nextNumber(tx, tenantId, "job")
    customerId: integer("customer_id").notNull(),
    contactId: integer("contact_id"),
    quoteId: integer("quote_id"),
    reorderOfJobId: integer("reorder_of_job_id"),
    title: text("title").notNull(),
    categoryId: integer("category_id"),
    description: text("description"),
    status: jobStatusEnum("status").notNull().default("new"),
    priority: priorityEnum("priority").notNull().default("normal"),
    /** Location that owns the NEXT step of this job. */
    locationId: integer("location_id"),
    fulfillment: fulfillmentEnum("fulfillment").notNull().default("pickup"),
    needsDesign: boolean("needs_design").notNull().default(false),
    needsProof: boolean("needs_proof").notNull().default(true),
    needsInstall: boolean("needs_install").notNull().default(false),
    salespersonId: integer("salesperson_id"),
    designerId: integer("designer_id"),
    productionId: integer("production_id"),
    installerId: integer("installer_id"),
    dueDate: date("due_date"),
    productionDueDate: date("production_due_date"),
    /** Pickup / delivery / install date & time. */
    fulfillmentAt: timestamp("fulfillment_at", { withTimezone: true }),
    siteAddress: text("site_address"), // install / delivery address
    siteContact: text("site_contact"),
    poNumber: text("po_number"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxRate: numeric("tax_rate", { precision: 6, scale: 4, mode: "number" }).notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    /** Estimated in-house labor for actual-cost calculation (hours × labor cost rate). */
    laborHours: numeric("labor_hours", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
    internalNotes: text("internal_notes"),
    customerNotes: text("customer_notes"),
    boardOrder: integer("board_order").notNull().default(0),
    /** Job number from the previous system (e.g. Printer's Plan) for imported history. */
    legacyNumber: text("legacy_number"),
    importId: integer("import_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("jobs", t),
    uniqueIndex("jobs_tenant_number_idx").on(t.tenantId, t.number),
    ref("jobs_customer_fk", t.tenantId, t.customerId, customers),
    ref("jobs_contact_fk", t.tenantId, t.contactId, customerContacts),
    ref("jobs_quote_fk", t.tenantId, t.quoteId, quotes),
    ref("jobs_reorder_of_fk", t.tenantId, t.reorderOfJobId, t),
    ref("jobs_category_fk", t.tenantId, t.categoryId, productCategories),
    ref("jobs_location_fk", t.tenantId, t.locationId, locations),
    ref("jobs_salesperson_fk", t.tenantId, t.salespersonId, users),
    ref("jobs_designer_fk", t.tenantId, t.designerId, users),
    ref("jobs_production_fk", t.tenantId, t.productionId, users),
    ref("jobs_installer_fk", t.tenantId, t.installerId, users),
    ref("jobs_created_by_fk", t.tenantId, t.createdBy, users),
    ref("jobs_import_fk", t.tenantId, t.importId, imports),
    index("jobs_customer_idx").on(t.customerId),
    index("jobs_status_idx").on(t.tenantId, t.status),
    index("jobs_due_idx").on(t.tenantId, t.dueDate),
    index("jobs_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

export const jobItems = pgTable(
  "job_items",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    jobId: integer("job_id").notNull(),
    categoryId: integer("category_id"),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    widthIn: numeric("width_in", { precision: 10, scale: 2, mode: "number" }),
    heightIn: numeric("height_in", { precision: 10, scale: 2, mode: "number" }),
    materialId: integer("material_id"),
    material: text("material"),
    finishing: text("finishing"),
    colors: text("colors"),
    specs: text("specs"),
    pricingInput: jsonb("pricing_input"),
    /** Price breakdown and, for printed work, how it runs (press, paper, sheets) — copied from the quote. */
    pricingBreakdown: jsonb("pricing_breakdown"),
    recommendedCents: integer("recommended_cents").notNull().default(0),
    priceCents: integer("price_cents").notNull().default(0),
    overrideReason: text("override_reason"),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    taxable: boolean("taxable").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    tenantKey("job_items", t),
    ref("job_items_job_fk", t.tenantId, t.jobId, jobs).onDelete("cascade"),
    ref("job_items_category_fk", t.tenantId, t.categoryId, productCategories),
    ref("job_items_material_fk", t.tenantId, t.materialId, materials),
    index("job_items_job_idx").on(t.jobId),
    index("job_items_category_idx").on(t.categoryId),
    index("job_items_desc_trgm").using("gin", sql`${t.description} gin_trgm_ops`),
  ],
);

export const jobStatusHistory = pgTable(
  "job_status_history",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    jobId: integer("job_id").notNull(),
    fromStatus: jobStatusEnum("from_status"),
    toStatus: jobStatusEnum("to_status").notNull(),
    changedBy: integer("changed_by"),
    note: text("note"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("job_status_history", t),
    ref("jsh_job_fk", t.tenantId, t.jobId, jobs).onDelete("cascade"),
    ref("jsh_changed_by_fk", t.tenantId, t.changedBy, users),
    index("jsh_job_idx").on(t.jobId, t.changedAt),
  ],
);

// ---------------------------------------------------------------------------
// Files & proofs
// ---------------------------------------------------------------------------
export const files = pgTable(
  "files",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    jobId: integer("job_id"),
    customerId: integer("customer_id"),
    quoteId: integer("quote_id"),
    folder: fileFolderEnum("folder").notNull().default("other"),
    filename: text("filename").notNull(),
    /** Stored objects are immutable; several rows may point at one object (e.g. reorders). */
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    preflightStatus: preflightEnum("preflight_status"),
    preflight: jsonb("preflight"),
    uploadedBy: integer("uploaded_by"),
    /** Uploaded by the customer in the customer portal (uploadedBy is then empty). */
    uploadedByCustomer: boolean("uploaded_by_customer").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("files", t),
    ref("files_job_fk", t.tenantId, t.jobId, jobs),
    ref("files_customer_fk", t.tenantId, t.customerId, customers),
    ref("files_quote_fk", t.tenantId, t.quoteId, quotes),
    ref("files_uploaded_by_fk", t.tenantId, t.uploadedBy, users),
    index("files_job_idx").on(t.jobId),
    index("files_customer_idx").on(t.customerId),
  ],
);

export const proofs = pgTable(
  "proofs",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    jobId: integer("job_id").notNull(),
    version: integer("version").notNull(),
    fileId: integer("file_id").notNull(),
    status: proofStatusEnum("status").notNull().default("draft"),
    note: text("note"), // designer's note to customer
    /** SHA-256 hash of the secure link token. Customer needs no account. */
    tokenHash: text("token_hash").unique(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentTo: text("sent_to"),
    sentBy: integer("sent_by"),
    // Customer response (audit trail)
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    responderName: text("responder_name"),
    responderEmail: text("responder_email"),
    responderIp: text("responder_ip"),
    responderUserAgent: text("responder_user_agent"),
    customerComment: text("customer_comment"),
    approvalStatement: text("approval_statement"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("proofs", t),
    ref("proofs_job_fk", t.tenantId, t.jobId, jobs),
    ref("proofs_file_fk", t.tenantId, t.fileId, files),
    ref("proofs_sent_by_fk", t.tenantId, t.sentBy, users),
    ref("proofs_created_by_fk", t.tenantId, t.createdBy, users),
    uniqueIndex("proofs_job_version_idx").on(t.jobId, t.version),
  ],
);

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    jobId: integer("job_id"),
    channel: text("channel"), // general | front_counter | design | production | installations | management
    authorId: integer("author_id").notNull(),
    body: text("body").notNull(),
    fileId: integer("file_id"),
    important: boolean("important").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("messages", t),
    ref("messages_job_fk", t.tenantId, t.jobId, jobs),
    ref("messages_author_fk", t.tenantId, t.authorId, users),
    ref("messages_file_fk", t.tenantId, t.fileId, files),
    index("messages_job_idx").on(t.jobId, t.createdAt),
    index("messages_channel_idx").on(t.tenantId, t.channel, t.createdAt),
  ],
);

/** Who was @mentioned in a message. Scoped through the message (no tenant column of its own). */
export const mentions = pgTable(
  "mentions",
  {
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

/** Customer-facing communication log (emails sent, calls logged…). */
export const communications = pgTable(
  "communications",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    customerId: integer("customer_id"),
    jobId: integer("job_id"),
    quoteId: integer("quote_id"),
    invoiceId: integer("invoice_id"),
    channel: commChannelEnum("channel").notNull(),
    direction: text("direction").notNull().default("outbound"), // outbound | inbound
    template: text("template"),
    toAddress: text("to_address"),
    subject: text("subject"),
    body: text("body"),
    status: text("status").notNull().default("sent"), // sent | failed | logged
    providerId: text("provider_id"),
    sentBy: integer("sent_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("communications", t),
    ref("comms_customer_fk", t.tenantId, t.customerId, customers),
    ref("comms_job_fk", t.tenantId, t.jobId, jobs),
    ref("comms_quote_fk", t.tenantId, t.quoteId, quotes),
    ref("comms_invoice_fk", t.tenantId, t.invoiceId, invoices),
    ref("comms_sent_by_fk", t.tenantId, t.sentBy, users),
    index("comms_customer_idx").on(t.customerId),
    index("comms_job_idx").on(t.jobId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    notes: text("notes"),
    jobId: integer("job_id"),
    customerId: integer("customer_id"),
    assignedTo: integer("assigned_to"),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: integer("completed_by"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("tasks", t),
    ref("tasks_job_fk", t.tenantId, t.jobId, jobs),
    ref("tasks_customer_fk", t.tenantId, t.customerId, customers),
    ref("tasks_assigned_to_fk", t.tenantId, t.assignedTo, users),
    ref("tasks_completed_by_fk", t.tenantId, t.completedBy, users),
    ref("tasks_created_by_fk", t.tenantId, t.createdBy, users),
    index("tasks_assigned_idx").on(t.assignedTo, t.completedAt),
    index("tasks_job_idx").on(t.jobId),
  ],
);

/** Calendar entries that are not already implied by job dates. */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    type: eventTypeEnum("type").notNull().default("reminder"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    jobId: integer("job_id"),
    userId: integer("user_id"),
    locationId: integer("location_id"),
    notes: text("notes"),
    externalId: text("external_id"), // Google Calendar id, later
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("calendar_events", t),
    ref("events_job_fk", t.tenantId, t.jobId, jobs),
    ref("events_user_fk", t.tenantId, t.userId, users),
    ref("events_location_fk", t.tenantId, t.locationId, locations),
    ref("events_created_by_fk", t.tenantId, t.createdBy, users),
    index("events_starts_idx").on(t.tenantId, t.startsAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    userId: integer("user_id").notNull(),
    kind: text("kind").notNull(), // mention | assigned | proof_approved | quote_accepted | due_soon | invoice_overdue | artwork_uploaded | task
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    actorId: integer("actor_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("notifications", t),
    ref("notifications_user_fk", t.tenantId, t.userId, users),
    ref("notifications_actor_fk", t.tenantId, t.actorId, users),
    index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt),
  ],
);

/** Who did what, when — for every important change. */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    action: text("action").notNull(), // job.status_changed, quote.price_changed, payment.received…
    entityType: text("entity_type").notNull(), // job | quote | customer | invoice | expense | user | setting
    entityId: integer("entity_id"),
    jobId: integer("job_id"),
    customerId: integer("customer_id"),
    quoteId: integer("quote_id"),
    actorId: integer("actor_id"), // null = system / customer
    summary: text("summary").notNull(),
    /** { before: {...}, after: {...} } for changes that matter */
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("activity_logs", t),
    ref("activity_job_fk", t.tenantId, t.jobId, jobs),
    ref("activity_customer_fk", t.tenantId, t.customerId, customers),
    ref("activity_quote_fk", t.tenantId, t.quoteId, quotes),
    ref("activity_actor_fk", t.tenantId, t.actorId, users),
    index("activity_job_idx").on(t.jobId, t.createdAt),
    index("activity_customer_idx").on(t.customerId, t.createdAt),
    index("activity_quote_idx").on(t.quoteId, t.createdAt),
    index("activity_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    number: integer("number").notNull(), // shown as INV-7001; from nextNumber(tx, tenantId, "invoice")
    customerId: integer("customer_id").notNull(),
    jobId: integer("job_id"),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    poNumber: text("po_number"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxRate: numeric("tax_rate", { precision: 6, scale: 4, mode: "number" }).notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    notes: text("notes"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    externalId: text("external_id"), // QuickBooks invoice id
    /** "job" (from a job) or "counter" (a front-counter sale). */
    source: text("source").$type<"job" | "counter">().notNull().default("job"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("invoices", t),
    uniqueIndex("invoices_tenant_number_idx").on(t.tenantId, t.number),
    ref("invoices_customer_fk", t.tenantId, t.customerId, customers),
    ref("invoices_job_fk", t.tenantId, t.jobId, jobs),
    ref("invoices_created_by_fk", t.tenantId, t.createdBy, users),
    index("invoices_customer_idx").on(t.customerId),
    index("invoices_status_idx").on(t.tenantId, t.status),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    invoiceId: integer("invoice_id").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    amountCents: integer("amount_cents").notNull(), // line total
    taxable: boolean("taxable").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [tenantKey("invoice_items", t), ref("invoice_items_invoice_fk", t.tenantId, t.invoiceId, invoices).onDelete("cascade")],
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    invoiceId: integer("invoice_id").notNull(),
    customerId: integer("customer_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: paymentMethodEnum("method").notNull(),
    reference: text("reference"), // check #, last 4…
    receivedOn: date("received_on").notNull(),
    notes: text("notes"),
    externalId: text("external_id"), // QuickBooks payment id
    /** Online card payments: the processor's id (e.g. Stripe Checkout session), so a payment is recorded once. */
    processorRef: text("processor_ref"),
    /** Cash at the counter: what the customer handed over (change = tendered − amount). */
    tenderedCents: integer("tendered_cents"),
    recordedBy: integer("recorded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("payments", t),
    uniqueIndex("payments_processor_ref_idx").on(t.tenantId, t.processorRef),
    ref("payments_invoice_fk", t.tenantId, t.invoiceId, invoices),
    ref("payments_customer_fk", t.tenantId, t.customerId, customers),
    ref("payments_recorded_by_fk", t.tenantId, t.recordedBy, users),
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_received_idx").on(t.tenantId, t.receivedOn),
  ],
);

/** "Pay online" links for an invoice (card payments through the shop's Stripe account). */
export const paymentLinks = pgTable(
  "payment_links",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    invoiceId: integer("invoice_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    provider: text("provider").$type<"stripe">().notNull().default("stripe"),
    /** Stripe Checkout session id. */
    providerRef: text("provider_ref").notNull(),
    url: text("url").notNull(),
    status: text("status").$type<"open" | "paid" | "expired">().notNull().default("open"),
    paymentId: integer("payment_id"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("payment_links", t),
    ref("payment_links_invoice_fk", t.tenantId, t.invoiceId, invoices),
    ref("payment_links_payment_fk", t.tenantId, t.paymentId, payments),
    ref("payment_links_created_by_fk", t.tenantId, t.createdBy, users),
    uniqueIndex("payment_links_provider_ref_idx").on(t.provider, t.providerRef),
    index("payment_links_invoice_idx").on(t.invoiceId),
  ],
);

/** End-of-day cash drawer count at the front counter. */
export const registerCloses = pgTable(
  "register_closes",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    locationId: integer("location_id"),
    businessDate: date("business_date").notNull(),
    /** Cash in the drawer at the start of the day (expected = float + cash taken). */
    openingFloatCents: integer("opening_float_cents").notNull().default(0),
    expectedCashCents: integer("expected_cash_cents").notNull(),
    countedCashCents: integer("counted_cash_cents").notNull(),
    /** Totals by payment method for the day, e.g. { cash: 12000, card: 54000 } */
    totals: jsonb("totals").$type<Record<string, number>>().notNull(),
    notes: text("notes"),
    closedBy: integer("closed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("register_closes", t),
    ref("register_closes_location_fk", t.tenantId, t.locationId, locations),
    ref("register_closes_closed_by_fk", t.tenantId, t.closedBy, users),
    index("register_closes_date_idx").on(t.tenantId, t.businessDate),
  ],
);

/**
 * A shop's connection to an outside service (Stripe payments, QuickBooks Online).
 * `secret` holds tokens/keys encrypted with APP_SECRET_KEY (src/lib/secrets.ts) — never plain text.
 */
export const tenantIntegrations = pgTable(
  "tenant_integrations",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    provider: text("provider").$type<"stripe" | "quickbooks">().notNull(),
    /** Non-secret details shown in Settings: account name, QuickBooks company id (realmId)… */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    secret: text("secret"),
    status: text("status").$type<"connected" | "error" | "disconnected">().notNull().default("connected"),
    lastError: text("last_error"),
    connectedBy: integer("connected_by"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("tenant_integrations", t),
    uniqueIndex("tenant_integrations_provider_idx").on(t.tenantId, t.provider),
    ref("tenant_integrations_connected_by_fk", t.tenantId, t.connectedBy, users),
  ],
);

/** What has been sent to the accounting system (QuickBooks), per record. */
export const accountingSync = pgTable(
  "accounting_sync",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    entityType: text("entity_type").$type<"customer" | "invoice" | "payment">().notNull(),
    entityId: integer("entity_id").notNull(),
    externalId: text("external_id"),
    /** QuickBooks SyncToken, needed to update a record. */
    syncToken: text("sync_token"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("accounting_sync", t),
    uniqueIndex("accounting_sync_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    vendorId: integer("vendor_id"),
    vendorName: text("vendor_name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    category: expenseCategoryEnum("category").notNull(),
    spentOn: date("spent_on").notNull(),
    jobId: integer("job_id"),
    paymentMethod: text("payment_method"),
    notes: text("notes"),
    receiptFileId: integer("receipt_file_id"),
    externalId: text("external_id"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("expenses", t),
    ref("expenses_vendor_fk", t.tenantId, t.vendorId, vendors),
    ref("expenses_job_fk", t.tenantId, t.jobId, jobs),
    ref("expenses_receipt_fk", t.tenantId, t.receiptFileId, files),
    ref("expenses_created_by_fk", t.tenantId, t.createdBy, users),
    index("expenses_job_idx").on(t.jobId),
    index("expenses_date_idx").on(t.tenantId, t.spentOn),
  ],
);

// ---------------------------------------------------------------------------
// Inventory & purchasing
// ---------------------------------------------------------------------------

/**
 * Every change to a material's stock, newest last. materials.quantityOnHand is the running total and is
 * only changed together with a movement row (src/lib/inventory).
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    materialId: integer("material_id").notNull(),
    /** receive = delivery in, use = used on a job, adjust = correction, count = physical count, return = back to vendor. */
    kind: text("kind").$type<"receive" | "use" | "adjust" | "count" | "return">().notNull(),
    /** Signed change in the material's unit (+ in, − out). */
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull(),
    balanceAfter: numeric("balance_after", { precision: 12, scale: 2, mode: "number" }).notNull(),
    jobId: integer("job_id"),
    purchaseOrderId: integer("purchase_order_id"),
    note: text("note"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("inventory_movements", t),
    ref("inventory_movements_material_fk", t.tenantId, t.materialId, materials),
    ref("inventory_movements_job_fk", t.tenantId, t.jobId, jobs),
    ref("inventory_movements_po_fk", t.tenantId, t.purchaseOrderId, purchaseOrders),
    ref("inventory_movements_created_by_fk", t.tenantId, t.createdBy, users),
    index("inventory_movements_material_idx").on(t.tenantId, t.materialId, t.createdAt),
  ],
);

/** Stock set aside for a job (e.g. the paper its estimate needs), until it's used or released. */
export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    materialId: integer("material_id").notNull(),
    jobId: integer("job_id").notNull(),
    jobItemId: integer("job_item_id"),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull(),
    status: text("status").$type<"reserved" | "used" | "released">().notNull().default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("inventory_reservations", t),
    ref("inventory_reservations_material_fk", t.tenantId, t.materialId, materials),
    ref("inventory_reservations_job_fk", t.tenantId, t.jobId, jobs),
    ref("inventory_reservations_job_item_fk", t.tenantId, t.jobItemId, jobItems).onDelete("cascade"),
    index("inventory_reservations_material_idx").on(t.tenantId, t.materialId, t.status),
    index("inventory_reservations_job_idx").on(t.jobId),
  ],
);

/** Purchase orders to vendors: stock replenishment, or outside work bought for a job. */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    number: integer("number").notNull(), // shown as PO-1001; from nextNumber(tx, tenantId, "po")
    vendorId: integer("vendor_id").notNull(),
    /** Set when the whole order is for one job (outside services, special paper). */
    jobId: integer("job_id"),
    status: text("status").$type<"draft" | "ordered" | "partial" | "received" | "cancelled">().notNull().default("draft"),
    orderedOn: date("ordered_on"),
    expectedOn: date("expected_on"),
    receivedOn: date("received_on"),
    /** Deliver to this location. */
    locationId: integer("location_id"),
    notes: text("notes"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    shippingCents: integer("shipping_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("purchase_orders", t),
    uniqueIndex("purchase_orders_tenant_number_idx").on(t.tenantId, t.number),
    ref("purchase_orders_vendor_fk", t.tenantId, t.vendorId, vendors),
    ref("purchase_orders_job_fk", t.tenantId, t.jobId, jobs),
    ref("purchase_orders_location_fk", t.tenantId, t.locationId, locations),
    ref("purchase_orders_created_by_fk", t.tenantId, t.createdBy, users),
    index("purchase_orders_status_idx").on(t.tenantId, t.status),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    purchaseOrderId: integer("purchase_order_id").notNull(),
    /** Stock item being bought; null for outside services / one-off items. */
    materialId: integer("material_id"),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull(),
    receivedQuantity: numeric("received_quantity", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    unit: text("unit"),
    /** Cost per unit (sub-cent allowed, e.g. per sheet); amountCents is the rounded line total. */
    unitCostCents: numeric("unit_cost_cents", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    amountCents: integer("amount_cents").notNull().default(0),
    /** Charge this line's cost to a job (job costing). */
    jobId: integer("job_id"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    tenantKey("purchase_order_items", t),
    ref("po_items_po_fk", t.tenantId, t.purchaseOrderId, purchaseOrders).onDelete("cascade"),
    ref("po_items_material_fk", t.tenantId, t.materialId, materials),
    ref("po_items_job_fk", t.tenantId, t.jobId, jobs),
    index("po_items_po_idx").on(t.purchaseOrderId),
    index("po_items_material_idx").on(t.tenantId, t.materialId),
  ],
);

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Time booked on a machine for a job (the equipment schedule board). */
export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    equipmentId: integer("equipment_id").notNull(),
    jobId: integer("job_id"),
    jobItemId: integer("job_item_id"),
    /** Shown on the board, e.g. "MP-10428 · 1,000 cards" or "Maintenance". */
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"scheduled" | "running" | "done">().notNull().default("scheduled"),
    operatorId: integer("operator_id"),
    notes: text("notes"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("schedule_blocks", t),
    ref("schedule_blocks_equipment_fk", t.tenantId, t.equipmentId, equipment),
    ref("schedule_blocks_job_fk", t.tenantId, t.jobId, jobs),
    ref("schedule_blocks_job_item_fk", t.tenantId, t.jobItemId, jobItems).onDelete("cascade"),
    ref("schedule_blocks_operator_fk", t.tenantId, t.operatorId, users),
    ref("schedule_blocks_created_by_fk", t.tenantId, t.createdBy, users),
    index("schedule_blocks_equipment_idx").on(t.tenantId, t.equipmentId, t.startsAt),
    index("schedule_blocks_job_idx").on(t.jobId),
  ],
);

// ---------------------------------------------------------------------------
// Customer portal
// ---------------------------------------------------------------------------

/**
 * Sign-in links for the customer portal, emailed to a customer contact. Like proof links, only a hash
 * of the token is stored. Using one starts a portal session.
 */
export const portalLinks = pgTable(
  "portal_links",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    customerId: integer("customer_id").notNull(),
    contactId: integer("contact_id"),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("portal_links", t),
    ref("portal_links_customer_fk", t.tenantId, t.customerId, customers),
    ref("portal_links_contact_fk", t.tenantId, t.contactId, customerContacts),
    ref("portal_links_created_by_fk", t.tenantId, t.createdBy, users),
  ],
);

/** A signed-in customer portal browser (cookie holds the raw token; only its hash is stored). */
export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    customerId: integer("customer_id").notNull(),
    contactId: integer("contact_id"),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    ref("portal_sessions_customer_fk", t.tenantId, t.customerId, customers).onDelete("cascade"),
    ref("portal_sessions_contact_fk", t.tenantId, t.contactId, customerContacts),
    index("portal_sessions_customer_idx").on(t.tenantId, t.customerId),
  ],
);

/** Things customers ask for in the portal: a reorder, a new quote, or a message. Staff handle them. */
export const portalRequests = pgTable(
  "portal_requests",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    customerId: integer("customer_id").notNull(),
    contactId: integer("contact_id"),
    kind: text("kind").$type<"reorder" | "quote" | "message">().notNull(),
    /** The job being reordered / talked about. */
    jobId: integer("job_id"),
    subject: text("subject").notNull(),
    body: text("body"),
    /** Details the customer gave, e.g. { quantity, neededBy, fileIds }. */
    details: jsonb("details").$type<Record<string, unknown>>(),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    status: text("status").$type<"new" | "handled">().notNull().default("new"),
    /** What staff made of it (a quote or job). */
    quoteId: integer("quote_id"),
    resultJobId: integer("result_job_id"),
    handledBy: integer("handled_by"),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("portal_requests", t),
    ref("portal_requests_customer_fk", t.tenantId, t.customerId, customers),
    ref("portal_requests_contact_fk", t.tenantId, t.contactId, customerContacts),
    ref("portal_requests_job_fk", t.tenantId, t.jobId, jobs),
    ref("portal_requests_quote_fk", t.tenantId, t.quoteId, quotes),
    ref("portal_requests_result_job_fk", t.tenantId, t.resultJobId, jobs),
    ref("portal_requests_handled_by_fk", t.tenantId, t.handledBy, users),
    index("portal_requests_status_idx").on(t.tenantId, t.status, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------
export const knowledgeArticles = pgTable(
  "knowledge_articles",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    category: text("category").notNull().default("General"),
    body: text("body").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [tenantKey("knowledge_articles", t), ref("knowledge_updated_by_fk", t.tenantId, t.updatedBy, users)],
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Role = (typeof roleEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type Priority = (typeof priorityEnum.enumValues)[number];
export type Fulfillment = (typeof fulfillmentEnum.enumValues)[number];
export type QuoteStatus = (typeof quoteStatusEnum.enumValues)[number];
export type FileFolder = (typeof fileFolderEnum.enumValues)[number];
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type ExpenseCategory = (typeof expenseCategoryEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type EventType = (typeof eventTypeEnum.enumValues)[number];
export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type CustomerContact = typeof customerContacts.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobItem = typeof jobItems.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type QuoteItem = typeof quoteItems.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Material = typeof materials.$inferSelect;
export type Equipment = typeof equipment.$inferSelect;
export type Operation = typeof operations.$inferSelect;
