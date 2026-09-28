/**
 * Turning one spreadsheet row (mapped cells as text) into what gets saved, with the problems found.
 * The browser runs this for the preview; the server runs it again on import (never trusting the
 * browser). Pure: no database, no "server-only".
 *
 * errors   → the row is skipped (missing name, unreadable price/date…)
 * warnings → the row is imported, but something was left blank or guessed (bad email, feet vs inches…)
 */
import type { ImportKind } from "./fields";
import {
  clean,
  cleanMultiline,
  combineName,
  nameKey,
  parseBool,
  parseCents,
  parseDate,
  parseDollars,
  parseEmail,
  parseInches,
  parsePhone,
  parseQuantity,
  parseSize,
  parseState,
  parseTerms,
  parseWebsite,
  parseZip,
  type PaymentTerms,
} from "./parse";

export type CategoryRef = { id: number; name: string; slug: string; group: string };
export type NormalizeContext = { categories?: CategoryRef[]; today?: string };

export type CustomerValues = {
  name: string;
  isCompany: boolean;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  billingAddress: string | null;
  taxExempt: boolean | null;
  taxExemptId: string | null;
  paymentTerms: PaymentTerms | null;
  notes: string | null;
  customerSince: string | null;
  externalId: string | null;
  contact: { name: string; title: string | null; email: string | null; phone: string | null } | null;
};

export type ContactValues = {
  customerName: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean | null;
};

export type JobValues = {
  legacyNumber: string | null;
  customerName: string;
  date: string | null;
  title: string;
  description: string;
  quantity: number;
  widthIn: number | null;
  heightIn: number | null;
  categoryId: number | null;
  categoryName: string | null;
  priceCents: number;
  taxCents: number;
  status: "completed" | "cancelled";
  originalStatus: string | null;
  material: string | null;
  colors: string | null;
  poNumber: string | null;
  notes: string | null;
};

export type MaterialValues = {
  name: string;
  kind: string;
  unit: string;
  costCents: number;
  costPerMCents: number | null;
  weight: string | null;
  sheetWidthIn: number | null;
  sheetHeightIn: number | null;
  vendorName: string | null;
  sku: string | null;
};

export type VendorValues = {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  accountNumber: string | null;
  notes: string | null;
};

export type ValuesFor = {
  customers: CustomerValues;
  contacts: ContactValues;
  jobs: JobValues;
  materials: MaterialValues;
  vendors: VendorValues;
};

/** Totals for one import (stored on imports.summary). */
export type ImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  /** Extra counts shown on the result screen. */
  extra?: {
    customersCreated?: number;
    contactsCreated?: number;
    vendorsCreated?: number;
    /** Rows that were already imported earlier (same old job number) or had nothing new. */
    duplicates?: number;
    unchanged?: number;
    /** Rows that became extra lines on a job (several rows with the same old job number). */
    linesAdded?: number;
    /** Undo: how many rows were archived. */
    archived?: number;
  };
};

export type Normalized<K extends ImportKind = ImportKind> = { values: ValuesFor[K] | null; errors: string[]; warnings: string[] };

type Raw = Record<string, string | undefined>;

const q = (s: string) => `“${s.length > 40 ? s.slice(0, 40) + "…" : s}”`;
const orNull = (s: string) => (s === "" ? null : s);
const joinLines = (...parts: (string | null | undefined | false)[]) => orNull(parts.filter(Boolean).join("\n"));
const cap = (s: string | null, n: number) => (s == null ? null : s.slice(0, n));

function emailField(raw: string | undefined, label: string, warnings: string[]): string | null {
  const e = parseEmail(raw);
  if (e === undefined) {
    warnings.push(`${label} ${q(clean(raw))} doesn't look like an email — left blank`);
    return null;
  }
  if (e?.more) warnings.push(`${label} has more than one address — kept the first`);
  return e?.email ?? null;
}

