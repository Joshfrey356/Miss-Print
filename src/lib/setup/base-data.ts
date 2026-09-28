import * as s from "@/lib/db/schema";
import type { PricingConfig } from "@/lib/pricing/engine";
import type { Tx } from "@/lib/db";
import { insertStarterPrintCatalog, starterPrintCategories } from "@/lib/estimating/starter-catalog";

/**
 * Starter data for a NEW shop: a main location (+ off-site for installs), the owner account,
 * business rules, common vendors & materials, paper stocks, presses & bindery services for print
 * estimating, product categories and starter pricing (cards, flyers, brochures, postcards and
 * letterhead are estimated from paper + press).
 * Everything is editable afterwards in Settings. Runs inside the caller's transaction.
 * (scripts/seed.ts builds the Miss Print demo shop separately.)
 */
export type OwnerInput = { name: string; email: string; passwordHash: string };
export type ShopInput = { address?: string | null; phone?: string | null };

export async function insertBaseData(db: Tx, tenantId: number, ownerInput: OwnerInput, shop: ShopInput = {}) {
  // ---------- locations ----------
  const [main] = await db
    .insert(s.locations)
    .values([
      { tenantId, code: "MAIN", name: "Main shop", role: "Front counter · design · production", address: shop.address ?? null, phone: shop.phone ?? null, isCustomerFacing: true, sortOrder: 1 },
      { tenantId, code: "OFFSITE", name: "Off-site", role: "Installations at the customer's site", sortOrder: 2 },
    ])
    .returning();

  // ---------- owner ----------
  const handle = ownerInput.name.split(" ")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "") || "owner";
  const [owner] = await db
    .insert(s.users)
    .values({ tenantId, name: ownerInput.name, handle, email: ownerInput.email, role: "owner", title: "Owner", color: "#0d72c4", locationId: main!.id, passwordHash: ownerInput.passwordHash })
    .returning();

  // ---------- settings / business rules ----------
  await db.insert(s.companySettings).values([
    {
      tenantId,
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
      updatedBy: owner!.id,
    },
    { tenantId, key: "quote_valid_days", value: 30, updatedBy: owner!.id },
  ]);

  // ---------- vendors & materials ----------
  const vendors = await db
    .insert(s.vendors)
    .values([
      { name: "Grimco", phone: "800-542-9941", notes: "Sign supplies, substrates, vinyl." },
      { name: "Fellers", notes: "Wrap vinyl & laminates (3M, Avery)." },
      { name: "Veritiv", notes: "Paper stocks." },
      { name: "4imprint", notes: "Promo items — outsourced." },
      { name: "USPS", notes: "Mailing / EDDM postage." },
    ].map((v) => ({ ...v, tenantId })))
    .returning();
  const V = Object.fromEntries(vendors.map((v) => [v.name, v]));
  const mats = await db
    .insert(s.materials)
    .values([
      { name: "13oz Scrim Vinyl Banner", kind: "vinyl", unit: "sqft", costCents: 55, vendorId: V["Grimco"]!.id, quantityOnHand: 1200, reorderLevel: 400 },
      { name: "15oz Blockout Banner", kind: "vinyl", unit: "sqft", costCents: 85, vendorId: V["Grimco"]!.id, quantityOnHand: 450, reorderLevel: 200 },
      { name: "8oz Mesh Banner", kind: "vinyl", unit: "sqft", costCents: 95, vendorId: V["Grimco"]!.id, quantityOnHand: 300, reorderLevel: 150 },
      { name: "4mm Coroplast", kind: "substrate", unit: "sqft", costCents: 110, vendorId: V["Grimco"]!.id, quantityOnHand: 640, reorderLevel: 320 },
      { name: "3mm Aluminum Composite (ACM)", kind: "substrate", unit: "sqft", costCents: 380, vendorId: V["Grimco"]!.id, quantityOnHand: 256, reorderLevel: 128 },
      { name: "3mm PVC", kind: "substrate", unit: "sqft", costCents: 210, vendorId: V["Grimco"]!.id, quantityOnHand: 160, reorderLevel: 96 },
      { name: "3/16\" Foam Board", kind: "substrate", unit: "sqft", costCents: 140, vendorId: V["Grimco"]!.id, quantityOnHand: 96, reorderLevel: 64 },
      { name: "3M IJ180Cv3 Wrap Vinyl + 8518 Laminate", kind: "vinyl", unit: "sqft", costCents: 320, vendorId: V["Fellers"]!.id, quantityOnHand: 900, reorderLevel: 450 },
      { name: "Oracal 651 Cut Vinyl", kind: "vinyl", unit: "sqft", costCents: 60, vendorId: V["Fellers"]!.id, quantityOnHand: 500, reorderLevel: 200 },
      { name: "Backlit Film", kind: "vinyl", unit: "sqft", costCents: 240, vendorId: V["Grimco"]!.id, quantityOnHand: 80, reorderLevel: 50 },
      { name: "24# White Wove #10 Envelope", kind: "paper", unit: "each", costCents: 4, vendorId: V["Veritiv"]!.id, quantityOnHand: 5000, reorderLevel: 2000 },
    ].map((m) => ({ ...m, tenantId, quantityOnHand: null, reorderLevel: null })))
    .returning();
  const M = Object.fromEntries(mats.map((m) => [m.name, m]));

  // ---------- print estimating: paper stocks, presses, bindery & services ----------
  const printCatalog = await insertStarterPrintCatalog(db, tenantId, { paperVendorId: V["Veritiv"]!.id, locationId: main!.id });
  const printCats = starterPrintCategories(printCatalog);

  // ---------- categories & pricing rules ----------
  type Cat = { slug: string; name: string; group: string; method: PricingConfig["method"]; loc: number; proof?: boolean; install?: boolean; config: PricingConfig; notes?: string };
  const baseCats: Cat[] = [
    { slug: "business-cards", name: "Business Cards", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 4500, costCents: 1400 }, { minQty: 500, priceCents: 5500, costCents: 1800 }, { minQty: 1000, priceCents: 7000, costCents: 2500 }, { minQty: 2500, priceCents: 13500, costCents: 5200 }], finishingOptions: [{ key: "double", label: "Double-sided", basis: "flat", priceCents: 1500, costCents: 400 }, { key: "round", label: "Rounded corners", basis: "flat", priceCents: 2000 }, { key: "soft", label: "Soft-touch coating", basis: "flat", priceCents: 3500, costCents: 1200 }] }, notes: "Standard 14pt, full color. Double-sided adds $15. Repeat orders usually skip the proof." },
    { slug: "brochures", name: "Brochures", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 24500, costCents: 9000 }, { minQty: 500, priceCents: 32500, costCents: 12500 }, { minQty: 1000, priceCents: 45000, costCents: 18500 }, { minQty: 2500, priceCents: 82500, costCents: 36000 }], finishingOptions: [{ key: "fold", label: "Tri-fold / bi-fold", basis: "flat", priceCents: 0 }, { key: "score", label: "Scoring (heavy stock)", basis: "flat", priceCents: 2500 }] }, notes: "8.5×11 100# gloss text, full color both sides, folded." },
    { slug: "flyers", name: "Flyers", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 100, priceCents: 5500, costCents: 1500 }, { minQty: 250, priceCents: 8500, costCents: 2800 }, { minQty: 500, priceCents: 12500, costCents: 4500 }, { minQty: 1000, priceCents: 18500, costCents: 7200 }, { minQty: 2500, priceCents: 36500, costCents: 15500 }] } },
    { slug: "postcards-mailers", name: "Postcards & Mailers", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 9500, costCents: 3000 }, { minQty: 500, priceCents: 13500, costCents: 4600 }, { minQty: 1000, priceCents: 19500, costCents: 7400 }, { minQty: 5000, priceCents: 69500, costCents: 29000 }], finishingOptions: [{ key: "eddm", label: "EDDM bundling & prep", basis: "per_unit", priceCents: 3 }, { key: "vdp", label: "Variable data addressing", basis: "per_unit", priceCents: 6 }] } },
    { slug: "envelopes", name: "Envelopes", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 11000, costCents: 3500 }, { minQty: 500, priceCents: 15000, costCents: 5500 }, { minQty: 1000, priceCents: 23500, costCents: 9500 }] } },
    { slug: "letterhead", name: "Letterhead", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 9000, costCents: 2800 }, { minQty: 500, priceCents: 12500, costCents: 4200 }, { minQty: 1000, priceCents: 19000, costCents: 7000 }] } },
    { slug: "forms", name: "Forms (NCR)", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 14500, costCents: 5000 }, { minQty: 500, priceCents: 19500, costCents: 7200 }, { minQty: 1000, priceCents: 29500, costCents: 11500 }], finishingOptions: [{ key: "number", label: "Numbering", basis: "flat", priceCents: 3500 }, { key: "pad", label: "Padding into books", basis: "flat", priceCents: 2500 }] } },
    { slug: "folders", name: "Presentation Folders", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 49500, costCents: 22000 }, { minQty: 500, priceCents: 69500, costCents: 31000 }] } },
    { slug: "labels-stickers", name: "Labels & Stickers", group: "print", method: "quantity_tier", loc: main!.id, config: { method: "quantity_tier", tiers: [{ minQty: 250, priceCents: 15000, costCents: 4500 }, { minQty: 500, priceCents: 21000, costCents: 6500 }, { minQty: 1000, priceCents: 32500, costCents: 10500 }] } },
    { slug: "posters", name: "Posters", group: "sign", method: "per_sqft", loc: main!.id, config: { method: "per_sqft", pricePerSqftCents: 800, materialCostPerSqftCents: 90, wastePct: 0.05, finishingOptions: [{ key: "mount", label: "Mount to foam board", basis: "per_sqft", priceCents: 400, costCents: 140 }, { key: "lam", label: "Laminate", basis: "per_sqft", priceCents: 200, costCents: 45 }] } },
    { slug: "banners", name: "Banners", group: "sign", method: "per_sqft", loc: main!.id, config: { method: "per_sqft", pricePerSqftCents: 550, materialCostPerSqftCents: 85, wastePct: 0.1, setupCents: 1500, machineHours: 0.3, machineCostPerHourCents: 3500, finishingOptions: [{ key: "hem", label: "Hem & grommets", basis: "per_linear_ft", priceCents: 50, costCents: 10 }, { key: "pocket", label: "Pole pockets", basis: "per_linear_ft", priceCents: 150, costCents: 20 }, { key: "slits", label: "Wind slits", basis: "flat", priceCents: 1000 }, { key: "double", label: "Double-sided", basis: "per_sqft", priceCents: 450, costCents: 80 }] }, notes: "13oz scrim, full color. Hem + grommets every 2 ft standard. 4×8 usually lands $185–$210." },
    { slug: "yard-signs", name: "Yard Signs", group: "sign", method: "per_unit", loc: main!.id, config: { method: "per_unit", unitPriceCents: 1200, unitCostCents: 350, setupCents: 2500, finishingOptions: [{ key: "stakes", label: "H-stakes", basis: "per_unit", priceCents: 200, costCents: 70 }, { key: "double", label: "Double-sided", basis: "per_unit", priceCents: 300, costCents: 60 }] }, notes: "18×24 4mm coroplast. Price per sign; setup covers file prep." },
    { slug: "signs", name: "Commercial Signs", group: "sign", method: "per_sqft", loc: main!.id, install: true, config: { method: "per_sqft", pricePerSqftCents: 1400, materialCostPerSqftCents: 380, materialMarkupPct: 2.5, wastePct: 0.15, setupCents: 5000, installHours: 3, finishingOptions: [{ key: "lam", label: "UV laminate", basis: "per_sqft", priceCents: 250, costCents: 60 }, { key: "holes", label: "Drilled holes / standoffs", basis: "flat", priceCents: 4500, costCents: 1500 }] }, notes: "Rigid signs: ACM, PVC, coroplast. Material choice changes cost; installation priced separately." },
    { slug: "backlit-signs", name: "Backlit & Illuminated Signs", group: "sign", method: "custom", loc: main!.id, install: true, config: { method: "custom", targetMarginPct: 0.45, installHours: 6 }, notes: "Usually quoted custom with the sign cabinet vendor. Enter the vendor cost as outside services." },
    { slug: "banner-stands", name: "Retractable Banner Stands", group: "sign", method: "per_unit", loc: main!.id, proof: true, config: { method: "per_unit", unitPriceCents: 24900, unitCostCents: 9500 } },
    { slug: "wall-graphics", name: "Wall Graphics & Wraps", group: "sign", method: "per_sqft", loc: main!.id, install: true, config: { method: "per_sqft", pricePerSqftCents: 1200, materialCostPerSqftCents: 250, wastePct: 0.15, designHours: 3, installHours: 4 } },
    { slug: "decals", name: "Decals", group: "sign", method: "per_sqft", loc: main!.id, config: { method: "per_sqft", pricePerSqftCents: 1000, materialCostPerSqftCents: 120, wastePct: 0.2, minimumCents: 3500, finishingOptions: [{ key: "cut", label: "Contour cut", basis: "per_sqft", priceCents: 300 }, { key: "mask", label: "Transfer tape / masking", basis: "per_sqft", priceCents: 150 }] } },
    { slug: "vehicle-graphics", name: "Vehicle Graphics (Partial)", group: "wrap", method: "per_sqft", loc: main!.id, install: true, config: { method: "per_sqft", pricePerSqftCents: 1200, materialCostPerSqftCents: 180, wastePct: 0.2, designHours: 2, installHours: 3 } },
    { slug: "vehicle-wraps", name: "Vehicle Wraps", group: "wrap", method: "per_sqft", loc: main!.id, install: true, config: { method: "per_sqft", pricePerSqftCents: 1100, materialCostPerSqftCents: 320, wastePct: 0.2, designHours: 6, installHours: 12, targetMarginPct: 0.45 }, notes: "Full wrap = print + laminate per sq ft, plus design and install hours. Ford Transit 148\" high roof ≈ 290 sq ft of wrap." },
    { slug: "graphic-design", name: "Graphic Design", group: "design", method: "per_unit", loc: main!.id, config: { method: "per_unit", unitPriceCents: 7500 }, notes: "Quantity = hours." },
    { slug: "offset-printing", name: "Offset / Custom Commercial Printing", group: "print", method: "custom", loc: main!.id, config: { method: "custom" } },
    { slug: "other", name: "Other / Custom", group: "other", method: "custom", loc: main!.id, config: { method: "custom" } },
  ];
  // Cards, flyers, brochures, postcards and letterhead: estimated from paper + press.
  const cats = baseCats.map((c) => (printCats[c.slug] ? { ...c, method: "sheet_fed" as const, config: printCats[c.slug]!.config, notes: printCats[c.slug]!.notes } : c));
  const catRows = await db
    .insert(s.productCategories)
    .values(cats.map((c, i) => ({ tenantId, slug: c.slug, name: c.name, group: c.group, pricingMethod: c.method, defaultLocationId: c.loc, defaultNeedsProof: c.proof ?? true, defaultNeedsInstall: c.install ?? false, sortOrder: i })))
    .returning();
  const C = Object.fromEntries(catRows.map((c) => [c.slug, c]));
  await db.insert(s.pricingRules).values(cats.map((c) => ({ tenantId, categoryId: C[c.slug]!.id, config: c.config, notes: c.notes ?? null, updatedBy: owner.id })));
  return { owner: owner!, categories: cats.length };
}
