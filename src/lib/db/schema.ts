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
export const pricingMethodEnum = pgEnum("pricing_method", ["per_sqft", "quantity_tier", "per_unit", "custom"]);
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
    externalId: text("external_id"), // QuickBooks customer id, later
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey("customers", t),
    ref("customers_salesperson_fk", t.tenantId, t.salespersonId, users),
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
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("customer_contacts", t),
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
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [tenantKey("vendors", t)],
);

/** Materials/substrates. Used by pricing now; inventory fields are for Phase 2. */
export const materials = pgTable(
  "materials",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(), // "13oz Scrim Vinyl Banner"
    kind: text("kind").notNull().default("other"), // vinyl, paper, substrate, laminate, ink…
    unit: text("unit").notNull().default("sqft"), // sqft | sheet | roll | each | ream
    costCents: integer("cost_cents").notNull().default(0), // our cost per unit
    vendorId: integer("vendor_id"),
    sku: text("sku"),
    quantityOnHand: numeric("quantity_on_hand", { precision: 12, scale: 2, mode: "number" }),
    reorderLevel: numeric("reorder_level", { precision: 12, scale: 2, mode: "number" }),
    active: boolean("active").notNull().default(true),
  },
  (t) => [tenantKey("materials", t), ref("materials_vendor_fk", t.tenantId, t.vendorId, vendors)],
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
    number: integer("number").notNull(), // shown as MP-10428; from nextNumber(tx, tenantId, "job")
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
    externalId: text("external_id"), // QuickBooks invoice id, later
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
    externalId: text("external_id"),
    recordedBy: integer("recorded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [
    tenantKey("payments", t),
    ref("payments_invoice_fk", t.tenantId, t.invoiceId, invoices),
    ref("payments_customer_fk", t.tenantId, t.customerId, customers),
    ref("payments_recorded_by_fk", t.tenantId, t.recordedBy, users),
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_received_idx").on(t.tenantId, t.receivedOn),
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