function phoneField(raw: string | undefined, label: string, warnings: string[]): string | null {
  const p = parsePhone(raw);
  if (p === undefined) {
    warnings.push(`${label} ${q(clean(raw))} is too short to be a phone number — left blank`);
    return null;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export function normalizeCustomer(raw: Raw): Normalized<"customers"> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const company = clean(raw.name);
  const person = combineName(raw.contactFirstName, raw.contactLastName);
  const contactName = clean(raw.contactName) || person;
  const name = company || contactName;
  if (!name) return { values: null, errors: ["Missing customer name"], warnings };

  const taxExemptRaw = parseBool(raw.taxExempt);
  const taxableRaw = parseBool(raw.taxable);
  if (taxExemptRaw === undefined) warnings.push(`Tax exempt ${q(clean(raw.taxExempt))} isn't yes or no — left as taxable`);
  if (taxableRaw === undefined) warnings.push(`Taxable ${q(clean(raw.taxable))} isn't yes or no — left as taxable`);
  const taxExempt = taxExemptRaw ?? (taxableRaw == null ? null : !taxableRaw);
  const taxId = clean(raw.taxExemptId);

  const terms = parseTerms(raw.paymentTerms);
  if (terms === undefined) warnings.push(`Payment terms ${q(clean(raw.paymentTerms))} not recognized — left as the default`);
  else if (terms && !terms.exact)
    warnings.push(
      `Payment terms ${q(clean(raw.paymentTerms))} set to the closest option (${terms.terms.replace("_", " ").replace("net", "Net").replace("due on receipt", "Due on receipt")})`,
    );

  const since = parseDate(raw.customerSince);
  if (since === undefined) warnings.push(`Customer since ${q(clean(raw.customerSince))} isn't a date — left blank`);

  const street = [clean(raw.address), clean(raw.address2)].filter(Boolean).join(", ");
  const billCityLine = [clean(raw.billingCity), [parseState(raw.billingState), parseZip(raw.billingZip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const billing = joinLines(cleanMultiline(raw.billingAddress), billCityLine);

  const contactTitle = orNull(clean(raw.contactTitle));
  const contactEmail = emailField(raw.contactEmail, "Contact email", warnings);
  const contactPhone = phoneField(raw.contactPhone, "Contact phone", warnings);
  // A person's own name as the "contact" adds nothing unless there's more to say about them.
  const contactIsJustTheName = nameKey(contactName) === nameKey(name) && !contactTitle && !contactEmail && !contactPhone;
  const contact =
    contactName && !contactIsJustTheName ? { name: contactName.slice(0, 200), title: cap(contactTitle, 100), email: contactEmail, phone: contactPhone } : null;

  const fax = clean(raw.fax);
  const oldNo = clean(raw.oldNumber);
  const notes = joinLines(
    cleanMultiline(raw.notes),
    fax && `Fax: ${fax}`,
    oldNo && `Old customer #: ${oldNo}`,
    taxExempt !== true && taxId && `Tax ID: ${taxId}`,
  );

  return {
    values: {
      name: name.slice(0, 200),
      isCompany: !!company,
      phone: phoneField(raw.phone, "Phone", warnings),
      email: emailField(raw.email, "Email", warnings),
      website: parseWebsite(raw.website),
      address: cap(orNull(street), 300),
      city: cap(orNull(clean(raw.city)), 100),
      state: parseState(raw.state),
      zip: parseZip(raw.zip),
      billingAddress: cap(billing, 600),
      taxExempt,
      taxExemptId: taxExempt === true ? cap(orNull(taxId), 100) : null,
      paymentTerms: terms?.terms ?? null,
      notes: cap(notes, 5000),
      customerSince: since ?? null,
      externalId: cap(orNull(clean(raw.externalId)), 100),
      contact,
    },
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
export function normalizeContact(raw: Raw): Normalized<"contacts"> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const customerName = clean(raw.customerName);
  const name = clean(raw.name) || combineName(raw.firstName, raw.lastName);
  if (!customerName) errors.push("Missing customer name");
  if (!name) errors.push("Missing contact name");
  if (errors.length) return { values: null, errors, warnings };
  const primary = parseBool(raw.isPrimary);
  if (primary === undefined) warnings.push(`Main contact ${q(clean(raw.isPrimary))} isn't yes or no — ignored`);
  let phone = phoneField(raw.phone, "Phone", warnings);
  const mobile = phoneField(raw.mobile, "Cell phone", warnings);
  let notes = cleanMultiline(raw.notes);
  if (!phone) phone = mobile;
  else if (mobile && mobile !== phone) notes = [notes, `Cell: ${mobile}`].filter(Boolean).join("\n");
  return {
    values: {
      customerName: customerName.slice(0, 200),
      name: name.slice(0, 200),
      title: cap(orNull(clean(raw.title)), 100),
      email: emailField(raw.email, "Email", warnings),
      phone,
      notes: cap(orNull(notes), 2000),
      isPrimary: primary ?? null,
    },
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Past jobs
// ---------------------------------------------------------------------------
const SIGN_WORDS =
  /\b(banners?|signs?|signage|wraps?|coroplast|coro|decals?|vinyl|mesh|flags?|graphics?|boards?|acm|aluminum|dibond|magnets?|magnetic|window|yard|a-frame|sandwich|billboard|lettering|pvc|sintra|foam ?core|canvas)\b/i;

/** Find a category by name: "Banner" → Banners, "business-cards" → Business Cards. */
export function matchCategory<T extends CategoryRef>(categories: T[], input: string | null | undefined): T | null {
  const key = nameKey(input);
  if (!key) return null;
  const singular = (k: string) =>
    k
      .split(" ")
      .map((w) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("ss") ? w : w.replace(/s$/, "")))
      .join(" ");
  const exact = categories.find((c) => nameKey(c.name) === key || nameKey(c.slug) === key);
  if (exact) return exact;
  const loose = categories.find((c) => singular(nameKey(c.name)) === singular(key) || singular(nameKey(c.slug)) === singular(key));
  if (loose) return loose;
  // "Vinyl Banners 13oz" → Banners; "Postcards" → Postcards & Mailers (word overlap, longest name first)
  const words = new Set(key.split(" ").map(singular));
  const byOverlap = [...categories]
    .map((c) => ({
      c,
      hits: nameKey(c.name)
        .split(" ")
        .filter((w) => w.length > 3 && words.has(singular(w))).length,
    }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return byOverlap[0]?.c ?? null;
}

export function normalizeJob(raw: Raw, ctx: NormalizeContext = {}): Normalized<"jobs"> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const customerName = clean(raw.customerName);
  if (!customerName) errors.push("Missing customer name");

  const date = parseDate(raw.date);
  if (date === undefined) errors.push(`Couldn't read the date ${q(clean(raw.date))}`);
  else if (date === null) warnings.push("No date — today's date will be used");

  const price = parseCents(raw.amount);
  if (price === undefined) errors.push(`Couldn't read the price ${q(clean(raw.amount))}`);
  else if (price === null || price === 0) warnings.push("No price — it won't show up in price lookups");
  const tax = parseCents(raw.tax);
  if (tax === undefined) warnings.push(`Couldn't read the tax ${q(clean(raw.tax))} — left at $0`);

  let quantity = parseQuantity(raw.quantity);
  if (quantity === undefined) {
    warnings.push(`Couldn't read the quantity ${q(clean(raw.quantity))} — used 1`);
    quantity = 1;
  }
  if (quantity == null || quantity < 1) quantity = 1;

  const categoryName = orNull(clean(raw.category));
  const category = ctx.categories ? matchCategory(ctx.categories, categoryName) : null;
  if (categoryName && ctx.categories && !category) warnings.push(`No category like ${q(categoryName)} — left blank`);

  const description = cleanMultiline(raw.description);
  const title =
    clean(raw.title) ||
    description.split("\n")[0]!.slice(0, 120) ||
    categoryName ||
    (clean(raw.legacyNumber) ? `Job ${clean(raw.legacyNumber)}` : "Imported job");

  const signWork =
    (category && ["sign", "wrap"].includes(category.group)) || SIGN_WORDS.test([categoryName, title, description, raw.material].filter(Boolean).join(" "));
  let widthIn: number | null = null;
  let heightIn: number | null = null;
  const size = parseSize(raw.size, { feetWhenSmall: !!signWork });
  if (size === undefined) warnings.push(`Couldn't read the size ${q(clean(raw.size))} — left blank`);
  else if (size) {
    widthIn = size.widthIn;
    heightIn = size.heightIn;
    if (size.assumedFeet) warnings.push(`Size ${q(clean(raw.size))} read as feet (${size.widthIn / 12}' × ${size.heightIn / 12}')`);
  } else {
    const w = parseInches(raw.width);
    const h = parseInches(raw.height);
    if (w === undefined || h === undefined) warnings.push("Couldn't read the width/height — left blank");
    else if (w && h) {
      widthIn = w;
      heightIn = h;
    }
  }

  const statusText = clean(raw.status);
  const cancelled = /cancel|void|lost|declin|dead|rejected/i.test(statusText);
  const done = !statusText || /complete|closed|invoic|paid|deliver|picked|ship|done|finish|billed|posted/i.test(statusText);

  if (errors.length) return { values: null, errors, warnings };
  return {
    values: {
      legacyNumber: cap(orNull(clean(raw.legacyNumber)), 60),
      customerName: customerName.slice(0, 200),
      date: date ?? null,
      title: title.slice(0, 200),
      description: (description || title).slice(0, 2000),
      quantity: Math.min(quantity, 100_000_000),
      widthIn,
      heightIn,
      categoryId: category?.id ?? null,
      categoryName,
      priceCents: price ?? 0,
      taxCents: tax ?? 0,
      status: cancelled ? "cancelled" : "completed",
      originalStatus: statusText && !done && !cancelled ? statusText.slice(0, 60) : null,
      material: cap(orNull(clean(raw.material)), 200),
      colors: cap(orNull(clean(raw.colors)), 100),
      poNumber: cap(orNull(clean(raw.poNumber)), 60),
      notes: cap(orNull(cleanMultiline(raw.notes)), 5000),
    },
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Paper & materials
// ---------------------------------------------------------------------------
const PAPER_WORDS =
  /(\d+\s*(#|lb|pt)|\b(gloss|matte|silk|uncoated|offset|text|cover|bond|index|cardstock|card stock|c2s|c1s|linen|laid|vellum|ncr|carbonless|envelope|tag|bristol|opaque)\b)/i;
const VINYL_WORDS = /\b(vinyl|banner|film|laminate|lam|scrim|mesh|wrap)\b/i;
const SUBSTRATE_WORDS = /\b(coroplast|coro|acm|dibond|pvc|sintra|foam|aluminum|board|styrene|acrylic|plexi|magnet|polycarbonate|mdf|plywood)\b/i;

function guessKind(kindText: string, name: string, paperish: boolean): string {
  const k = kindText.toLowerCase();
  if (k) {
    if (/paper|stock|text|cover|bond|card|envelope/.test(k)) return "paper";
    if (/vinyl|banner|film|laminat/.test(k)) return /laminat/.test(k) ? "laminate" : "vinyl";
    if (/substrate|board|rigid|sign/.test(k)) return "substrate";
    if (/ink|toner/.test(k)) return "ink";
    return (
      k
        .replace(/[^a-z0-9 ]/g, "")
        .trim()
        .slice(0, 40) || "other"
    );
  }
  if (paperish || PAPER_WORDS.test(name)) return "paper";
  if (VINYL_WORDS.test(name)) return "vinyl";
  if (SUBSTRATE_WORDS.test(name)) return "substrate";
  return "other";
}

function normalizeUnit(unitText: string, kind: string): { unit: string; perM: boolean } {
  const u = unitText
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!u) return { unit: kind === "paper" ? "sheet" : kind === "vinyl" || kind === "substrate" || kind === "laminate" ? "sqft" : "each", perM: false };
  if (/^(m|per m|thousand|per thousand|1000|per 1000|cwt m)$/.test(u)) return { unit: "sheet", perM: true };
  if (/^(sq ?ft|sf|square f(oo|ee)t|ft2|sqft)$/.test(u)) return { unit: "sqft", perM: false };
  if (/^(sheets?|sht|shts|sh|pcs? sheet)$/.test(u)) return { unit: "sheet", perM: false };
  if (/^(rolls?|rl|rll)$/.test(u)) return { unit: "roll", perM: false };
  if (/^(reams?|rm)$/.test(u)) return { unit: "ream", perM: false };
  if (/^(ea|each|pc|pcs|piece|pieces|unit|units)$/.test(u)) return { unit: "each", perM: false };
  if (/^(box|boxes|bx|carton|ctn|case)$/.test(u)) return { unit: "box", perM: false };
  return { unit: u.slice(0, 20), perM: false };
}

export function normalizeMaterial(raw: Raw): Normalized<"materials"> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = clean(raw.name);
  if (!name) return { values: null, errors: ["Missing name"], warnings };

  const size = parseSize(raw.size);
  let sheetWidthIn: number | null = null;
  let sheetHeightIn: number | null = null;
  if (size === undefined) warnings.push(`Couldn't read the sheet size ${q(clean(raw.size))} — left blank`);
  else if (size) ({ widthIn: sheetWidthIn, heightIn: sheetHeightIn } = size);
  else {
    const w = parseInches(raw.sheetWidth);
    const h = parseInches(raw.sheetHeight);
    if (w === undefined || h === undefined) warnings.push("Couldn't read the sheet width/height — left blank");
    else if (w && h) {
      sheetWidthIn = w;
      sheetHeightIn = h;
    }
  }

  const cost = parseDollars(raw.cost);
  const perM = parseDollars(raw.costPerM);
  if (cost === undefined) errors.push(`Couldn't read the cost ${q(clean(raw.cost))}`);
  if (perM === undefined) errors.push(`Couldn't read the cost per 1,000 ${q(clean(raw.costPerM))}`);
  if ((cost != null && cost < 0) || (perM != null && perM < 0)) errors.push("Cost can't be negative");
  if (errors.length) return { values: null, errors, warnings };

  const weight = cap(orNull(clean(raw.weight)), 60);
  const kind = guessKind(clean(raw.kind), name, sheetWidthIn != null || perM != null || (weight != null && /#|lb|pt/i.test(weight)));
  const { unit, perM: costIsPerM } = normalizeUnit(clean(raw.unit), kind);

  let costPerMCents: number | null = null;
  let costCents = 0;
  if (perM != null) {
    costPerMCents = Math.round(perM * 100);
    costCents = Math.round(perM / 10); // per sheet, whole cents
  } else if (cost != null && costIsPerM) {
    costPerMCents = Math.round(cost * 100);
    costCents = Math.round(cost / 10);
  } else if (cost != null) {
    costCents = Math.round(cost * 100);
    if (kind === "paper" && unit === "sheet") costPerMCents = Math.round(cost * 100_000);
  }
  if (cost == null && perM == null) warnings.push("No cost — saved as $0");
  if (kind === "paper" && sheetWidthIn == null) warnings.push("Paper without a sheet size can't be used for estimating until you add one");

  return {
    values: {
      name: name.slice(0, 200),
      kind,
      unit,
      costCents,
      costPerMCents,
      weight,
      sheetWidthIn,
      sheetHeightIn,
      vendorName: cap(orNull(clean(raw.vendor)), 200),
      sku: cap(orNull(clean(raw.sku)), 100),
    },
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------
export function normalizeVendor(raw: Raw): Normalized<"vendors"> {
  const warnings: string[] = [];
  const name = clean(raw.name);
  if (!name) return { values: null, errors: ["Missing vendor name"], warnings };
  const cityLine = [clean(raw.city), [parseState(raw.state), parseZip(raw.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [clean(raw.address), cityLine].filter(Boolean).join(", ");
  return {
    values: {
      name: name.slice(0, 200),
      contactName: cap(orNull(clean(raw.contactName) || combineName(raw.contactFirstName, raw.contactLastName)), 200),
      phone: phoneField(raw.phone, "Phone", warnings),
      email: emailField(raw.email, "Email", warnings),
      website: parseWebsite(raw.website),
      accountNumber: cap(orNull(clean(raw.accountNumber)), 100),
      notes: cap(joinLines(cleanMultiline(raw.notes), address && `Address: ${address}`), 5000),
    },
    errors: [],
    warnings,
  };
}

export function normalizeRow<K extends ImportKind>(kind: K, raw: Raw, ctx: NormalizeContext = {}): Normalized<K> {
  switch (kind) {
    case "customers":
      return normalizeCustomer(raw) as Normalized<K>;
    case "contacts":
      return normalizeContact(raw) as Normalized<K>;
    case "jobs":
      return normalizeJob(raw, ctx) as Normalized<K>;
    case "materials":
      return normalizeMaterial(raw) as Normalized<K>;
    default:
      return normalizeVendor(raw) as Normalized<K>;
  }
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inches = (n: number | null) => (n == null ? "" : `${Number(n.toFixed(2))}"`);
const sizeText = (w: number | null, h: number | null) => (w && h ? `${inches(w)} × ${inches(h)}` : "");
const TERMS: Record<PaymentTerms, string> = { due_on_receipt: "Due on receipt", net_15: "Net 15", net_30: "Net 30", net_45: "Net 45", net_60: "Net 60" };

/** Preview columns per kind: [label, how to show the saved value]. */
export function previewColumns<K extends ImportKind>(kind: K): { label: string; show: (v: ValuesFor[K]) => string }[] {
  const cols: { [P in ImportKind]: { label: string; show: (v: ValuesFor[P]) => string }[] } = {
    customers: [
      { label: "Name", show: (v) => v.name + (v.isCompany ? "" : " (person)") },
      { label: "Phone", show: (v) => v.phone ?? "" },
      { label: "Email", show: (v) => v.email ?? "" },
      { label: "Address", show: (v) => [v.address, v.city, [v.state, v.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") },
      { label: "Terms", show: (v) => (v.paymentTerms ? TERMS[v.paymentTerms] : "") },
      { label: "Tax", show: (v) => (v.taxExempt ? `Exempt${v.taxExemptId ? ` (${v.taxExemptId})` : ""}` : "") },
      { label: "Contact", show: (v) => (v.contact ? [v.contact.name, v.contact.email].filter(Boolean).join(" · ") : "") },
    ],
    contacts: [
      { label: "Customer", show: (v) => v.customerName },
      { label: "Contact", show: (v) => v.name + (v.isPrimary ? " (main)" : "") },
      { label: "Title", show: (v) => v.title ?? "" },
      { label: "Email", show: (v) => v.email ?? "" },
      { label: "Phone", show: (v) => v.phone ?? "" },
    ],
    jobs: [
      { label: "Old #", show: (v) => v.legacyNumber ?? "" },
      { label: "Customer", show: (v) => v.customerName },
      { label: "Date", show: (v) => v.date ?? "" },
      { label: "Job", show: (v) => v.title + (v.description !== v.title ? ` — ${v.description}` : "") },
      { label: "Qty", show: (v) => v.quantity.toLocaleString("en-US") },
      { label: "Size", show: (v) => sizeText(v.widthIn, v.heightIn) },
      { label: "Category", show: (v) => v.categoryName ?? "" },
      { label: "Price", show: (v) => money(v.priceCents) },
    ],
    materials: [
      { label: "Name", show: (v) => v.name },
      { label: "Kind", show: (v) => `${v.kind} / ${v.unit}` },
      { label: "Sheet size", show: (v) => sizeText(v.sheetWidthIn, v.sheetHeightIn) },
      { label: "Weight", show: (v) => v.weight ?? "" },
      { label: "Cost", show: (v) => (v.costPerMCents != null ? `${money(v.costPerMCents)} / 1,000` : money(v.costCents)) },
      { label: "Vendor", show: (v) => v.vendorName ?? "" },
    ],
    vendors: [
      { label: "Vendor", show: (v) => v.name },
      { label: "Contact", show: (v) => v.contactName ?? "" },
      { label: "Phone", show: (v) => v.phone ?? "" },
      { label: "Email", show: (v) => v.email ?? "" },
      { label: "Account #", show: (v) => v.accountNumber ?? "" },
    ],
  };
  return cols[kind] as { label: string; show: (v: ValuesFor[K]) => string }[];
}
