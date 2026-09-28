/**
 * What can be imported (Settings → Import) and the spreadsheet headers each field answers to.
 * Synonyms include the column names Printer's Plan and QuickBooks-style exports commonly use;
 * the earlier a synonym appears in its list, the more it's preferred when two columns compete.
 * Pure: used by the browser (auto-matching, preview) and by the server.
 */

export const IMPORT_KINDS = ["customers", "contacts", "jobs", "materials", "vendors"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type FieldDef = {
  key: string;
  label: string;
  /** Needed for every row (the UI marks it; normalizeRow enforces it). */
  required?: boolean;
  /** Short hint shown under the field in the mapping table. */
  hint?: string;
  synonyms: string[];
  /** Headers containing any of these words never auto-match this field ("Unit Price" ≠ total). */
  avoid?: string[];
};

export type KindDef = {
  kind: ImportKind;
  label: string;
  /** One line under the choice. */
  description: string;
  /** Plural noun for counts ("customers", "past jobs"). */
  noun: string;
  fields: FieldDef[];
};

const f = (key: string, label: string, synonyms: string[], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, synonyms, ...extra });

const CUSTOMER_NAME = [
  "customer",
  "customer name",
  "company",
  "company name",
  "name",
  "account name",
  "account",
  "business name",
  "business",
  "organization",
  "organization name",
  "bill to name",
  "cust name",
  "client",
  "client name",
  "sold to",
];

