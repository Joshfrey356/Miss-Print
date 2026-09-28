/**
 * Demo data for Miss Print Command Center.
 * Realistic customers, a year of job history (for price lookups & reports) and
 * current work spread across every stage. Safe to run on an empty database only.
 * Miss Print is shop (tenant) #1; demo mode also adds a small second shop, Lakeshore Signs,
 * so multi-tenancy can be seen and tested (it shares a customer name and a job title with Miss Print).
 *
 *   npm run db:reset   # drop, migrate, seed
 */
import "./env";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import bcrypt from "bcryptjs";
import { eq, sql, type SQLWrapper } from "drizzle-orm";
import * as s from "../src/lib/db/schema";
import type { PricingConfig } from "../src/lib/pricing/engine";
import { insertStarterPrintCatalog, starterPrintCategories } from "../src/lib/estimating/starter-catalog";

const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle(client, { schema: s });

// ---------- deterministic randomness ----------
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;
const between = (a: number, b: number) => a + rand() * (b - a);
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

const TZ = "America/Chicago";
const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const dayOffset = (n: number) => ymd(new Date(Date.now() + n * 86400000));
const at = (dayOff: number, hour = 9, min = 0) => {
  const d = new Date(Date.now() + dayOff * 86400000);
  const [y, m, dd] = ymd(d).split("-").map(Number);
  // Central time ≈ UTC-5 (CDT) — fine for demo data.
  return new Date(Date.UTC(y!, m! - 1, dd!, hour + 5, min));
};
/** Skip Sundays for due dates */
const workday = (n: number) => {
  let d = n;
  while (new Date(Date.now() + d * 86400000).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }) === "Sun") d++;
  return d;
};

/** Miss Print's company profile (Settings → Company). Saved in demo and base mode. */
const MISS_PRINT_COMPANY = {
  name: "Miss Print",
  tagline: "Print · Design · Signs",
  phone: "219-836-2517",
  email: "orders@missprintusa.com",
  website: "https://missprintusa.com",
  address: "8244 Calumet Ave, Munster, IN 46321",
  hours: "Mon–Fri 8:30–5:00 · Sat 9:00–12:00",
};

/** Each shop's numbers are handed out here in insert order, then saved to its counters by syncCounters(). */
const counter = (start: number) => {
  let n = start;
  return () => n++;
};

/** Point a shop's next job/quote/invoice numbers past the highest one it has (unchanged when it has none). */
async function syncCounters(tenantId: number) {
  const next = (t: typeof s.jobs | typeof s.quotes | typeof s.invoices, current: SQLWrapper) =>
    sql<number>`coalesce((select max(${t.number}) + 1 from ${t} where ${t.tenantId} = ${tenantId}), ${current})`;
  await db
    .update(s.tenants)
    .set({ nextJobNumber: next(s.jobs, s.tenants.nextJobNumber), nextQuoteNumber: next(s.quotes, s.tenants.nextQuoteNumber), nextInvoiceNumber: next(s.invoices, s.tenants.nextInvoiceNumber) })
    .where(eq(s.tenants.id, tenantId));
}