export const KINDS: Record<ImportKind, KindDef> = {
  customers: {
    kind: "customers",
    label: "Customers",
    noun: "customers",
    description: "Companies and people you do work for, with address, terms and a main contact.",
    fields: [
      f("name", "Customer / company name", CUSTOMER_NAME, { required: true, hint: "Or map First + Last name for people" }),
      f("contactFirstName", "Contact first name", ["first name", "first", "contact first name", "fname", "given name"]),
      f("contactLastName", "Contact last name", ["last name", "last", "contact last name", "lname", "surname", "family name"]),
      f("contactName", "Main contact name", ["contact", "contact name", "primary contact", "main contact", "attention", "attn", "contact person", "buyer"]),
      f("contactTitle", "Main contact title", ["contact title", "title", "job title", "position"]),
      f("contactEmail", "Main contact email", ["contact email", "contact e mail", "contact email address"]),
      f("contactPhone", "Main contact phone", ["contact phone", "cell", "cell phone", "mobile", "mobile phone", "direct", "direct phone"]),
      f(
        "phone",
        "Phone",
        [
          "phone",
          "phone 1",
          "work phone",
          "business phone",
          "main phone",
          "office phone",
          "telephone",
          "tel",
          "phone no",
          "primary phone",
          "company phone",
          "phone 2",
        ],
        { avoid: ["fax", "cell", "mobile", "contact"] },
      ),
      f("fax", "Fax (kept in notes)", ["fax", "fax no", "fax phone", "fax 1"]),
      f("email", "Email", ["email", "email address", "email 1", "e mail address", "company email", "main email", "billing email", "invoice email"], {
        avoid: ["contact"],
      }),
      f("website", "Website", ["website", "web site", "web", "url", "www", "homepage", "web address"]),
      f(
        "address",
        "Street address",
        ["address", "address 1", "street", "street address", "address line 1", "addr 1", "addr", "mailing address", "street 1", "physical address"],
        { avoid: ["bill", "billing", "ship", "email", "e mail", "web"] },
      ),
      f("address2", "Address line 2", ["address 2", "address line 2", "addr 2", "street 2", "suite", "unit"], { avoid: ["bill", "billing", "ship"] }),
      f("city", "City", ["city", "town", "mailing city"], { avoid: ["bill", "billing", "ship"] }),
      f("state", "State", ["state", "st", "province", "state province", "region", "mailing state"], { avoid: ["bill", "billing", "ship"] }),
      f("zip", "ZIP", ["zip", "zip code", "zipcode", "postal code", "postcode", "zip postal code", "postal", "mailing zip"], {
        avoid: ["bill", "billing", "ship"],
      }),
      f("billingAddress", "Billing address", [
        "billing address",
        "bill to address",
        "bill to",
        "billing street",
        "billing address 1",
        "bill to street",
        "bill address",
      ]),
      f("billingCity", "Billing city", ["billing city", "bill to city", "bill city"]),
      f("billingState", "Billing state", ["billing state", "bill to state", "bill state"]),
      f("billingZip", "Billing ZIP", ["billing zip", "billing zip code", "bill to zip", "billing postal code", "bill zip"]),
      f("taxExempt", "Tax exempt (yes/no)", ["tax exempt", "exempt", "tax status", "non taxable", "tax exempt status", "is tax exempt"]),
      f("taxable", "Taxable (yes/no)", ["taxable", "is taxable", "charge tax", "sales tax"], { hint: "“No” means tax exempt" }),
      f("taxExemptId", "Tax exemption ID", [
        "tax id",
        "tax exempt id",
        "tax exempt no",
        "exemption id",
        "exemption no",
        "exempt no",
        "resale no",
        "resale certificate",
        "exemption certificate",
        "certificate no",
        "tax certificate",
        "st 105",
        "exemption certificate no",
      ]),
      f("paymentTerms", "Payment terms", ["terms", "payment terms", "credit terms", "pay terms", "default terms"]),
      f("notes", "Notes", ["notes", "note", "comments", "comment", "memo", "remarks", "customer notes", "internal notes"]),
      f("customerSince", "Customer since", [
        "customer since",
        "since",
        "date added",
        "date created",
        "created",
        "created date",
        "created on",
        "first order",
        "first order date",
        "start date",
        "date opened",
        "open date",
        "date entered",
        "entered",
      ]),
      f(
        "oldNumber",
        "Old customer # (kept in notes)",
        ["customer no", "customer id", "cust no", "cust id", "customer code", "account no", "account number", "acct no", "id", "code", "customer key"],
        { hint: "Your old system's customer number" },
      ),
      f("externalId", "QuickBooks customer ID", ["quickbooks id", "qb id", "qbo id", "quickbooks customer id", "external id", "list id"], {
        hint: "Only if it's the QuickBooks ID",
      }),
    ],
  },
  contacts: {
    kind: "contacts",
    label: "Contacts",
    noun: "contacts",
    description: "People at your customers. Each row names the customer it belongs to.",
    fields: [
      f(
        "customerName",
        "Customer / company name",
        [
          "customer",
          "customer name",
          "company",
          "company name",
          "account",
          "account name",
          "business",
          "business name",
          "organization",
          "client",
          "client name",
        ],
        { required: true },
      ),
      f("name", "Contact name", ["contact name", "name", "contact", "full name", "person", "contact full name"], {
        required: true,
        hint: "Or map First + Last name",
      }),
      f("firstName", "First name", ["first name", "first", "fname", "given name", "contact first name"]),
      f("lastName", "Last name", ["last name", "last", "lname", "surname", "family name", "contact last name"]),
      f("title", "Title", ["title", "job title", "position", "role", "contact title"]),
      f("email", "Email", ["email", "email address", "contact email", "e mail address", "email 1"]),
      f(
        "phone",
        "Phone",
        ["phone", "work phone", "direct", "direct phone", "office phone", "business phone", "phone 1", "telephone", "contact phone", "phone no"],
        { avoid: ["fax", "cell", "mobile"] },
      ),
      f("mobile", "Cell phone", ["cell", "cell phone", "mobile", "mobile phone", "cellular"]),
      f("isPrimary", "Main contact? (yes/no)", ["primary", "primary contact", "main contact", "is primary", "default contact", "main"]),
      f("notes", "Notes", ["notes", "note", "comments", "comment", "memo"]),
    ],
  },
  jobs: {
    kind: "jobs",
    label: "Past jobs",
    noun: "past jobs",
    description: "Job history, so “what did we charge last time?” works from day one. Imported as completed.",
    fields: [
      f(
        "legacyNumber",
        "Old job number",
        [
          "job no",
          "job number",
          "job",
          "job id",
          "order no",
          "order number",
          "order",
          "ticket no",
          "ticket",
          "work order",
          "work order no",
          "wo no",
          "invoice no",
          "invoice number",
          "invoice",
          "estimate no",
          "docket",
          "docket no",
        ],
        { hint: "Stops the same job being imported twice" },
      ),
      f("customerName", "Customer name", CUSTOMER_NAME, { required: true }),
      f("date", "Date", [
        "date",
        "order date",
        "job date",
        "date ordered",
        "date in",
        "invoice date",
        "date invoiced",
        "completed",
        "date completed",
        "completion date",
        "completed date",
        "closed date",
        "ship date",
        "created",
        "date created",
        "entered",
        "date entered",
        "due date",
      ]),
      f("title", "Job title", ["title", "job title", "job name", "name", "project", "project name", "job description"], {
        avoid: ["customer", "company", "contact", "account"],
      }),
      f("description", "Description", [
        "description",
        "item description",
        "desc",
        "details",
        "item",
        "line description",
        "product description",
        "specs",
        "specifications",
        "spec",
        "job details",
      ]),
      f("quantity", "Quantity", ["qty", "quantity", "quan", "qty ordered", "pieces", "count", "units", "order qty", "run qty", "qty 1"]),
      f("size", "Size", ["size", "finished size", "dimensions", "dims", "flat size", "trim size", "final size", "sign size"]),
      f("width", "Width", ["width", "w", "finished width", "width in"]),
      f("height", "Height", ["height", "h", "finished height", "length", "height in"]),
      f("category", "Category / product", [
        "category",
        "product",
        "product type",
        "type",
        "job type",
        "product category",
        "item type",
        "class",
        "product name",
        "department",
        "dept",
        "product line",
      ]),
      f(
        "amount",
        "Price / total",
        [
          "total",
          "job total",
          "amount",
          "total price",
          "price",
          "invoice total",
          "grand total",
          "sale amount",
          "sales",
          "sale",
          "total amount",
          "extended price",
          "ext price",
          "extended",
          "net",
          "revenue",
          "subtotal",
          "sub total",
          "amount due",
          "charge",
        ],
        { avoid: ["unit", "each", "per", "tax", "cost", "paid", "balance", "deposit"] },
      ),
      f("tax", "Sales tax", ["tax", "sales tax", "tax amount", "tax total"], { avoid: ["exempt", "id", "rate"] }),
      f("status", "Status", ["status", "job status", "stage", "state"]),
      f("material", "Stock / material", ["stock", "paper", "material", "substrate", "media", "paper stock", "stock name"]),
      f("colors", "Colors / ink", ["colors", "ink", "ink colors", "color", "inks"]),
      f("poNumber", "Customer PO", ["po", "po no", "po number", "purchase order", "customer po", "cust po", "p o"]),
      f("notes", "Notes", ["notes", "note", "comments", "comment", "memo", "instructions", "remarks"]),
    ],
  },
  materials: {
    kind: "materials",
    label: "Paper & materials",
    noun: "paper & materials",
    description: "Paper stocks (sheet size, cost per 1,000) and other materials like vinyl and substrates.",
    fields: [
      f("name", "Name", ["name", "stock", "stock name", "paper", "paper name", "material", "material name", "description", "item", "item name", "product"], {
        required: true,
      }),
      f("kind", "Kind", ["kind", "type", "category", "stock type", "material type", "class"], { hint: "paper, vinyl, substrate… (blank = guessed)" }),
      f("unit", "Unit", ["unit", "uom", "unit of measure", "units", "per", "sold by"]),
      f("cost", "Cost per unit", ["cost", "unit cost", "cost each", "price", "cost per unit", "our cost", "cost per sheet", "sheet cost"], {
        avoid: ["1000", "thousand", "per m", "cwt", "markup"],
      }),
      f("costPerM", "Cost per 1,000 sheets", [
        "cost per m",
        "cost m",
        "per m",
        "cost per 1000",
        "cost 1000",
        "m cost",
        "price per m",
        "cost per thousand",
        "cost thousand",
        "m price",
      ]),
      f("weight", "Weight", ["weight", "basis weight", "paper weight", "wt", "caliper", "thickness"]),
      f("size", "Sheet size", ["size", "sheet size", "dimensions", "parent size", "parent sheet size", "stock size"]),
      f("sheetWidth", "Sheet width", ["sheet width", "width", "w"]),
      f("sheetHeight", "Sheet height", ["sheet height", "height", "length", "h"]),
      f("vendor", "Vendor", ["vendor", "supplier", "merchant", "vendor name", "supplier name", "mill", "distributor", "source"]),
      f("sku", "SKU / item #", ["sku", "item no", "item number", "part no", "part number", "vendor item no", "product code", "code", "stock no", "catalog no"]),
    ],
  },
  vendors: {
    kind: "vendors",
    label: "Vendors",
    noun: "vendors",
    description: "Suppliers you buy paper, materials and outside services from.",
    fields: [
      f("name", "Vendor name", ["vendor", "vendor name", "name", "company", "company name", "supplier", "supplier name", "business name"], { required: true }),
      f("contactName", "Contact", ["contact", "contact name", "rep", "sales rep", "representative", "account rep", "attention"]),
      f("contactFirstName", "Contact first name", ["first name", "first", "contact first name"]),
      f("contactLastName", "Contact last name", ["last name", "last", "contact last name"]),
      f("phone", "Phone", ["phone", "phone 1", "work phone", "main phone", "business phone", "telephone", "tel", "phone no", "office phone"], {
        avoid: ["fax"],
      }),
      f("email", "Email", ["email", "email address", "e mail address", "order email", "orders email"]),
      f("website", "Website", ["website", "web site", "web", "url", "www", "ordering site"]),
      f("accountNumber", "Our account #", [
        "account no",
        "account number",
        "acct no",
        "acct",
        "account",
        "customer no",
        "our account",
        "our account no",
        "account id",
      ]),
      f("notes", "Notes", ["notes", "note", "comments", "comment", "memo", "remarks", "terms"]),
      f("address", "Address (kept in notes)", ["address", "address 1", "street", "street address"]),
      f("city", "City (kept in notes)", ["city"]),
      f("state", "State (kept in notes)", ["state", "st"]),
      f("zip", "ZIP (kept in notes)", ["zip", "zip code", "postal code"]),
    ],
  },
};

export function isImportKind(k: unknown): k is ImportKind {
  return typeof k === "string" && (IMPORT_KINDS as readonly string[]).includes(k);
}