async function main() {
  const existing = await db.execute<{ n: number }>(sql`select (select count(*) from ${s.users})::int + (select count(*) from ${s.tenants})::int as n`);
  if (Number(existing[0]!.n) > 0) {
    console.log("Database already has data. Run `npm run db:reset` to start fresh.");
    await client.end();
    return;
  }
  // BASE mode (go-live): only the owner account + reference data, no demo customers/jobs.
  // Checked before anything is written, so a missing setting leaves the database empty.
  const BASE = process.env.SEED_MODE === "base";
  if (BASE && (!process.env.OWNER_EMAIL || (process.env.OWNER_PASSWORD ?? "").length < 10))
    throw new Error("SEED_MODE=base needs OWNER_EMAIL and OWNER_PASSWORD (10+ characters), optionally OWNER_NAME.");
  console.log("Seeding Miss Print demo data…");

  // ---------- shop (tenant) ----------
  // Numbers continue Miss Print's existing ranges (MP-10400…, Q-5000…, INV-7000…).
  const [shop] = await db.insert(s.tenants).values({ slug: "miss-print", name: "Miss Print", nextJobNumber: 10400, nextQuoteNumber: 5000, nextInvoiceNumber: 7000 }).returning();
  const T = shop!.id;
  const nextJobNo = counter(shop!.nextJobNumber);
  const nextQuoteNo = counter(shop!.nextQuoteNumber);
  const nextInvoiceNo = counter(shop!.nextInvoiceNumber);

  // ---------- locations ----------
  const [munster, hammond, offsite] = await db
    .insert(s.locations)
    .values([
      { tenantId: T, code: "MUNSTER", name: "Munster", role: "Customer intake · front counter · commercial printing", address: "8244 Calumet Ave, Munster, IN 46321", phone: "219-836-2517", isCustomerFacing: true, sortOrder: 1 },
      { tenantId: T, code: "HAMMOND", name: "Hammond", role: "Production · signs · large format · wraps", address: "Hammond, IN (confirm address)", phone: null, isCustomerFacing: false, sortOrder: 2 },
      { tenantId: T, code: "OFFSITE", name: "Off-site", role: "Installations at the customer's site", sortOrder: 3 },
    ])
    .returning();

  // ---------- users ----------
  const pw = await bcrypt.hash(process.env.SEED_PASSWORD ?? "missprint2026", 12);
  const people = [
    { name: "Rick Baltensberger", handle: "rick", email: "owner@missprintusa.com", role: "owner" as const, title: "Owner", color: "#0d72c4", locationId: munster!.id },
    { name: "Jen Novak", handle: "jen", email: "jen@missprintusa.com", role: "manager" as const, title: "Operations Manager", color: "#7c3aed", locationId: munster!.id },
    { name: "Alex Moreno", handle: "alex", email: "alex@missprintusa.com", role: "sales" as const, title: "Front Counter / Sales", color: "#059669", locationId: munster!.id },
    { name: "Sarah Kowalski", handle: "sarah", email: "sarah@missprintusa.com", role: "designer" as const, title: "Graphic Designer", color: "#db2777", locationId: munster!.id },
    { name: "Mike Petrovic", handle: "mike", email: "mike@missprintusa.com", role: "production" as const, title: "Production Lead", color: "#ea580c", locationId: hammond!.id },
    { name: "Luis Ortega", handle: "luis", email: "luis@missprintusa.com", role: "production" as const, title: "Press Operator", color: "#ca8a04", locationId: munster!.id },
    { name: "Tony Russo", handle: "tony", email: "tony@missprintusa.com", role: "installer" as const, title: "Installer", color: "#0891b2", locationId: hammond!.id },
    { name: "Dana Whitfield", handle: "dana", email: "dana@missprintusa.com", role: "accounting" as const, title: "Bookkeeper", color: "#4b5563", locationId: munster!.id },
  ];
  if (BASE) {
    const email = process.env.OWNER_EMAIL!;
    people.splice(0, people.length, { ...people[0]!, name: process.env.OWNER_NAME ?? "Owner", email, handle: (process.env.OWNER_NAME ?? "owner").split(" ")[0]!.toLowerCase() });
  }
  const ownerPw = BASE ? await bcrypt.hash(process.env.OWNER_PASSWORD!, 12) : pw;
  const us = await db.insert(s.users).values(people.map((p) => ({ ...p, tenantId: T, passwordHash: ownerPw }))).returning();
  const U = Object.fromEntries(us.map((u) => [u.handle, u])) as Record<string, s.User>;
  if (BASE) U.rick = us[0]!;

  // ---------- settings / business rules ----------
  await db.insert(s.companySettings).values([
    { tenantId: T, key: "company", value: MISS_PRINT_COMPANY },
    {
      tenantId: T,
      key: "business_rules",
      value: {
        minimumChargeCents: 2500,
        designRateCents: 7500,
        installRateCents: 8500,
        laborCostPerHourCents: 2800,
        mileageRateCents: 150,
        rushPct: 0.25,
        targetMarginPct: 0.5,
        outsourcedMarkupPct: 0.3,
        taxRate: 0.07,
      },
    },
    { tenantId: T, key: "quote_valid_days", value: 30 },
  ]);

  // ---------- vendors & materials ----------
  const vendors = await db
    .insert(s.vendors)
    .values([
      { tenantId: T, name: "Grimco", phone: "800-542-9941", notes: "Sign supplies, substrates, vinyl. Hammond deliveries Tue/Thu." },
      { tenantId: T, name: "Fellers", notes: "Wrap vinyl & laminates (3M, Avery)." },
      { tenantId: T, name: "Veritiv", notes: "Paper stocks." },
      { tenantId: T, name: "Midwest Paper Supply", notes: "Backup paper vendor." },
      { tenantId: T, name: "Ink & Toner Direct", notes: "Konica/HP consumables." },
      { tenantId: T, name: "4imprint", notes: "Promo items — outsourced." },
      { tenantId: T, name: "USPS", notes: "Mailing / EDDM postage." },
    ])
    .returning();
  const V = Object.fromEntries(vendors.map((v) => [v.name, v]));
  const mats = await db
    .insert(s.materials)
    .values([
      { tenantId: T, name: "13oz Scrim Vinyl Banner", kind: "vinyl", unit: "sqft", costCents: 55, vendorId: V["Grimco"]!.id, quantityOnHand: 1200, reorderLevel: 400 },
      { tenantId: T, name: "15oz Blockout Banner", kind: "vinyl", unit: "sqft", costCents: 85, vendorId: V["Grimco"]!.id, quantityOnHand: 450, reorderLevel: 200 },
      { tenantId: T, name: "8oz Mesh Banner", kind: "vinyl", unit: "sqft", costCents: 95, vendorId: V["Grimco"]!.id, quantityOnHand: 300, reorderLevel: 150 },
      { tenantId: T, name: "4mm Coroplast", kind: "substrate", unit: "sqft", costCents: 110, vendorId: V["Grimco"]!.id, quantityOnHand: 640, reorderLevel: 320 },
      { tenantId: T, name: "3mm Aluminum Composite (ACM)", kind: "substrate", unit: "sqft", costCents: 380, vendorId: V["Grimco"]!.id, quantityOnHand: 256, reorderLevel: 128 },
      { tenantId: T, name: "3mm PVC", kind: "substrate", unit: "sqft", costCents: 210, vendorId: V["Grimco"]!.id, quantityOnHand: 160, reorderLevel: 96 },
      { tenantId: T, name: "3/16\" Foam Board", kind: "substrate", unit: "sqft", costCents: 140, vendorId: V["Grimco"]!.id, quantityOnHand: 96, reorderLevel: 64 },
      { tenantId: T, name: "3M IJ180Cv3 Wrap Vinyl + 8518 Laminate", kind: "vinyl", unit: "sqft", costCents: 320, vendorId: V["Fellers"]!.id, quantityOnHand: 900, reorderLevel: 450 },
      { tenantId: T, name: "Oracal 651 Cut Vinyl", kind: "vinyl", unit: "sqft", costCents: 60, vendorId: V["Fellers"]!.id, quantityOnHand: 500, reorderLevel: 200 },
      { tenantId: T, name: "Backlit Film", kind: "vinyl", unit: "sqft", costCents: 240, vendorId: V["Grimco"]!.id, quantityOnHand: 80, reorderLevel: 50 },
      { tenantId: T, name: "24# White Wove #10 Envelope", kind: "paper", unit: "each", costCents: 4, vendorId: V["Veritiv"]!.id, quantityOnHand: 5000, reorderLevel: 2000 },
    ])
    .returning();
  const M = Object.fromEntries(mats.map((m) => [m.name, m]));

  // ---------- print estimating: paper stocks (materials), presses, bindery & services ----------
  const printCatalog = await insertStarterPrintCatalog(db, T, { paperVendorId: V["Veritiv"]!.id, locationId: munster!.id });
  const printCats = starterPrintCategories(printCatalog);
  /** Business cards, flyers and brochures are estimated from paper + press (Printer's Plan style). */
  const PRINT_ESTIMATED = new Set(["business-cards", "flyers", "brochures"]);

  // ---------- categories & pricing rules ----------
  type Cat = { slug: string; name: string; group: string; method: PricingConfig["method"]; loc: number; proof?: boolean; install?: boolean; config: PricingConfig; notes?: string };
  const baseCats: Cat[] = [
    { slug: "business-cards", name: "Business Cards", group: "print", method: "quantity_tier", loc: munster!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 4500, costCents: 1400 }, { minQty: 500, priceCents: 5500, costCents: 1800 }, { minQty: 1000, priceCents: 7000, costCents: 2500 }, { minQty: 2500, priceCents: 13500, costCents: 5200 }], finishingOptions: [{ key: "double", label: "Double-sided", basis: "flat", priceCents: 1500, costCents: 400 }, { key: "round", label: "Rounded corners", basis: "flat", priceCents: 2000 }, { key: "soft", label: "Soft-touch coating", basis: "flat", priceCents: 3500, costCents: 1200 }] }, notes: "Standard 14pt, full color. Double-sided adds $15. Repeat orders usually skip the proof." },
    { slug: "brochures", name: "Brochures", group: "print", method: "quantity_tier", loc: munster!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 24500, costCents: 9000 }, { minQty: 500, priceCents: 32500, costCents: 12500 }, { minQty: 1000, priceCents: 45000, costCents: 18500 }, { minQty: 2500, priceCents: 82500, costCents: 36000 }], finishingOptions: [{ key: "fold", label: "Tri-fold / bi-fold", basis: "flat", priceCents: 0 }, { key: "score", label: "Scoring (heavy stock)", basis: "flat", priceCents: 2500 }] }, notes: "8.5×11 100# gloss text, full color both sides, folded." },
    { slug: "flyers", name: "Flyers", group: "print", method: "quantity_tier", loc: munster!.id, config: { method: "quantity_tier", tiers: [{ minQty: 100, priceCents: 5500, costCents: 1500 }, { minQty: 250, priceCents: 8500, costCents: 2800 }, { minQty: 500, priceCents: 12500, costCents: 4500 }, { minQty: 1000, priceCents: 18500, costCents: 7200 }, { minQty: 2500, priceCents: 36500, costCents: 15500 }] } },
    { slug: "postcards-mailers", name: "Postcards & Mailers", group: "print", method: "quantity_tier", loc: munster!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 9500, costCents: 3000 }, { minQty: 500, priceCents: 13500, costCents: 4600 }, { minQty: 1000, priceCents: 19500, costCents: 7400 }, { minQty: 5000, priceCents: 69500, costCents: 29000 }], finishingOptions: [{ key: "eddm", label: "EDDM bundling & prep", basis: "per_unit", priceCents: 3 }, { key: "vdp", label: "Variable data addressing", basis: "per_unit", priceCents: 6 }] } },
    { slug: "envelopes", name: "Envelopes", group: "print", method: "quantity_tier", loc: munster!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 11000, costCents: 3500 }, { minQty: 500, priceCents: 15000, costCents: 5500 }, { minQty: 1000, priceCents: 23500, costCents: 9500 }] } },
    { slug: "letterhead", name: "Letterhead", group: "print", method: "quantity_tier", loc: munster!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 9000, costCents: 2800 }, { minQty: 500, priceCents: 12500, costCents: 4200 }, { minQty: 1000, priceCents: 19000, costCents: 7000 }] } },
    { slug: "forms", name: "Forms (NCR)", group: "print", method: "quantity_tier", loc: munster!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 14500, costCents: 5000 }, { minQty: 500, priceCents: 19500, costCents: 7200 }, { minQty: 1000, priceCents: 29500, costCents: 11500 }], finishingOptions: [{ key: "number", label: "Numbering", basis: "flat", priceCents: 3500 }, { key: "pad", label: "Padding into books", basis: "flat", priceCents: 2500 }] } },
    { slug: "folders", name: "Presentation Folders", group: "print", method: "quantity_tier", loc: munster!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 49500, costCents: 22000 }, { minQty: 500, priceCents: 69500, costCents: 31000 }] } },
    { slug: "labels-stickers", name: "Labels & Stickers", group: "print", method: "quantity_tier", loc: hammond!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 15000, costCents: 4500 }, { minQty: 500, priceCents: 21000, costCents: 6500 }, { minQty: 1000, priceCents: 32500, costCents: 10500 }] } },
    { slug: "posters", name: "Posters", group: "sign", method: "per_sqft", loc: hammond!.id, config: { method: "per_sqft", pricePerSqftCents: 800, materialCostPerSqftCents: 90, wastePct: 0.05, finishingOptions: [{ key: "mount", label: "Mount to foam board", basis: "per_sqft", priceCents: 400, costCents: 140 }, { key: "lam", label: "Laminate", basis: "per_sqft", priceCents: 200, costCents: 45 }] } },
    { slug: "banners", name: "Banners", group: "sign", method: "per_sqft", loc: hammond!.id, config: { method: "per_sqft", pricePerSqftCents: 550, materialCostPerSqftCents: 85, wastePct: 0.1, setupCents: 1500, machineHours: 0.3, machineCostPerHourCents: 3500, finishingOptions: [{ key: "hem", label: "Hem & grommets", basis: "per_linear_ft", priceCents: 50, costCents: 10 }, { key: "pocket", label: "Pole pockets", basis: "per_linear_ft", priceCents: 150, costCents: 20 }, { key: "slits", label: "Wind slits", basis: "flat", priceCents: 1000 }, { key: "double", label: "Double-sided", basis: "per_sqft", priceCents: 450, costCents: 80 }] }, notes: "13oz scrim, full color. Hem + grommets every 2 ft standard. 4×8 usually lands $185–$210." },
    { slug: "yard-signs", name: "Yard Signs", group: "sign", method: "per_unit", loc: hammond!.id, config: { method: "per_unit", unitPriceCents: 1200, unitCostCents: 350, setupCents: 2500, finishingOptions: [{ key: "stakes", label: "H-stakes", basis: "per_unit", priceCents: 200, costCents: 70 }, { key: "double", label: "Double-sided", basis: "per_unit", priceCents: 300, costCents: 60 }] }, notes: "18×24 4mm coroplast. Price per sign; setup covers file prep." },
    { slug: "signs", name: "Commercial Signs", group: "sign", method: "per_sqft", loc: hammond!.id, install: true, config: { method: "per_sqft", pricePerSqftCents: 1400, materialCostPerSqftCents: 380, materialMarkupPct: 2.5, wastePct: 0.15, setupCents: 5000, installHours: 3, finishingOptions: [{ key: "lam", label: "UV laminate", basis: "per_sqft", priceCents: 250, costCents: 60 }, { key: "holes", label: "Drilled holes / standoffs", basis: "flat", priceCents: 4500, costCents: 1500 }] }, notes: "Rigid signs: ACM, PVC, coroplast. Material choice changes cost; installation priced separately." },
    { slug: "backlit-signs", name: "Backlit & Illuminated Signs", group: "sign", method: "custom", loc: hammond!.id, install: true, config: { method: "custom", targetMarginPct: 0.45, installHours: 6 }, notes: "Usually quoted custom with the sign cabinet vendor. Enter the vendor cost as outside services." },
    { slug: "banner-stands", name: "Retractable Banner Stands", group: "sign", method: "per_unit", loc: hammond!.id, proof: true, config: { method: "per_unit", unitPriceCents: 24900, unitCostCents: 9500 } },
    { slug: "wall-graphics", name: "Wall Graphics & Wraps", group: "sign", method: "per_sqft", loc: hammond!.id, install: true, config: { method: "per_sqft", pricePerSqftCents: 1200, materialCostPerSqftCents: 250, wastePct: 0.15, designHours: 3, installHours: 4 } },
    { slug: "decals", name: "Decals", group: "sign", method: "per_sqft", loc: hammond!.id, config: { method: "per_sqft", pricePerSqftCents: 1000, materialCostPerSqftCents: 120, wastePct: 0.2, minimumCents: 3500, finishingOptions: [{ key: "cut", label: "Contour cut", basis: "per_sqft", priceCents: 300 }, { key: "mask", label: "Transfer tape / masking", basis: "per_sqft", priceCents: 150 }] } },
    { slug: "vehicle-graphics", name: "Vehicle Graphics (Partial)", group: "wrap", method: "per_sqft", loc: hammond!.id, install: true, config: { method: "per_sqft", pricePerSqftCents: 1200, materialCostPerSqftCents: 180, wastePct: 0.2, designHours: 2, installHours: 3 } },
    { slug: "vehicle-wraps", name: "Vehicle Wraps", group: "wrap", method: "per_sqft", loc: hammond!.id, install: true, config: { method: "per_sqft", pricePerSqftCents: 1100, materialCostPerSqftCents: 320, wastePct: 0.2, designHours: 6, installHours: 12, targetMarginPct: 0.45 }, notes: "Full wrap = print + laminate per sq ft, plus design and install hours. Ford Transit 148\" high roof ≈ 290 sq ft of wrap." },
    { slug: "graphic-design", name: "Graphic Design", group: "design", method: "per_unit", loc: munster!.id, config: { method: "per_unit", unitPriceCents: 7500 }, notes: "Quantity = hours." },
    { slug: "offset-printing", name: "Offset / Custom Commercial Printing", group: "print", method: "custom", loc: munster!.id, config: { method: "custom" } },
    { slug: "other", name: "Other / Custom", group: "other", method: "custom", loc: munster!.id, config: { method: "custom" } },
  ];
  const cats = baseCats.map((c) => (PRINT_ESTIMATED.has(c.slug) ? { ...c, method: "sheet_fed" as const, config: printCats[c.slug]!.config, notes: printCats[c.slug]!.notes } : c));
  const catRows = await db
    .insert(s.productCategories)
    .values(cats.map((c, i) => ({ tenantId: T, slug: c.slug, name: c.name, group: c.group, pricingMethod: c.method, defaultLocationId: c.loc, defaultNeedsProof: c.proof ?? true, defaultNeedsInstall: c.install ?? false, sortOrder: i })))
    .returning();
  const C = Object.fromEntries(catRows.map((c) => [c.slug, c]));
  await db.insert(s.pricingRules).values(cats.map((c) => ({ tenantId: T, categoryId: C[c.slug]!.id, config: c.config, notes: c.notes ?? null, updatedBy: U.rick!.id })));
  if (BASE) {
    await syncCounters(T);
    console.log(`✓ Base setup done: locations, ${cats.length} categories with starter pricing, vendors, materials and owner ${us[0]!.email}.`);
    console.log("  Review Settings → Business Rules and Pricing before quoting.");
    await client.end();
    return;
  }

  // ---------- customers ----------
  type Cu = { name: string; phone: string; email: string; address: string; city: string; zip: string; contacts: [string, string?, string?][]; sales?: string; terms?: s.Customer["paymentTerms"]; exempt?: boolean; po?: boolean; discount?: number; notes?: string; since: string; company?: boolean };
  const custs: Cu[] = [
    { name: "ABC Plumbing", phone: "219-555-0142", email: "office@abcplumbingnwi.com", address: "1420 Ridge Rd", city: "Munster", zip: "46321", contacts: [["Tom Brennan", "Owner", "tom@abcplumbingnwi.com"], ["Linda Brennan", "Office Manager", "office@abcplumbingnwi.com"]], sales: "alex", terms: "net_30", notes: "Fleet of 6 vans (Ford Transit). Likes to approve proofs by text — follow up by phone.", since: "2014-03-10" },
    { name: "Munster Dental", phone: "219-555-0187", email: "frontdesk@munsterdental.com", address: "915 Calumet Ave", city: "Munster", zip: "46321", contacts: [["Dr. Priya Shah", "Dentist / Owner", "pshah@munsterdental.com"], ["Karen Lutz", "Office Manager", "frontdesk@munsterdental.com"]], sales: "alex", terms: "net_15", notes: "Reorders business cards for new hygienists several times a year.", since: "2011-06-02" },
    { name: "Northwest Indiana Construction", phone: "219-555-0110", email: "projects@nwiconstruction.com", address: "7800 Industrial Hwy", city: "Gary", zip: "46406", contacts: [["Dave Kowalczyk", "Project Manager", "dave@nwiconstruction.com"], ["Accounts Payable", "AP", "ap@nwiconstruction.com"]], sales: "rick", terms: "net_30", po: true, notes: "PO number required on every invoice. Site signs for every project.", since: "2009-09-15" },
    { name: "Lake County Athletics", phone: "219-555-0133", email: "info@lakecountyathletics.org", address: "300 Sports Complex Dr", city: "Crown Point", zip: "46307", contacts: [["Coach Maria Delgado", "Director", "maria@lakecountyathletics.org"]], sales: "alex", exempt: true, terms: "net_30", notes: "Non-profit — tax exempt certificate on file (ST-105).", since: "2016-02-20" },
    { name: "Smith Manufacturing", phone: "219-555-0199", email: "purchasing@smithmfg.com", address: "4500 Kennedy Ave", city: "Hammond", zip: "46323", contacts: [["Greg Smith", "VP Operations", "greg@smithmfg.com"], ["Purchasing", "Purchasing Dept", "purchasing@smithmfg.com"]], sales: "rick", terms: "net_45", po: true, discount: 0.05, notes: "5% contract discount. Safety signs, NCR forms, trade show materials.", since: "2007-04-11" },
    { name: "Munster Police Department", phone: "219-555-0100", email: "admin@munsterpd.example.gov", address: "1001 Ridge Rd", city: "Munster", zip: "46321", contacts: [["Sgt. Kevin Walsh", "Community Relations", "kwalsh@munsterpd.example.gov"]], sales: "rick", exempt: true, terms: "net_30", po: true, notes: "Government — tax exempt, PO required. Vehicle decals, event banners.", since: "2010-01-05" },
    { name: "Calumet Coffee Roasters", phone: "219-555-0156", email: "hello@calumetcoffee.com", address: "8120 Calumet Ave", city: "Munster", zip: "46321", contacts: [["Jess Morales", "Owner", "jess@calumetcoffee.com"]], sales: "alex", notes: "Neighbor on Calumet Ave. Menu boards, stickers, cups sleeves.", since: "2021-05-14" },
    { name: "Ridge Road Realty Group", phone: "219-555-0171", email: "team@ridgeroadrealty.com", address: "2150 45th St", city: "Highland", zip: "46322", contacts: [["Paula Grant", "Broker", "paula@ridgeroadrealty.com"]], sales: "alex", terms: "net_15", notes: "Yard signs + riders for every new agent. Keeps a template on file.", since: "2018-08-01" },
    { name: "Lakeshore HVAC Services", phone: "219-555-0164", email: "service@lakeshorehvac.com", address: "620 Joliet St", city: "Dyer", zip: "46311", contacts: [["Ray Jablonski", "Owner", "ray@lakeshorehvac.com"]], sales: "rick", terms: "net_30", since: "2019-03-22" },
    { name: "Pinewood Pediatrics", phone: "219-555-0128", email: "office@pinewoodpeds.com", address: "9250 Columbia Ave", city: "Munster", zip: "46321", contacts: [["Dr. Alan Fischer", "Physician", "afischer@pinewoodpeds.com"], ["Tina Ruiz", "Practice Manager", "office@pinewoodpeds.com"]], sales: "alex", terms: "net_30", since: "2015-10-09" },
    { name: "Region Roofing & Siding", phone: "219-555-0119", email: "info@regionroofing.com", address: "3300 Grant St", city: "Gary", zip: "46408", contacts: [["Mark Hughes", "Owner", "mark@regionroofing.com"]], sales: "rick", notes: "Pays by check at pickup.", since: "2020-04-17" },
    { name: "Steel City Fitness", phone: "219-555-0181", email: "manager@steelcityfit.com", address: "1800 Indianapolis Blvd", city: "Whiting", zip: "46394", contacts: [["Brandon Lee", "GM", "manager@steelcityfit.com"]], sales: "alex", since: "2022-01-11" },
    { name: "Cedar Lake Marina", phone: "219-555-0192", email: "office@cedarlakemarina.com", address: "13100 Lake Shore Dr", city: "Cedar Lake", zip: "46303", contacts: [["Nancy Pruitt", "Owner", "office@cedarlakemarina.com"]], sales: "rick", since: "2017-05-30" },
    { name: "Hoosier Landscape Co.", phone: "219-555-0147", email: "crew@hoosierlandscape.com", address: "555 US-41", city: "Schererville", zip: "46375", contacts: [["Jake Wilder", "Owner", "jake@hoosierlandscape.com"]], sales: "alex", since: "2019-02-02" },
    { name: "St. John Family Chiropractic", phone: "219-555-0175", email: "desk@sjfamilychiro.com", address: "9400 Wicker Ave", city: "St. John", zip: "46373", contacts: [["Dr. Emily Carter", "Chiropractor", "desk@sjfamilychiro.com"]], sales: "alex", since: "2023-07-19" },
    { name: "Hammond Auto Body", phone: "219-555-0138", email: "shop@hammondautobody.com", address: "6420 Columbia Ave", city: "Hammond", zip: "46320", contacts: [["Sal Romano", "Owner", "shop@hammondautobody.com"]], sales: "rick", since: "2012-11-12" },
    { name: "Karen Mitchell", company: false, phone: "219-555-0166", email: "karen.mitchell@example.com", address: "212 Park Dr", city: "Munster", zip: "46321", contacts: [["Karen Mitchell"]], sales: "alex", notes: "Graduation party — banners and yard signs.", since: "2026-05-02" },
  ];
  const custRows = [];
  for (const c of custs) {
    const [row] = await db
      .insert(s.customers)
      .values({
        tenantId: T,
        name: c.name,
        isCompany: c.company ?? true,
        phone: c.phone,
        email: c.email,
        address: c.address,
        city: c.city,
        state: "IN",
        zip: c.zip,
        taxExempt: c.exempt ?? false,
        taxExemptId: c.exempt ? "ST-105 on file" : null,
        paymentTerms: c.terms ?? "due_on_receipt",
        poRequired: c.po ?? false,
        discountPct: c.discount ?? 0,
        salespersonId: U[c.sales ?? "alex"]!.id,
        notes: c.notes ?? null,
        customerSince: c.since,
      })
      .returning();
    const contacts = await db
      .insert(s.customerContacts)
      .values(c.contacts.map(([name, title, email], i) => ({ tenantId: T, customerId: row!.id, name, title: title ?? null, email: email ?? c.email, phone: i === 0 ? c.phone : null, isPrimary: i === 0 })))
      .returning();
    custRows.push({ ...row!, contactId: contacts[0]!.id, exempt: c.exempt ?? false, terms: c.terms ?? "due_on_receipt" });
  }
  const CU = Object.fromEntries(custRows.map((c) => [c.name, c]));

  // ---------- helpers ----------
  const termsDays: Record<string, number> = { due_on_receipt: 0, net_15: 15, net_30: 30, net_45: 45, net_60: 60 };
  const TAX = 0.07;

  type ItemSpec = { cat: string; desc: string; qty: number; w?: number; h?: number; material?: string; finishing?: string; specs?: string; price: number; cost: number; recommended?: number; override?: string };
  type JobSpec = {
    customer: string;
    title: string;
    cat: string;
    status: s.JobStatus;
    priority?: s.Priority;
    createdDay: number; // relative to today (negative = past)
    dueDay: number | null;
    items: ItemSpec[];
    needsDesign?: boolean;
    needsProof?: boolean;
    needsInstall?: boolean;
    fulfillment?: s.Fulfillment;
    fulfillmentAt?: Date | null;
    siteAddress?: string;
    designer?: string;
    production?: string;
    installer?: string;
    sales?: string;
    location?: number;
    description?: string;
    internal?: string;
    completedDay?: number;
    invoice?: "none" | "unpaid" | "paid" | "partial" | "overdue";
    paidDay?: number;
    extraCost?: { vendor: string; amount: number; category: s.ExpenseCategory; notes?: string }[];
    laborHours?: number;
    po?: string;
    fromQuote?: boolean;
  };

  const jobIds: Record<string, { id: number; number: number }> = {};

  async function makeJob(j: JobSpec) {
    const cust = CU[j.customer]!;
    const subtotal = j.items.reduce((a, i) => a + i.price, 0);
    const taxable = subtotal;
    const tax = cust.exempt ? 0 : Math.round(taxable * TAX);
    const est = j.items.reduce((a, i) => a + i.cost, 0);
    const created = at(j.createdDay, 9 + Math.floor(rand() * 7), Math.floor(rand() * 59));
    const cat = C[j.cat]!;
    const done = j.status === "completed";
    const completedAt = done ? at(j.completedDay ?? (j.dueDay ?? j.createdDay + 5), 15) : null;

    let quoteId: number | null = null;
    if (j.fromQuote !== false && subtotal > 30000) {
      const [q] = await db
        .insert(s.quotes)
        .values({
          tenantId: T,
          number: nextQuoteNo(),
          customerId: cust.id,
          contactId: cust.contactId,
          title: j.title,
          status: "converted",
          salespersonId: U[j.sales ?? "alex"]!.id,
          locationId: munster!.id,
          needsDesign: j.needsDesign ?? false,
          needsInstall: j.needsInstall ?? false,
          dueDate: j.dueDay != null ? dayOffset(j.dueDay) : null,
          validUntil: dayOffset(j.createdDay + 30),
          subtotalCents: subtotal,
          taxRate: cust.exempt ? 0 : TAX,
          taxCents: tax,
          totalCents: subtotal + tax,
          estimatedCostCents: est,
          sentAt: at(j.createdDay - 3, 11),
          respondedAt: created,
          createdBy: U[j.sales ?? "alex"]!.id,
          createdAt: at(j.createdDay - 4, 10),
        })
        .returning();
      quoteId = q!.id;
      await db.insert(s.quoteItems).values(
        j.items.map((i, idx) => ({
          tenantId: T,
          quoteId: q!.id,
          categoryId: C[i.cat]!.id,
          description: i.desc,
          quantity: i.qty,
          widthIn: i.w ?? null,
          heightIn: i.h ?? null,
          material: i.material ?? null,
          finishing: i.finishing ?? null,
          specs: i.specs ?? null,
          recommendedCents: i.recommended ?? i.price,
          priceCents: i.price,
          overrideReason: i.override ?? null,
          estimatedCostCents: i.cost,
          sortOrder: idx,
        })),
      );
    }

    const [job] = await db
      .insert(s.jobs)
      .values({
        tenantId: T,
        number: nextJobNo(),
        customerId: cust.id,
        contactId: cust.contactId,
        quoteId,
        title: j.title,
        categoryId: cat.id,
        description: j.description ?? null,
        status: j.status,
        priority: j.priority ?? "normal",
        locationId: j.location ?? cat.defaultLocationId,
        fulfillment: j.fulfillment ?? (j.needsInstall ? "install" : "pickup"),
        needsDesign: j.needsDesign ?? false,
        needsProof: j.needsProof ?? true,
        needsInstall: j.needsInstall ?? false,
        salespersonId: U[j.sales ?? "alex"]!.id,
        designerId: j.designer ? U[j.designer]!.id : j.needsDesign ? U.sarah!.id : null,
        productionId: j.production ? U[j.production]!.id : cat.defaultLocationId === hammond!.id ? U.mike!.id : U.luis!.id,
        installerId: j.installer ? U[j.installer]!.id : j.needsInstall ? U.tony!.id : null,
        dueDate: j.dueDay != null ? dayOffset(j.dueDay) : null,
        productionDueDate: j.dueDay != null ? dayOffset(j.dueDay - 1) : null,
        fulfillmentAt: j.fulfillmentAt ?? null,
        siteAddress: j.siteAddress ?? null,
        poNumber: j.po ?? null,
        subtotalCents: subtotal,
        taxRate: cust.exempt ? 0 : TAX,
        taxCents: tax,
        totalCents: subtotal + tax,
        estimatedCostCents: est,
        laborHours: j.laborHours ?? 0,
        internalNotes: j.internal ?? null,
        completedAt,
        createdBy: U[j.sales ?? "alex"]!.id,
        createdAt: created,
        updatedAt: completedAt ?? created,
      })
      .returning();
    await db.insert(s.jobItems).values(
      j.items.map((i, idx) => ({
        tenantId: T,
        jobId: job!.id,
        categoryId: C[i.cat]!.id,
        description: i.desc,
        quantity: i.qty,
        widthIn: i.w ?? null,
        heightIn: i.h ?? null,
        material: i.material ?? null,
        finishing: i.finishing ?? null,
        specs: i.specs ?? null,
        recommendedCents: i.recommended ?? i.price,
        priceCents: i.price,
        overrideReason: i.override ?? null,
        estimatedCostCents: i.cost,
        sortOrder: idx,
      })),
    );
    await db.insert(s.jobStatusHistory).values({ tenantId: T, jobId: job!.id, fromStatus: null, toStatus: "approved", changedBy: U[j.sales ?? "alex"]!.id, changedAt: created });
    if (j.status !== "approved")
      await db.insert(s.jobStatusHistory).values({ tenantId: T, jobId: job!.id, fromStatus: "approved", toStatus: j.status, changedBy: U.jen!.id, changedAt: completedAt ?? at(Math.min(0, j.createdDay + 1), 14) });
    await db.insert(s.activityLogs).values({ tenantId: T, action: "job.created", entityType: "job", entityId: job!.id, jobId: job!.id, customerId: cust.id, actorId: U[j.sales ?? "alex"]!.id, summary: quoteId ? `Converted quote to job` : "Created job", createdAt: created });

    // Actual costs as expenses (materials + outside)
    const materialCost = Math.round(est * between(0.85, 1.2));
    if (done || ["production", "finishing", "quality_check", "ready_pickup", "scheduled_install", "scheduled_delivery"].includes(j.status)) {
      if (materialCost > 0) {
        const vendor = cat.group === "print" ? pick(["Veritiv", "Midwest Paper Supply"]) : cat.group === "wrap" ? "Fellers" : "Grimco";
        await db.insert(s.expenses).values({
          tenantId: T,
          vendorId: V[vendor]!.id,
          vendorName: vendor,
          amountCents: materialCost,
          category: cat.group === "print" ? "paper" : cat.group === "wrap" ? "vinyl" : "substrates",
          spentOn: dayOffset(Math.min(0, j.createdDay + 1)),
          jobId: job!.id,
          paymentMethod: "Account",
          notes: `Materials for ${j.title}`,
          createdBy: U.dana!.id,
        });
      }
      for (const x of j.extraCost ?? [])
        await db.insert(s.expenses).values({ tenantId: T, vendorId: V[x.vendor]?.id ?? null, vendorName: x.vendor, amountCents: x.amount, category: x.category, spentOn: dayOffset(Math.min(0, j.createdDay + 2)), jobId: job!.id, notes: x.notes ?? null, paymentMethod: "Card", createdBy: U.dana!.id });
    }

    // Invoice
    const inv = j.invoice ?? (done ? "paid" : "none");
    if (inv !== "none") {
      const issueDay = done ? (j.completedDay ?? j.dueDay ?? j.createdDay + 5) : Math.min(0, j.dueDay ?? 0);
      const td = termsDays[cust.terms] ?? 0;
      const dueDay = inv === "overdue" ? Math.min(issueDay + td, -12 - Math.floor(rand() * 40)) : issueDay + td;
      const total = subtotal + tax;
      const paid = inv === "paid" ? total : inv === "partial" ? Math.round(total / 2) : 0;
      const [invoice] = await db
        .insert(s.invoices)
        .values({
          tenantId: T,
          number: nextInvoiceNo(),
          customerId: cust.id,
          jobId: job!.id,
          status: inv === "paid" ? "paid" : inv === "partial" ? "partial" : "sent",
          issueDate: dayOffset(inv === "overdue" ? Math.min(issueDay, dueDay - td) : issueDay),
          dueDate: dayOffset(dueDay),
          poNumber: j.po ?? null,
          subtotalCents: subtotal,
          taxRate: cust.exempt ? 0 : TAX,
          taxCents: tax,
          totalCents: total,
          paidCents: paid,
          sentAt: at(Math.min(0, issueDay), 16),
          lastReminderAt: inv === "overdue" && rand() > 0.5 ? at(-5, 10) : null,
          createdBy: U.dana!.id,
          createdAt: at(Math.min(0, issueDay), 16),
        })
        .returning();
      await db.insert(s.invoiceItems).values(j.items.map((i, idx) => ({ tenantId: T, invoiceId: invoice!.id, description: i.desc, quantity: i.qty, amountCents: i.price, sortOrder: idx })));
      if (paid > 0) {
        const pDay = Math.min(0, j.paidDay ?? issueDay + Math.floor(rand() * Math.max(1, td)));
        await db.insert(s.payments).values({ tenantId: T, invoiceId: invoice!.id, customerId: cust.id, amountCents: paid, method: pick(["check", "card", "card", "ach", "cash"] as const), reference: rand() > 0.5 ? `#${1000 + Math.floor(rand() * 8999)}` : null, receivedOn: dayOffset(pDay), recordedBy: U.dana!.id, createdAt: at(pDay, 12) });
      }
    }
    jobIds[j.title] = { id: job!.id, number: job!.number };
    return job!;
  }

  // ---------- history: ~12 months of completed jobs ----------
  const historyTemplates: ((d: number) => JobSpec)[] = [
    (d) => {
      const [w, h] = pick([[48, 96], [48, 96], [36, 72], [36, 96], [24, 72], [60, 120]]);
      const sq = (w! * h!) / 144;
      const price = roundTo(sq * between(5.2, 6.4) + 15, 5);
      const c = pick(["ABC Plumbing", "Lake County Athletics", "Smith Manufacturing", "Munster Police Department", "Calumet Coffee Roasters", "Steel City Fitness", "Cedar Lake Marina", "Northwest Indiana Construction", "Hoosier Landscape Co."]);
      return { customer: c, title: `${c.split(" ")[0]} ${w! / 12}x${h! / 12} Outdoor Banner`, cat: "banners", status: "completed", createdDay: d, dueDay: d + 4, items: [{ cat: "banners", desc: `${w! / 12}' × ${h! / 12}' outdoor banner`, qty: 1, w, h, material: "13oz Scrim Vinyl", finishing: "Hem & grommets every 2'", price: price * 100, cost: Math.round(sq * 85 * 1.1 + 1000) }], needsProof: true, laborHours: 0.75 };
    },
    (d) => {
      const c = pick(["Munster Dental", "Pinewood Pediatrics", "Ridge Road Realty Group", "Lakeshore HVAC Services", "St. John Family Chiropractic", "ABC Plumbing", "Region Roofing & Siding"]);
      const qty = pick([250, 500, 500, 1000]);
      const price = { 250: 6000, 500: 7000, 1000: 8500 }[qty]!;
      return { customer: c, title: `${qty} Business Cards`, cat: "business-cards", status: "completed", createdDay: d, dueDay: d + 3, items: [{ cat: "business-cards", desc: `${qty} business cards, 14pt, double-sided`, qty, w: 3.5, h: 2, material: "14pt C2S Cover", finishing: "Double-sided", price, cost: Math.round(price * 0.32) }], needsProof: rand() > 0.5, laborHours: 0.3 };
    },
    (d) => {
      const c = pick(["Munster Dental", "Pinewood Pediatrics", "Smith Manufacturing", "Cedar Lake Marina", "Lake County Athletics"]);
      const qty = pick([500, 1000, 1000, 2500]);
      const price = { 500: 34500, 1000: 46500, 2500: 84500 }[qty]!;
      return { customer: c, title: `${qty} Tri-Fold Brochures`, cat: "brochures", status: "completed", createdDay: d, dueDay: d + 6, items: [{ cat: "brochures", desc: `${qty} tri-fold brochures, 8.5×11, 100# gloss text`, qty, w: 11, h: 8.5, material: "100# Gloss Text", finishing: "Tri-fold", price, cost: Math.round(price * 0.4) }], laborHours: 1.5 };
    },
    (d) => {
      const c = pick(["Ridge Road Realty Group", "Northwest Indiana Construction", "Hoosier Landscape Co.", "Lakeshore HVAC Services", "Region Roofing & Siding", "Lake County Athletics"]);
      const qty = pick([25, 50, 50, 100]);
      const price = qty * pick([1100, 1200, 1300]) + 2500;
      return { customer: c, title: `${qty} Yard Signs`, cat: "yard-signs", status: "completed", createdDay: d, dueDay: d + 5, items: [{ cat: "yard-signs", desc: `${qty} yard signs 18×24, double-sided, with H-stakes`, qty, w: 24, h: 18, material: "4mm Coroplast", finishing: "H-stakes", price, cost: qty * 420 }], laborHours: 1 };
    },
    (d) => {
      const c = pick(["Steel City Fitness", "Calumet Coffee Roasters", "Pinewood Pediatrics", "Munster Dental", "Lake County Athletics"]);
      const sq = pick([60, 90, 120, 160]);
      const price = roundTo(sq * between(11, 13.5) + 300, 25) * 100;
      return { customer: c, title: `${c.split(" ")[0]} Wall Graphics`, cat: "wall-graphics", status: "completed", createdDay: d, dueDay: d + 12, needsDesign: true, needsInstall: true, fulfillment: "install", items: [{ cat: "wall-graphics", desc: `Printed wall graphic ~${sq} sq ft, installed`, qty: 1, w: 120, h: Math.round((sq * 144) / 120), material: "Wall vinyl + matte laminate", price, cost: Math.round(sq * 250 * 1.15) }], laborHours: 6 };
    },
    (d) => {
      const c = pick(["ABC Plumbing", "Lakeshore HVAC Services", "Hoosier Landscape Co.", "Region Roofing & Siding", "Hammond Auto Body"]);
      const van = pick(["Ford Transit 148\" High Roof", "Ford Transit 130\" Mid Roof", "Chevy Express 2500", "Ram ProMaster 2500"]);
      const full = rand() > 0.45;
      const sq = full ? pick([270, 290, 300]) : pick([60, 80, 100]);
      const price = full ? roundTo(between(3900, 4800), 50) * 100 : roundTo(between(750, 1450), 25) * 100;
      return { customer: c, title: `${c.split(" ")[0]} ${van.split(" ").slice(0, 2).join(" ")} ${full ? "Full Wrap" : "Partial Graphics"}`, cat: full ? "vehicle-wraps" : "vehicle-graphics", status: "completed", createdDay: d, dueDay: d + 14, needsDesign: true, needsInstall: true, fulfillment: "install", items: [{ cat: full ? "vehicle-wraps" : "vehicle-graphics", desc: `${van} — ${full ? "full wrap" : "partial graphics"}, ~${sq} sq ft`, qty: 1, specs: van, material: "3M IJ180Cv3 + 8518 laminate", price, cost: Math.round(sq * 320 * 1.2) }], laborHours: full ? 14 : 5 };
    },
    (d) => {
      const c = pick(["Smith Manufacturing", "Northwest Indiana Construction", "Cedar Lake Marina", "Hammond Auto Body", "Munster Police Department"]);
      const [w, h] = pick([[24, 18], [24, 36], [48, 96], [36, 24], [96, 48]]);
      const qty = pick([1, 2, 4, 10]);
      const sq = (w! * h! * qty) / 144;
      const price = roundTo(sq * between(13, 16) + 50, 5) * 100;
      return { customer: c, title: `${qty} ${w! / 12 >= 4 ? "Site" : "Safety"} Sign${qty > 1 ? "s" : ""} ${w}x${h}`, cat: "signs", status: "completed", createdDay: d, dueDay: d + 7, items: [{ cat: "signs", desc: `${qty} × ${w}"×${h}" aluminum composite sign`, qty, w, h, material: "3mm Aluminum Composite (ACM)", finishing: "UV laminate, drilled holes", price, cost: Math.round(sq * 380 * 1.15) }], laborHours: 1.5 };
    },
    (d) => {
      const c = pick(["Calumet Coffee Roasters", "Steel City Fitness", "Lake County Athletics", "St. John Family Chiropractic"]);
      const qty = pick([250, 500, 1000]);
      const price = { 250: 15000, 500: 21000, 1000: 32500 }[qty]!;
      return { customer: c, title: `${qty} Logo Stickers`, cat: "labels-stickers", status: "completed", createdDay: d, dueDay: d + 5, items: [{ cat: "labels-stickers", desc: `${qty} 3" die-cut logo stickers`, qty, w: 3, h: 3, material: "White gloss vinyl", finishing: "Contour cut", price, cost: Math.round(price * 0.3) }], laborHours: 1 };
    },
    (d) => {
      const c = pick(["Munster Dental", "Smith Manufacturing", "Northwest Indiana Construction", "Pinewood Pediatrics"]);
      const qty = pick([500, 1000]);
      const price = qty === 500 ? 15000 : 23500;
      return { customer: c, title: `${qty} #10 Envelopes`, cat: "envelopes", status: "completed", createdDay: d, dueDay: d + 5, needsProof: false, items: [{ cat: "envelopes", desc: `${qty} #10 envelopes, 1-color return address`, qty, material: "24# White Wove", price, cost: Math.round(price * 0.38) }], laborHours: 0.5 };
    },
    (d) => {
      const c = pick(["Smith Manufacturing", "Hammond Auto Body", "Lakeshore HVAC Services", "Region Roofing & Siding"]);
      const qty = pick([250, 500, 1000]);
      const price = { 250: 18000, 500: 23000, 1000: 33000 }[qty]!;
      return { customer: c, title: `${qty} 3-Part NCR Work Orders`, cat: "forms", status: "completed", createdDay: d, dueDay: d + 7, needsProof: false, items: [{ cat: "forms", desc: `${qty} 3-part NCR work orders, numbered, padded in 50s`, qty, w: 8.5, h: 11, finishing: "Numbering, padding", price, cost: Math.round(price * 0.4) }], laborHours: 1 };
    },
    (d) => {
      const c = pick(["Ridge Road Realty Group", "Steel City Fitness", "Lake County Athletics", "Munster Police Department", "Cedar Lake Marina"]);
      const qty = pick([1, 2]);
      return { customer: c, title: `${qty} Retractable Banner Stand${qty > 1 ? "s" : ""}`, cat: "banner-stands", status: "completed", createdDay: d, dueDay: d + 6, items: [{ cat: "banner-stands", desc: `${qty} × 33"×81" retractable banner stand with print`, qty, w: 33, h: 81, price: qty * 24900, cost: qty * 9800 }], laborHours: 0.5 };
    },
    (d) => {
      const c = pick(["Calumet Coffee Roasters", "Steel City Fitness", "Lake County Athletics", "Hoosier Landscape Co.", "Cedar Lake Marina"]);
      const qty = pick([500, 1000, 2500]);
      const price = { 500: 12500, 1000: 18500, 2500: 36500 }[qty]!;
      return { customer: c, title: `${qty} Event Flyers`, cat: "flyers", status: "completed", createdDay: d, dueDay: d + 3, items: [{ cat: "flyers", desc: `${qty} flyers 8.5×11, full color one side`, qty, w: 8.5, h: 11, material: "100# Gloss Text", price, cost: Math.round(price * 0.38) }], laborHours: 0.5 };
    },
  ];
  const weights = [5, 5, 2, 3, 1, 2, 3, 2, 2, 1, 2, 2]; // banners & business cards are most common
  const bag: number[] = weights.flatMap((w, i) => Array(w).fill(i));
  let histCount = 0;
  for (let d = -365; d <= -8; d += 1) {
    if (new Date(Date.now() + d * 86400000).getUTCDay() === 0) continue; // closed Sundays
    const n = rand() > 0.5 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const spec = historyTemplates[pick(bag)]!(d);
      const doneDay = Math.min(-1, (spec.dueDay ?? d + 5) + Math.round(between(-2, 2)));
      const payLag = Math.floor(between(0, 25));
      await makeJob({ ...spec, completedDay: doneDay, paidDay: Math.min(-1, doneDay + payLag), sales: pick(["alex", "alex", "rick"]), invoice: doneDay > -40 && rand() > 0.93 ? "unpaid" : "paid" });
      histCount++;
    }
  }

  // Specific past jobs referenced in the owner's examples
  await makeJob({ customer: "ABC Plumbing", title: "ABC Plumbing 4x8 Banner", cat: "banners", status: "completed", createdDay: -200, dueDay: -196, completedDay: -196, items: [{ cat: "banners", desc: "4' × 8' outdoor banner", qty: 1, w: 48, h: 96, material: "13oz Scrim Vinyl", finishing: "Hem & grommets every 2'", price: 18500, cost: 3900 }] });
  await makeJob({ customer: "Northwest Indiana Construction", title: "NWI Construction 4x8 Site Banner", cat: "banners", status: "completed", createdDay: -60, dueDay: -55, completedDay: -56, po: "PO-88412", items: [{ cat: "banners", desc: "4' × 8' outdoor banner", qty: 1, w: 48, h: 96, material: "13oz Scrim Vinyl", finishing: "Hem & grommets every 2'", price: 19500, cost: 3900 }] });
  const abcWrapOld = await makeJob({ customer: "ABC Plumbing", title: "ABC Plumbing Ford Transit Wrap (Van #4)", cat: "vehicle-wraps", status: "completed", createdDay: -150, dueDay: -136, completedDay: -137, needsDesign: true, needsInstall: true, fulfillment: "install", items: [{ cat: "vehicle-wraps", desc: "Ford Transit 148\" High Roof — full wrap, ~290 sq ft", qty: 1, specs: "2023 Ford Transit 250 148\" HR, white", material: "3M IJ180Cv3 + 8518 laminate", price: 445000, recommended: 466000, override: "Fleet pricing — 4th van", cost: 112000 }], laborHours: 14 });
  const dentalCards = await makeJob({ customer: "Munster Dental", title: "500 Business Cards — Karen Lutz", cat: "business-cards", status: "completed", createdDay: -40, dueDay: -37, completedDay: -37, needsProof: false, items: [{ cat: "business-cards", desc: "500 business cards, 14pt, double-sided", qty: 500, w: 3.5, h: 2, material: "14pt C2S Cover", finishing: "Double-sided", price: 7000, cost: 2200 }] });

  // ---------- current work (the demo "today") ----------
  const cur: JobSpec[] = [
    { customer: "ABC Plumbing", title: "ABC Plumbing Ford Transit Wrap", cat: "vehicle-wraps", status: "design", priority: "normal", createdDay: -6, dueDay: workday(9), needsDesign: true, needsInstall: true, fulfillment: "install", fulfillmentAt: at(workday(9), 8), siteAddress: "Miss Print Hammond install bay", designer: "sarah", installer: "tony", description: "Van #5 — match fleet design from MP job for Van #4. New phone number on rear doors.", internal: "Customer wants to see it on the van template before we print. Drop-off Monday 8am.", items: [{ cat: "vehicle-wraps", desc: "Ford Transit 148\" High Roof — full wrap, ~290 sq ft", qty: 1, specs: "2025 Ford Transit 250 148\" HR, white", material: "3M IJ180Cv3 + 8518 laminate", price: 445000, recommended: 466000, override: "Fleet pricing — matches Van #4", cost: 112000 }], invoice: "none", sales: "alex" },
    { customer: "Munster Dental", title: "500 Tri-Fold Brochures", cat: "brochures", status: "waiting_approval", createdDay: -4, dueDay: workday(3), designer: "sarah", items: [{ cat: "brochures", desc: "500 tri-fold brochures, 8.5×11, 100# gloss text", qty: 500, w: 11, h: 8.5, material: "100# Gloss Text", finishing: "Tri-fold", price: 34500, cost: 13000 }], needsDesign: true },
    { customer: "Northwest Indiana Construction", title: "4x8 Outdoor Banner — Munster Library Project", cat: "banners", status: "production", priority: "rush", createdDay: -2, dueDay: 0, production: "mike", po: "PO-88731", items: [{ cat: "banners", desc: "4' × 8' outdoor banner", qty: 1, w: 48, h: 96, material: "13oz Scrim Vinyl", finishing: "Hem & grommets every 2'", price: 23500, recommended: 23500, cost: 3900 }], internal: "Rush — needs to be on site today by 4pm. Dave will pick up." },
    { customer: "Smith Manufacturing", title: "Exterior Building Sign", cat: "signs", status: "approved_for_production", createdDay: -12, dueDay: workday(6), needsInstall: true, fulfillment: "install", fulfillmentAt: at(workday(6), 9), siteAddress: "4500 Kennedy Ave, Hammond, IN 46323", installer: "tony", po: "SM-2026-0412", items: [{ cat: "signs", desc: "4' × 12' ACM building sign, UV laminate, with standoffs", qty: 1, w: 144, h: 48, material: "3mm Aluminum Composite (ACM)", finishing: "UV laminate, standoffs", price: 185000, recommended: 172500, override: "Includes lift rental", cost: 52000 }, { cat: "signs", desc: "Installation (2 installers, lift)", qty: 1, price: 65000, cost: 30000 }], extraCost: [{ vendor: "Sunbelt Rentals", amount: 28500, category: "installation", notes: "Scissor lift rental" }] },
    { customer: "Munster Dental", title: "1,000 Business Cards — Dr. Shah", cat: "business-cards", status: "ready_pickup", createdDay: -3, dueDay: 0, needsProof: false, items: [{ cat: "business-cards", desc: "1,000 business cards, 14pt, double-sided, soft-touch", qty: 1000, w: 3.5, h: 2, material: "14pt C2S Cover", finishing: "Double-sided, soft-touch", price: 12000, cost: 3800 }], invoice: "unpaid" },
    { customer: "Lake County Athletics", title: "Gym Wall Graphics", cat: "wall-graphics", status: "proof_ready", createdDay: -9, dueDay: workday(12), needsDesign: true, needsInstall: true, fulfillment: "install", siteAddress: "300 Sports Complex Dr, Crown Point, IN", designer: "sarah", installer: "tony", items: [{ cat: "wall-graphics", desc: "Printed wall mural ~160 sq ft (2 walls), matte laminate, installed", qty: 1, w: 240, h: 96, material: "Wall vinyl + matte laminate", price: 238000, cost: 46000 }] },
    { customer: "Ridge Road Realty Group", title: "50 Yard Signs — Fall Open House", cat: "yard-signs", status: "production", createdDay: -3, dueDay: 1, production: "mike", needsProof: false, items: [{ cat: "yard-signs", desc: "50 yard signs 18×24, double-sided, with H-stakes", qty: 50, w: 24, h: 18, material: "4mm Coroplast", finishing: "H-stakes, double-sided", price: 77500, cost: 21000 }] },
    { customer: "Calumet Coffee Roasters", title: "Menu Board Panels", cat: "signs", status: "waiting_artwork", createdDay: -5, dueDay: workday(8), needsProof: true, items: [{ cat: "signs", desc: "3 menu panels 24×36 PVC, full color", qty: 3, w: 24, h: 36, material: "3mm PVC", price: 36000, cost: 5500 }], internal: "Jess is sending final prices for the menu by Friday." },
    { customer: "Munster Police Department", title: "Patrol Vehicle Decals (Set of 4)", cat: "decals", status: "scheduled_install", createdDay: -14, dueDay: 0, needsInstall: true, fulfillment: "install", fulfillmentAt: at(0, 13, 30), siteAddress: "1001 Ridge Rd, Munster (fleet garage)", installer: "tony", po: "MPD-26-118", items: [{ cat: "decals", desc: "Reflective door decals + rear chevrons, 4 vehicles", qty: 4, material: "3M reflective", price: 128000, cost: 36000 }] },
    { customer: "Pinewood Pediatrics", title: "Waiting Room Posters", cat: "posters", status: "quality_check", createdDay: -4, dueDay: 1, items: [{ cat: "posters", desc: "6 posters 24×36, mounted to foam board", qty: 6, w: 24, h: 36, finishing: "Mount to foam board", price: 51000, cost: 9500 }] },
    { customer: "Steel City Fitness", title: "Window Perf & Decals", cat: "decals", status: "design", createdDay: -2, dueDay: workday(5), needsDesign: true, designer: "sarah", items: [{ cat: "decals", desc: "Storefront window perf (3 panes) + hours decal", qty: 1, w: 180, h: 72, material: "Window perf 50/50", price: 112000, cost: 21000 }] },
    { customer: "Lakeshore HVAC Services", title: "Chevy Express Partial Graphics", cat: "vehicle-graphics", status: "scheduled_install", createdDay: -10, dueDay: 1, needsDesign: true, needsInstall: true, fulfillment: "install", fulfillmentAt: at(1, 10), siteAddress: "Miss Print Hammond install bay", installer: "tony", items: [{ cat: "vehicle-graphics", desc: "Chevy Express 2500 — doors, rear, logo & phone, ~80 sq ft", qty: 1, material: "3M IJ180Cv3 + 8518 laminate", price: 125000, cost: 29000 }] },
    { customer: "Smith Manufacturing", title: "1,000 3-Part NCR Work Orders", cat: "forms", status: "finishing", createdDay: -5, dueDay: 2, needsProof: false, production: "luis", po: "SM-2026-0433", items: [{ cat: "forms", desc: "1,000 3-part NCR work orders, numbered 24001–25000, padded in 50s", qty: 1000, w: 8.5, h: 11, finishing: "Numbering, padding", price: 33000, cost: 13000 }] },
    { customer: "Cedar Lake Marina", title: "Dock Rules Signs", cat: "signs", status: "approved", createdDay: -1, dueDay: workday(10), items: [{ cat: "signs", desc: "8 dock signs 18×24 ACM", qty: 8, w: 18, h: 24, material: "3mm Aluminum Composite (ACM)", price: 52000, cost: 13500 }] },
    { customer: "Hoosier Landscape Co.", title: "Truck Door Magnets", cat: "vehicle-graphics", status: "on_hold", createdDay: -8, dueDay: workday(4), items: [{ cat: "vehicle-graphics", desc: "Pair of 12×24 vehicle magnets", qty: 2, w: 24, h: 12, price: 9500, cost: 2500 }], internal: "On hold — Jake is changing the company logo." },
    { customer: "Karen Mitchell", title: "Graduation Banner", cat: "banners", status: "ready_pickup", createdDay: -6, dueDay: -1, needsProof: true, items: [{ cat: "banners", desc: "3' × 6' indoor banner", qty: 1, w: 36, h: 72, material: "13oz Scrim Vinyl", finishing: "Hem & grommets", price: 11500, cost: 2200 }], invoice: "paid", paidDay: -6 },
    { customer: "St. John Family Chiropractic", title: "New Patient Folders", cat: "folders", status: "production", createdDay: -7, dueDay: -1, production: "luis", items: [{ cat: "folders", desc: "250 presentation folders, 1 pocket, business-card slit", qty: 250, w: 9, h: 12, price: 49500, cost: 23000 }], internal: "Running behind — die cutter was down Tuesday." },
    { customer: "Munster Dental", title: "Repeat: 500 Business Cards — Karen Lutz", cat: "business-cards", status: "approved_for_production", createdDay: 0, dueDay: 2, needsProof: false, items: [{ cat: "business-cards", desc: "500 business cards, 14pt, double-sided", qty: 500, w: 3.5, h: 2, material: "14pt C2S Cover", finishing: "Double-sided", price: 7000, cost: 2200 }] },
    { customer: "Region Roofing & Siding", title: "Jobsite Banners (x3)", cat: "banners", status: "new", createdDay: 0, dueDay: workday(6), items: [{ cat: "banners", desc: "3 × 3' × 6' mesh banners", qty: 3, w: 36, h: 72, material: "8oz Mesh Banner", finishing: "Hem & grommets", price: 34500, cost: 6800 }] },
    { customer: "Hammond Auto Body", title: "Shop Hours Window Decal", cat: "decals", status: "completed", createdDay: -8, dueDay: -3, completedDay: -3, items: [{ cat: "decals", desc: "Cut vinyl hours decal, 24×18", qty: 1, w: 24, h: 18, material: "Oracal 651 Cut Vinyl", price: 6500, cost: 900 }], invoice: "unpaid" },
    { customer: "Lake County Athletics", title: "Fall Tournament Banners", cat: "banners", status: "completed", createdDay: -20, dueDay: -12, completedDay: -12, items: [{ cat: "banners", desc: "6 × 3' × 8' sponsor banners", qty: 6, w: 36, h: 96, material: "13oz Scrim Vinyl", finishing: "Hem & grommets", price: 69000, cost: 14500 }], invoice: "overdue" },
    { customer: "Northwest Indiana Construction", title: "Project Site Signs — Dyer Commons", cat: "signs", status: "completed", createdDay: -70, dueDay: -60, completedDay: -61, po: "PO-88120", items: [{ cat: "signs", desc: "2 × 4'×8' site signs, ACM, with posts", qty: 2, w: 96, h: 48, material: "3mm Aluminum Composite (ACM)", price: 138000, cost: 34000 }], invoice: "overdue" },
    { customer: "Smith Manufacturing", title: "Trade Show Backdrop", cat: "banner-stands", status: "completed", createdDay: -50, dueDay: -38, completedDay: -38, po: "SM-2026-0356", items: [{ cat: "banner-stands", desc: "10' fabric backdrop with frame + 2 banner stands", qty: 1, price: 164500, cost: 72000 }], invoice: "partial" },
    { customer: "Region Roofing & Siding", title: "Ford F-150 Tailgate Graphics", cat: "vehicle-graphics", status: "completed", createdDay: -100, dueDay: -93, completedDay: -93, needsInstall: true, fulfillment: "install", items: [{ cat: "vehicle-graphics", desc: "Tailgate + door logos", qty: 1, price: 68000, cost: 21000 }], invoice: "overdue" },
  ];
  for (const j of cur) await makeJob(j);

  // Artwork on file for current jobs that are past the artwork stage (placeholder files).
  const artKeys: string[] = [];
  for (const j of cur) {
    if (["new", "waiting_artwork", "approved", "completed"].includes(j.status)) continue;
    const { id, number } = jobIds[j.title]!;
    const key = `seed/artwork-${number}.svg`;
    artKeys.push(key);
    await db.insert(s.files).values({ tenantId: T, jobId: id, customerId: CU[j.customer]!.id, folder: ["production", "finishing", "quality_check", "approved_for_production"].includes(j.status) ? "production" : "original_artwork", filename: `${j.customer.split(" ")[0]} artwork — MP-${number}.svg`, storageKey: key, mimeType: "image/svg+xml", sizeBytes: 1800, preflightStatus: "looks_good", preflight: { notes: ["Print-ready format."] }, uploadedBy: U.alex!.id, createdAt: at(j.createdDay, 12) });
  }

  // Job number lookups for messages/tasks
  const J = (title: string) => jobIds[title]!;

  // ---------- open quotes ----------
  const mkQuote = async (o: { customer: string; title: string; status: s.QuoteStatus; createdDay: number; sentDay?: number; items: ItemSpec[]; needsDesign?: boolean; needsInstall?: boolean; isRush?: boolean; sales?: string; lostReason?: string; internal?: string }) => {
    const cust = CU[o.customer]!;
    const subtotal = o.items.reduce((a, i) => a + i.price, 0);
    const tax = cust.exempt ? 0 : Math.round(subtotal * TAX);
    const [q] = await db
      .insert(s.quotes)
      .values({
        tenantId: T,
        number: nextQuoteNo(),
        customerId: cust.id,
        contactId: cust.contactId,
        title: o.title,
        status: o.status,
        salespersonId: U[o.sales ?? "alex"]!.id,
        locationId: munster!.id,
        needsDesign: o.needsDesign ?? false,
        needsInstall: o.needsInstall ?? false,
        isRush: o.isRush ?? false,
        validUntil: dayOffset(o.createdDay + 30),
        subtotalCents: subtotal,
        taxRate: cust.exempt ? 0 : TAX,
        taxCents: tax,
        totalCents: subtotal + tax,
        estimatedCostCents: o.items.reduce((a, i) => a + i.cost, 0),
        sentAt: o.sentDay != null ? at(o.sentDay, 11) : null,
        respondedAt: ["accepted", "declined"].includes(o.status) ? at(Math.min(0, (o.sentDay ?? o.createdDay) + 3), 10) : null,
        lostReason: o.lostReason ?? null,
        internalNotes: o.internal ?? null,
        createdBy: U[o.sales ?? "alex"]!.id,
        createdAt: at(o.createdDay, 10),
        updatedAt: at(o.sentDay ?? o.createdDay, 11),
      })
      .returning();
    await db.insert(s.quoteItems).values(o.items.map((i, idx) => ({ tenantId: T, quoteId: q!.id, categoryId: C[i.cat]!.id, description: i.desc, quantity: i.qty, widthIn: i.w ?? null, heightIn: i.h ?? null, material: i.material ?? null, finishing: i.finishing ?? null, specs: i.specs ?? null, recommendedCents: i.recommended ?? i.price, priceCents: i.price, overrideReason: i.override ?? null, estimatedCostCents: i.cost, sortOrder: idx })));
    await db.insert(s.activityLogs).values({ tenantId: T, action: "quote.created", entityType: "quote", entityId: q!.id, quoteId: q!.id, customerId: cust.id, actorId: U[o.sales ?? "alex"]!.id, summary: "Created quote", createdAt: at(o.createdDay, 10) });
    if (o.sentDay != null) await db.insert(s.activityLogs).values({ tenantId: T, action: "quote.sent", entityType: "quote", entityId: q!.id, quoteId: q!.id, customerId: cust.id, actorId: U[o.sales ?? "alex"]!.id, summary: "Sent quote to customer", createdAt: at(o.sentDay, 11) });
    return q!;
  };
  await mkQuote({ customer: "Lakeshore HVAC Services", title: "Ford Transit Full Wrap (2 vans)", status: "sent", createdDay: -10, sentDay: -9, sales: "rick", needsDesign: true, needsInstall: true, items: [{ cat: "vehicle-wraps", desc: "Ford Transit 148\" High Roof — full wrap, ~290 sq ft", qty: 2, material: "3M IJ180Cv3 + 8518 laminate", price: 880000, recommended: 932000, override: "2-van discount", cost: 224000 }] });
  await mkQuote({ customer: "Cedar Lake Marina", title: "Backlit Entrance Sign", status: "sent", createdDay: -16, sentDay: -15, sales: "rick", needsInstall: true, items: [{ cat: "backlit-signs", desc: "4'×6' double-sided LED cabinet sign with printed faces", qty: 1, w: 72, h: 48, price: 685000, cost: 395000 }], internal: "Cabinet from outside vendor ~ $3,400. Nancy wants it before Memorial Day." });
  await mkQuote({ customer: "Steel City Fitness", title: "2,500 Membership Postcards (EDDM)", status: "sent", createdDay: -4, sentDay: -3, items: [{ cat: "postcards-mailers", desc: "2,500 6×11 EDDM postcards, full color both sides, bundled", qty: 2500, w: 11, h: 6, price: 58000, cost: 21000 }] });
  await mkQuote({ customer: "Pinewood Pediatrics", title: "Exam Room Wall Decals", status: "sent", createdDay: -8, sentDay: -8, needsDesign: true, needsInstall: true, items: [{ cat: "wall-graphics", desc: "6 exam rooms — jungle theme decals, ~20 sq ft each", qty: 1, w: 120, h: 144, price: 214000, cost: 42000 }] });
  await mkQuote({ customer: "Munster Police Department", title: "National Night Out Banners", status: "draft", createdDay: -1, sales: "rick", items: [{ cat: "banners", desc: "4 × 3' × 8' outdoor banners", qty: 4, w: 36, h: 96, material: "13oz Scrim Vinyl", finishing: "Hem & grommets", price: 58000, cost: 11200 }] });
  await mkQuote({ customer: "Hammond Auto Body", title: "Pylon Sign Face Replacement", status: "sent", createdDay: -2, sentDay: -1, sales: "rick", needsInstall: true, items: [{ cat: "signs", desc: "Replace 2 pylon faces 5'×8', polycarbonate, printed", qty: 2, w: 96, h: 60, price: 196000, cost: 72000 }] });
  await mkQuote({ customer: "Calumet Coffee Roasters", title: "1,000 Cup Sleeves Stickers", status: "accepted", createdDay: -3, sentDay: -3, items: [{ cat: "labels-stickers", desc: "1,000 2\" round logo stickers", qty: 1000, w: 2, h: 2, material: "White gloss vinyl", price: 32500, cost: 10500 }] });
  await mkQuote({ customer: "St. John Family Chiropractic", title: "Monument Sign", status: "declined", createdDay: -40, sentDay: -39, needsInstall: true, lostReason: "Went with a cheaper out-of-town shop", items: [{ cat: "signs", desc: "Double-sided monument sign panels", qty: 1, price: 420000, cost: 190000 }] });
  await mkQuote({ customer: "Ridge Road Realty Group", title: "Agent Riders (x20)", status: "accepted", createdDay: -30, sentDay: -30, items: [{ cat: "yard-signs", desc: "20 name riders 6×24", qty: 20, w: 24, h: 6, price: 30000, cost: 5500 }] });
  // Older quotes for win-rate history
  for (let d = -330; d < -12; d += 4) {
    const won = rand() > 0.55;
    const tpl = historyTemplates[pick(bag)]!(d);
    await mkQuote({ customer: tpl.customer, title: tpl.title, status: won ? "converted" : pick(["declined", "expired", "declined"] as const), createdDay: d, sentDay: d, items: tpl.items, lostReason: won ? undefined : pick(["Price", "Timing — didn't need it after all", "Went with online printer", undefined]) });
  }

  // ---------- messages ----------
  const msg = async (jobTitle: string | null, author: string, body: string, minsAgo: number, extra: { channel?: string; important?: boolean } = {}) => {
    const [m] = await db
      .insert(s.messages)
      .values({ tenantId: T, jobId: jobTitle ? J(jobTitle).id : null, channel: extra.channel ?? null, authorId: U[author]!.id, body, important: extra.important ?? false, createdAt: new Date(Date.now() - minsAgo * 60000) })
      .returning();
    for (const h of [...body.matchAll(/@(\w+)/g)].map((x) => x[1]!.toLowerCase())) {
      if (U[h]) {
        await db.insert(s.mentions).values({ messageId: m!.id, userId: U[h]!.id }).onConflictDoNothing();
      }
    }
    return m!;
  };
  await msg("ABC Plumbing Ford Transit Wrap", "alex", "Tom called — new phone number goes on the rear doors: 219-555-0142. Everything else matches Van #4.", 60 * 26);
  await msg("ABC Plumbing Ford Transit Wrap", "sarah", "Got it. I pulled the Van #4 working files. @alex can you confirm they still want the QR code on the side?", 60 * 5);
  await msg("ABC Plumbing Ford Transit Wrap", "alex", "@sarah yes, keep the QR code. Tom will drop the van off Monday 8am in Hammond.", 60 * 2);
  await msg("4x8 Outdoor Banner — Munster Library Project", "jen", "@mike this is a RUSH — Dave needs it on site by 4 today. Please run it first thing.", 60 * 3, { important: true });
  await msg("4x8 Outdoor Banner — Munster Library Project", "mike", "On the printer now. Will be hemmed by 1:30.", 45);
  await msg("500 Tri-Fold Brochures", "sarah", "Proof V2 sent to Karen with the updated hours. Waiting on approval.", 60 * 20);
  await msg("Exterior Building Sign", "rick", "Lift is booked for Thursday. @tony plan on two guys — the wall is brick, bring the masonry anchors.", 60 * 30);
  await msg("Exterior Building Sign", "tony", "Will do. I'll check the site Wednesday afternoon.", 60 * 28);
  await msg("New Patient Folders", "luis", "Die cutter is fixed. Folders will be done tomorrow morning, sorry for the delay.", 60 * 6);
  await msg("New Patient Folders", "jen", "@alex please call Dr. Carter's office and let them know — they're a day late.", 60 * 5);
  await msg("Menu Board Panels", "alex", "Still waiting on the final menu from Jess. Reminder sent.", 60 * 24 * 2);
  await msg(null, "rick", "Reminder: we're closed Saturday for the Hammond shop inventory count. Munster counter open as usual.", 60 * 24, { channel: "general", important: true });
  await msg(null, "jen", "New roll of 54\" 13oz arrived in Hammond. Old roll is almost out.", 60 * 8, { channel: "production" });
  await msg(null, "sarah", "I updated the vehicle wrap checklist in Knowledge — please read before the next drop-off.", 60 * 30, { channel: "design" });
  await msg(null, "alex", "Walk-in asked about same-day 24×36 posters. Told them tomorrow noon — OK?", 90, { channel: "front_counter" });

  // ---------- tasks ----------
  await db.insert(s.tasks).values([
    { tenantId: T, title: "Call Jess about final menu prices", jobId: J("Menu Board Panels").id, customerId: CU["Calumet Coffee Roasters"]!.id, assignedTo: U.alex!.id, dueDate: dayOffset(0), createdBy: U.jen!.id },
    { tenantId: T, title: "Confirm van drop-off time with Tom", jobId: J("ABC Plumbing Ford Transit Wrap").id, customerId: CU["ABC Plumbing"]!.id, assignedTo: U.alex!.id, dueDate: dayOffset(1), createdBy: U.sarah!.id },
    { tenantId: T, title: "Site check — measure wall & check power", jobId: J("Exterior Building Sign").id, assignedTo: U.tony!.id, dueDate: dayOffset(workday(4)), createdBy: U.rick!.id },
    { tenantId: T, title: "Follow up on Cedar Lake backlit sign quote", customerId: CU["Cedar Lake Marina"]!.id, assignedTo: U.rick!.id, dueDate: dayOffset(0), createdBy: U.rick!.id },
    { tenantId: T, title: "Call Lake County Athletics about overdue invoice", customerId: CU["Lake County Athletics"]!.id, assignedTo: U.dana!.id, dueDate: dayOffset(-1), createdBy: U.rick!.id },
    { tenantId: T, title: "Order more 13oz banner vinyl (54\")", assignedTo: U.mike!.id, dueDate: dayOffset(2), createdBy: U.jen!.id },
    { tenantId: T, title: "Update wrap template for 2025 Transit", jobId: J("ABC Plumbing Ford Transit Wrap").id, assignedTo: U.sarah!.id, dueDate: dayOffset(1), createdBy: U.sarah!.id },
    { tenantId: T, title: "Send W-9 to Smith Manufacturing purchasing", customerId: CU["Smith Manufacturing"]!.id, assignedTo: U.dana!.id, dueDate: dayOffset(-3), completedAt: at(-3, 15), completedBy: U.dana!.id, createdBy: U.rick!.id },
  ]);

  // ---------- calendar events ----------
  await db.insert(s.calendarEvents).values([
    { tenantId: T, title: "ABC Plumbing van drop-off (Hammond)", type: "other", startsAt: at(workday(3), 8), endsAt: at(workday(3), 8, 30), jobId: J("ABC Plumbing Ford Transit Wrap").id, locationId: hammond!.id, createdBy: U.alex!.id },
    { tenantId: T, title: "Grimco delivery", type: "delivery", startsAt: at(1, 10), endsAt: at(1, 11), locationId: hammond!.id, createdBy: U.mike!.id },
    { tenantId: T, title: "Hammond shop inventory count", type: "reminder", startsAt: at(workday(8), 9), endsAt: at(workday(8), 12), locationId: hammond!.id, createdBy: U.rick!.id },
    { tenantId: T, title: "Konica service visit", type: "reminder", startsAt: at(2, 14), endsAt: at(2, 15), locationId: munster!.id, createdBy: U.jen!.id },
    { tenantId: T, title: "Munster Chamber lunch", type: "other", startsAt: at(workday(5), 12), endsAt: at(workday(5), 13), userId: U.rick!.id, createdBy: U.rick!.id },
  ]);

  // ---------- notifications ----------
  await db.insert(s.notifications).values([
    { tenantId: T, userId: U.rick!.id, kind: "quote", title: "Calumet Coffee Roasters accepted a quote", body: "1,000 Cup Sleeves Stickers — convert it to a job.", link: "/quotes", actorId: null, createdAt: new Date(Date.now() - 3 * 3600000) },
    { tenantId: T, userId: U.rick!.id, kind: "invoice", title: "2 invoices are more than 30 days overdue", body: "Northwest Indiana Construction, Region Roofing & Siding", link: "/money?tab=receivables", createdAt: new Date(Date.now() - 20 * 3600000) },
    { tenantId: T, userId: U.mike!.id, kind: "mention", title: "Jen mentioned you on MP-" + J("4x8 Outdoor Banner — Munster Library Project").number, body: "@mike this is a RUSH — Dave needs it on site by 4 today.", link: `/jobs/${J("4x8 Outdoor Banner — Munster Library Project").number}`, actorId: U.jen!.id, createdAt: new Date(Date.now() - 3 * 3600000) },
    { tenantId: T, userId: U.sarah!.id, kind: "mention", title: "Alex mentioned you on MP-" + J("ABC Plumbing Ford Transit Wrap").number, body: "@sarah yes, keep the QR code.", link: `/jobs/${J("ABC Plumbing Ford Transit Wrap").number}`, actorId: U.alex!.id, createdAt: new Date(Date.now() - 2 * 3600000) },
    { tenantId: T, userId: U.alex!.id, kind: "mention", title: "Jen mentioned you on MP-" + J("New Patient Folders").number, body: "@alex please call Dr. Carter's office…", link: `/jobs/${J("New Patient Folders").number}`, actorId: U.jen!.id, createdAt: new Date(Date.now() - 5 * 3600000) },
  ]);

  // ---------- general expenses (non-job) ----------
  for (let m = 0; m < 12; m++) {
    const d = -m * 30 - 3;
    await db.insert(s.expenses).values([
      { tenantId: T, vendorName: "Ink & Toner Direct", vendorId: V["Ink & Toner Direct"]!.id, amountCents: roundTo(between(900, 1600), 5) * 100, category: "ink_toner", spentOn: dayOffset(d), paymentMethod: "Account", createdBy: U.dana!.id },
      { tenantId: T, vendorName: "NIPSCO", amountCents: roundTo(between(600, 950), 5) * 100, category: "office", spentOn: dayOffset(d - 5), paymentMethod: "ACH", notes: "Electric — both locations", createdBy: U.dana!.id },
      { tenantId: T, vendorName: "Speedway", amountCents: roundTo(between(250, 420), 5) * 100, category: "vehicle", spentOn: dayOffset(d - 10), paymentMethod: "Card", notes: "Fuel — install van", createdBy: U.dana!.id },
    ]);
    if (m % 3 === 0) await db.insert(s.expenses).values({ tenantId: T, vendorName: "Konica Minolta", amountCents: 64500, category: "equipment", spentOn: dayOffset(d - 12), paymentMethod: "ACH", notes: "Press lease / service", createdBy: U.dana!.id });
  }

  // ---------- proofs (versioned) for jobs in proof stages ----------
  const fakeProof = async (jobTitle: string, version: number, status: "sent" | "approved" | "changes_requested" | "superseded" | "draft", note?: string, comment?: string) => {
    const j = J(jobTitle);
    const key = `seed/proof-${j.number}-v${version}.svg`;
    const [f] = await db
      .insert(s.files)
      .values({ tenantId: T, jobId: j.id, folder: "proof", filename: `Proof V${version} — MP-${j.number}.svg`, storageKey: key, mimeType: "image/svg+xml", sizeBytes: 2048, preflightStatus: "looks_good", uploadedBy: U.sarah!.id, createdAt: at(-5 + version, 11) })
      .returning();
    await db.insert(s.proofs).values({ tenantId: T, jobId: j.id, version, fileId: f!.id, status, note: note ?? null, sentAt: status !== "draft" ? at(-5 + version, 12) : null, sentTo: status !== "draft" ? "customer" : null, sentBy: U.sarah!.id, respondedAt: status === "changes_requested" || status === "superseded" ? at(-4 + version, 9) : null, customerComment: comment ?? null, responderName: comment ? "Karen Lutz" : null, createdBy: U.sarah!.id, createdAt: at(-5 + version, 11) });
    return key;
  };
  const proofKeys = [
    await fakeProof("500 Tri-Fold Brochures", 1, "superseded", "First layout", "Please change Saturday hours to 8–12 and use the new logo."),
    await fakeProof("500 Tri-Fold Brochures", 2, "sent", "Updated hours and logo"),
    await fakeProof("Gym Wall Graphics", 1, "draft", "Mural concept A"),
  ];

  // write placeholder proof SVGs into storage so previews work
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage");
  for (const key of artKeys) {
    const p = path.join(root, key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#1a8fe3"/><text x="600" y="320" text-anchor="middle" font-family="Arial" font-size="64" font-weight="700" fill="#fff">ARTWORK · ${path.basename(key, ".svg").replace("artwork-", "MP-")}</text></svg>`);
  }
  for (const key of proofKeys) {
    const p = path.join(root, key);
    await mkdir(path.dirname(p), { recursive: true });
    const label = path.basename(key, ".svg").replace("proof-", "MP-").replace("-v", " · Proof V");
    await writeFile(p, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 1100"><rect width="850" height="1100" fill="#f8fafc"/><rect x="40" y="40" width="770" height="1020" fill="#fff" stroke="#cbd5e1" stroke-width="4" stroke-dasharray="12 8"/><text x="425" y="480" text-anchor="middle" font-family="Arial" font-size="56" font-weight="700" fill="#1a8fe3">PROOF</text><text x="425" y="560" text-anchor="middle" font-family="Arial" font-size="32" fill="#334155">${label}</text><text x="425" y="1020" text-anchor="middle" font-family="Arial" font-size="20" fill="#94a3b8">Demo placeholder — upload a real proof PDF or image</text></svg>`);
  }

  // ---------- knowledge ----------
  await db.insert(s.knowledgeArticles).values([
    { tenantId: T, title: "How we price banners", category: "Pricing", body: "13oz scrim is our standard outdoor banner.\n\n- Base: $5.50 / sq ft (full color)\n- Hem & grommets every 2 ft included on outdoor banners ($0.50 / linear ft)\n- Pole pockets: $1.50 / linear ft\n- Minimum charge $25\n- Rush (same day): +25%\n\nA 4×8 usually lands between $185 and $210. Check Similar Past Jobs on the quote screen before quoting.", updatedBy: U.rick!.id },
    { tenantId: T, title: "Vehicle wrap checklist", category: "Production", body: "Before the vehicle arrives:\n1. Confirm year / make / model / roof height / wheelbase\n2. Get approved proof signed (panel-by-panel)\n3. Print & laminate 24 hrs before install (outgas)\n\nAt drop-off:\n- Walk-around photos (all 4 sides + roof)\n- Note existing damage / paint issues\n- Wash & clay bar, IPA wipe\n\nAfter install:\n- Post-heat all recessed areas\n- After photos\n- Customer care sheet (no pressure wash 2 weeks)", updatedBy: U.sarah!.id },
    { tenantId: T, title: "File requirements for customers", category: "Customer Service", body: "- Preferred: print-ready PDF with 1/8\" bleed, fonts outlined\n- Images: 300 dpi at final size for print; 100–150 dpi at final size for large format\n- Vector logos (AI, EPS, SVG, PDF) for signs & vinyl cutting\n- CMYK for print; we'll convert RGB but colors may shift\n- Word / Publisher files usually need to be rebuilt (design time)", updatedBy: U.sarah!.id },
    { tenantId: T, title: "Important phone numbers", category: "Contacts", body: "- Grimco (Hammond account): 800-542-9941\n- Konica service: see sticker on press\n- Sunbelt Rentals (lifts): ask Rick for account #\n- NIPSCO outage: 800-464-7726", updatedBy: U.jen!.id },
    { tenantId: T, title: "Munster vs Hammond — what goes where", category: "Operations", body: "**Munster** (front counter): customer intake, quotes, business cards, brochures, flyers, envelopes, forms, letterhead, digital & offset printing.\n\n**Hammond** (production): banners, signs, large format, wall graphics, decals, vehicle graphics & wraps, installations.\n\nWhen a Munster job needs Hammond production, set the job's location to Hammond when it's Approved for Production. The job page shows which location owns the next step.", updatedBy: U.rick!.id },
  ]);

  await syncCounters(T);
  console.log(`✓ Seeded ${us.length} users, ${custRows.length} customers, ${histCount + cur.length + 4} jobs.`);

  // ---------- second demo shop ----------
  console.log("Seeding Lakeshore Signs (second demo shop)…");
  const lake = await seedLakeshore(pw);
  console.log(`✓ Seeded ${lake.users} users, ${lake.customers} customers, ${lake.jobs} jobs.`);

  const demoPw = process.env.SEED_PASSWORD ?? "missprint2026";
  console.log(`  Sign in as owner@missprintusa.com / ${demoPw}  (Miss Print)`);
  console.log(`  or owner@lakeshoresigns.example / ${demoPw}  (Lakeshore Signs)`);
  void abcWrapOld;
  void dentalCards;
  await client.end();
}

/**
 * A small second shop, so multi-tenancy can be seen and tested. Deliberate overlaps with Miss Print
 * (customer "ABC Plumbing", job "Menu Board Panels", handle @mike, location code OFFSITE, category slugs)
 * make it easy to spot one shop's data leaking into the other.
 */
async function seedLakeshore(passwordHash: string) {
  const [shop] = await db.insert(s.tenants).values({ slug: "lakeshore-signs", name: "Lakeshore Signs" }).returning();
  const T = shop!.id;
  const nextJobNo = counter(1001);
  const nextQuoteNo = counter(1001);
  const nextInvoiceNo = counter(1001);

  const [mainShop] = await db
    .insert(s.locations)
    .values([
      { tenantId: T, code: "MAIN", name: "Main shop", role: "Front counter · production · signs & banners", address: "412 Franklin St, Michigan City, IN 46360", phone: "219-555-0300", isCustomerFacing: true, sortOrder: 1 },
      { tenantId: T, code: "OFFSITE", name: "Off-site", role: "Installations at the customer's site", sortOrder: 2 },
    ])
    .returning();

  const us = await db
    .insert(s.users)
    .values([
      { tenantId: T, name: "Pat Lake", handle: "pat", email: "owner@lakeshoresigns.example", passwordHash, role: "owner", title: "Owner", color: "#0f766e", locationId: mainShop!.id },
      { tenantId: T, name: "Mike Dunn", handle: "mike", email: "mike@lakeshoresigns.example", passwordHash, role: "production", title: "Production & Install", color: "#b45309", locationId: mainShop!.id },
    ])
    .returning();
  const [pat, mike] = us;

  await db.insert(s.companySettings).values([
    {
      tenantId: T,
      key: "company",
      value: { name: "Lakeshore Signs", tagline: "Signs · Banners · Wraps", phone: "219-555-0300", email: "orders@lakeshoresigns.example", website: "", address: "412 Franklin St, Michigan City, IN 46360", hours: "Mon–Fri 8:00–4:30" },
    },
    {
      tenantId: T,
      key: "business_rules",
      value: { minimumChargeCents: 3500, designRateCents: 6500, installRateCents: 9000, laborCostPerHourCents: 2600, mileageRateCents: 150, rushPct: 0.3, targetMarginPct: 0.5, outsourcedMarkupPct: 0.25, taxRate: 0.07 },
    },
    { tenantId: T, key: "quote_valid_days", value: 14 },
  ]);

  type Cat = { slug: string; name: string; group: string; method: PricingConfig["method"]; install?: boolean; config: PricingConfig; notes?: string };
  const cats: Cat[] = [
    { slug: "banners", name: "Banners", group: "sign", method: "per_sqft", config: { method: "per_sqft", pricePerSqftCents: 600, materialCostPerSqftCents: 85, wastePct: 0.1, setupCents: 2000, finishingOptions: [{ key: "hem", label: "Hem & grommets", basis: "per_linear_ft", priceCents: 60, costCents: 10 }] }, notes: "13oz scrim. Hem + grommets standard." },
    { slug: "yard-signs", name: "Yard Signs", group: "sign", method: "per_unit", config: { method: "per_unit", unitPriceCents: 1400, unitCostCents: 380, setupCents: 3000, finishingOptions: [{ key: "stakes", label: "H-stakes", basis: "per_unit", priceCents: 250, costCents: 70 }] } },
    { slug: "vehicle-graphics", name: "Vehicle Graphics", group: "wrap", method: "per_sqft", install: true, config: { method: "per_sqft", pricePerSqftCents: 1300, materialCostPerSqftCents: 200, wastePct: 0.2, designHours: 2, installHours: 3 } },
  ];
  const catRows = await db
    .insert(s.productCategories)
    .values(cats.map((c, i) => ({ tenantId: T, slug: c.slug, name: c.name, group: c.group, pricingMethod: c.method, defaultLocationId: mainShop!.id, defaultNeedsProof: true, defaultNeedsInstall: c.install ?? false, sortOrder: i })))
    .returning();
  const C = Object.fromEntries(catRows.map((c) => [c.slug, c]));
  await db.insert(s.pricingRules).values(cats.map((c) => ({ tenantId: T, categoryId: C[c.slug]!.id, config: c.config, notes: c.notes ?? null, updatedBy: pat!.id })));

  // Same starter paper, presses and services as a new shop (Lakeshore doesn't sell print categories yet).
  await insertStarterPrintCatalog(db, T, { locationId: mainShop!.id });

  const custs = [
    { name: "ABC Plumbing", phone: "219-555-0311", email: "info@abcplumbingmc.example", address: "900 E Michigan Blvd", contact: "Carl Anders" },
    { name: "Dunes Diner", phone: "219-555-0322", email: "hello@dunesdiner.example", address: "150 Wabash St", contact: "Rosa Kim" },
    { name: "Washington Park Marina", phone: "219-555-0333", email: "office@wpmarina.example", address: "1 Lakeshore Dr", contact: "Hank Olsen" },
  ];
  const CU: Record<string, s.Customer & { contactId: number }> = {};
  for (const c of custs) {
    const [row] = await db
      .insert(s.customers)
      .values({ tenantId: T, name: c.name, phone: c.phone, email: c.email, address: c.address, city: "Michigan City", state: "IN", zip: "46360", salespersonId: pat!.id, customerSince: "2022-04-01" })
      .returning();
    const [contact] = await db.insert(s.customerContacts).values({ tenantId: T, customerId: row!.id, name: c.contact, email: c.email, phone: c.phone, isPrimary: true }).returning();
    CU[c.name] = { ...row!, contactId: contact!.id };
  }

  const TAX = 0.07;
  type LJob = { customer: string; title: string; cat: string; status: s.JobStatus; createdDay: number; dueDay: number; desc: string; qty: number; w?: number; h?: number; price: number; cost: number; install?: boolean };
  const jobSpecs: LJob[] = [
    { customer: "Dunes Diner", title: "Menu Board Panels", cat: "yard-signs", status: "completed", createdDay: -21, dueDay: -14, desc: "2 menu panels 24×36 coroplast", qty: 2, w: 24, h: 36, price: 18000, cost: 3200 },
    { customer: "ABC Plumbing", title: "Truck Door Lettering", cat: "vehicle-graphics", status: "production", createdDay: -5, dueDay: workday(2), desc: "Cut vinyl door lettering, pair", qty: 2, w: 24, h: 18, price: 32000, cost: 6500, install: true },
    { customer: "Washington Park Marina", title: "Summer Season Banner", cat: "banners", status: "design", createdDay: -3, dueDay: workday(6), desc: "3' × 10' outdoor banner", qty: 1, w: 36, h: 120, price: 21500, cost: 3800 },
    { customer: "Dunes Diner", title: "Grand Reopening Yard Signs", cat: "yard-signs", status: "ready_pickup", createdDay: -4, dueDay: 0, desc: "20 yard signs 18×24, with H-stakes", qty: 20, w: 24, h: 18, price: 36000, cost: 9000 },
    { customer: "ABC Plumbing", title: "Shop Banner", cat: "banners", status: "new", createdDay: 0, dueDay: workday(7), desc: "4' × 8' outdoor banner", qty: 1, w: 48, h: 96, price: 21000, cost: 3900 },
  ];
  const jobRows: s.Job[] = [];
  for (const j of jobSpecs) {
    const cust = CU[j.customer]!;
    const tax = Math.round(j.price * TAX);
    const created = at(j.createdDay, 10);
    const completedAt = j.status === "completed" ? at(j.dueDay, 15) : null;
    const [job] = await db
      .insert(s.jobs)
      .values({
        tenantId: T,
        number: nextJobNo(),
        customerId: cust.id,
        contactId: cust.contactId,
        title: j.title,
        categoryId: C[j.cat]!.id,
        status: j.status,
        locationId: mainShop!.id,
        fulfillment: j.install ? "install" : "pickup",
        needsInstall: j.install ?? false,
        salespersonId: pat!.id,
        productionId: mike!.id,
        installerId: j.install ? mike!.id : null,
        dueDate: dayOffset(j.dueDay),
        subtotalCents: j.price,
        taxRate: TAX,
        taxCents: tax,
        totalCents: j.price + tax,
        estimatedCostCents: j.cost,
        completedAt,
        createdBy: pat!.id,
        createdAt: created,
        updatedAt: completedAt ?? created,
      })
      .returning();
    await db.insert(s.jobItems).values({ tenantId: T, jobId: job!.id, categoryId: C[j.cat]!.id, description: j.desc, quantity: j.qty, widthIn: j.w ?? null, heightIn: j.h ?? null, recommendedCents: j.price, priceCents: j.price, estimatedCostCents: j.cost });
    await db.insert(s.jobStatusHistory).values({ tenantId: T, jobId: job!.id, fromStatus: null, toStatus: j.status, changedBy: pat!.id, changedAt: completedAt ?? created });
    await db.insert(s.activityLogs).values({ tenantId: T, action: "job.created", entityType: "job", entityId: job!.id, jobId: job!.id, customerId: cust.id, actorId: pat!.id, summary: "Created job", createdAt: created });
    jobRows.push(job!);
  }

  // Invoice (paid) for the completed job
  const done = jobRows[0]!;
  const [invoice] = await db
    .insert(s.invoices)
    .values({ tenantId: T, number: nextInvoiceNo(), customerId: done.customerId, jobId: done.id, status: "paid", issueDate: dayOffset(-14), dueDate: dayOffset(-14), subtotalCents: done.subtotalCents, taxRate: TAX, taxCents: done.taxCents, totalCents: done.totalCents, paidCents: done.totalCents, sentAt: at(-14, 16), createdBy: pat!.id, createdAt: at(-14, 16) })
    .returning();
  await db.insert(s.invoiceItems).values({ tenantId: T, invoiceId: invoice!.id, description: jobSpecs[0]!.desc, quantity: jobSpecs[0]!.qty, amountCents: done.subtotalCents });
  await db.insert(s.payments).values({ tenantId: T, invoiceId: invoice!.id, customerId: done.customerId, amountCents: done.totalCents, method: "check", reference: "#2214", receivedOn: dayOffset(-12), recordedBy: pat!.id, createdAt: at(-12, 12) });

  // One open quote
  const marina = CU["Washington Park Marina"]!;
  const qPrice = 145000;
  const qTax = Math.round(qPrice * TAX);
  const [q] = await db
    .insert(s.quotes)
    .values({ tenantId: T, number: nextQuoteNo(), customerId: marina.id, contactId: marina.contactId, title: "Dock Directional Signs", status: "sent", salespersonId: pat!.id, locationId: mainShop!.id, needsInstall: true, validUntil: dayOffset(12), subtotalCents: qPrice, taxRate: TAX, taxCents: qTax, totalCents: qPrice + qTax, estimatedCostCents: 52000, sentAt: at(-2, 11), createdBy: pat!.id, createdAt: at(-2, 10), updatedAt: at(-2, 11) })
    .returning();
  await db.insert(s.quoteItems).values({ tenantId: T, quoteId: q!.id, categoryId: C["yard-signs"]!.id, description: "12 directional dock signs 18×24 ACM, installed", quantity: 12, widthIn: 24, heightIn: 18, recommendedCents: qPrice, priceCents: qPrice, estimatedCostCents: 52000 });
  await db.insert(s.activityLogs).values({ tenantId: T, action: "quote.created", entityType: "quote", entityId: q!.id, quoteId: q!.id, customerId: marina.id, actorId: pat!.id, summary: "Created quote", createdAt: at(-2, 10) });

  await syncCounters(T);
  return { users: us.length, customers: custs.length, jobs: jobRows.length };
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
