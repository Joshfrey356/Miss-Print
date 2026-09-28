/**
 * Starter estimating catalog for a new shop: common paper stocks, a digital and an offset press,
 * a cutter and a folder, and the usual bindery & services — so a shop can estimate on day one.
 * Prices are plausible for a small US print shop (2026); every number is editable in Settings.
 *
 * Used by src/lib/setup/base-data.ts (new shops) and scripts/seed.ts (demo shops), so it must not
 * import "server-only". Runs inside the caller's transaction.
 */
import * as s from "../db/schema";
import type { PrintConfig } from "../pricing/print";
import type { PricingConfig } from "../pricing/engine";

/** drizzle's insert() on the app's db / a transaction, or the seed script's own db. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Insert = (table: any) => any;

export type StarterPaperKey =
  | "bond20_letter"
  | "bond20_tabloid"
  | "text60"
  | "text70"
  | "gloss80text"
  | "gloss100text"
  | "gloss80cover"
  | "gloss100cover"
  | "c2s14pt"
  | "text70_2538"
  | "gloss80text_2538";

const PAPERS: { key: StarterPaperKey; name: string; weight: string; w: number; h: number; perM: number }[] = [
  { key: "bond20_letter", name: "20# Bond White 8.5×11", weight: "20# Bond", w: 8.5, h: 11, perM: 1200 },
  { key: "bond20_tabloid", name: "20# Bond White 11×17", weight: "20# Bond", w: 11, h: 17, perM: 2400 },
  { key: "text60", name: "60# Offset Text 12×18", weight: "60# Text", w: 12, h: 18, perM: 3800 },
  { key: "text70", name: "70# Offset Text 12×18", weight: "70# Text", w: 12, h: 18, perM: 4500 },
  { key: "gloss80text", name: "80# Gloss Text 12×18", weight: "80# Text", w: 12, h: 18, perM: 6200 },
  { key: "gloss100text", name: "100# Gloss Text 12×18", weight: "100# Text", w: 12, h: 18, perM: 8000 },
  { key: "gloss80cover", name: "80# Gloss Cover 12×18", weight: "80# Cover", w: 12, h: 18, perM: 11500 },
  { key: "gloss100cover", name: "100# Gloss Cover 12×18", weight: "100# Cover", w: 12, h: 18, perM: 15000 },
  { key: "c2s14pt", name: "14pt C2S Cover 12×18", weight: "14pt Cover", w: 12, h: 18, perM: 20000 },
  { key: "text70_2538", name: "70# Offset Text 25×38", weight: "70# Text", w: 25, h: 38, perM: 16500 },
  { key: "gloss80text_2538", name: "80# Gloss Text 25×38", weight: "80# Text", w: 25, h: 38, perM: 18000 },
];

export type StarterCatalog = {
  paper: Record<StarterPaperKey, number>;
  digitalPressId: number;
  offsetPressId: number;
  op: Record<"cutting" | "folding" | "scoring" | "drilling" | "padding" | "stitching" | "lamination" | "corners" | "fileprep", number>;
};

/**
 * Insert the starter paper, presses and services for one shop. Paper stocks are materials
 * (kind "paper", unit "sheet"); `paperVendorId` is who the shop buys paper from, if known.
 */
export async function insertStarterPrintCatalog(db: { insert: Insert }, tenantId: number, opts: { paperVendorId?: number | null; locationId?: number | null } = {}): Promise<StarterCatalog> {
  const papers: s.Material[] = await db
    .insert(s.materials)
    .values(
      PAPERS.map((p) => ({
        tenantId,
        name: p.name,
        kind: "paper",
        unit: "sheet",
        weight: p.weight,
        sheetWidthIn: p.w,
        sheetHeightIn: p.h,
        costPerMCents: p.perM,
        costCents: Math.round(p.perM / 1000),
        vendorId: opts.paperVendorId ?? null,
      })),
    )
    .returning();

  const loc = opts.locationId ?? null;
  const machines: s.Equipment[] = await db
    .insert(s.equipment)
    .values([
      {
        tenantId,
        name: "Digital color press",
        kind: "digital",
        locationId: loc,
        maxSheetWidthIn: 13,
        maxSheetHeightIn: 19,
        minSheetWidthIn: 8.5,
        minSheetHeightIn: 11,
        gripperIn: 0.2,
        maxColors: 4,
        colorClickPriceCents: 30,
        colorClickCostCents: 4.5,
        bwClickPriceCents: 8,
        bwClickCostCents: 1,
        setupMinutes: 5,
        sheetsPerHour: 3600,
        hourlyPriceCents: 6000,
        hourlyCostCents: 3500,
        setupSpoilageSheets: 10,
        runSpoilagePct: 0.02,
        notes: "Toner press, 13×19 max. Click charges are per printed side of a press sheet.",
        sortOrder: 1,
      },
      {
        tenantId,
        name: "Small offset press (4-color)",
        kind: "offset",
        locationId: loc,
        maxSheetWidthIn: 14,
        maxSheetHeightIn: 20,
        minSheetWidthIn: 8.5,
        minSheetHeightIn: 11,
        gripperIn: 0.375,
        maxColors: 4,
        perfecting: false,
        platePriceCents: 2500,
        plateCostCents: 1200,
        inkCostPerMCents: 300,
        setupMinutes: 15,
        sheetsPerHour: 6000,
        hourlyPriceCents: 11000,
        hourlyCostCents: 6500,
        setupSpoilageSheets: 100,
        runSpoilagePct: 0.03,
        notes: "14×20 four-color. Make-ready is per plate; long runs usually come out cheaper here.",
        sortOrder: 2,
      },
      { tenantId, name: "Guillotine cutter", kind: "cutter", locationId: loc, hourlyPriceCents: 6000, hourlyCostCents: 3000, sortOrder: 3 },
      { tenantId, name: "Folder", kind: "folder", locationId: loc, hourlyPriceCents: 6000, hourlyCostCents: 3000, sortOrder: 4 },
    ])
    .returning();
  const [digital, offset, cutter, folder] = machines;

  type Op = typeof s.operations.$inferInsert;
  const op = (key: StarterCatalog["op"] extends Record<infer K, number> ? K : never, v: Omit<Op, "tenantId">) => ({ key, v: { ...v, tenantId } });
  const ops = [
    op("fileprep", { name: "File prep", category: "prepress", basis: "per_job", setupPriceCents: 1500, setupCostCents: 700, sortOrder: 1 }),
    op("cutting", { name: "Cutting", category: "bindery", basis: "per_1000", setupPriceCents: 1500, setupCostCents: 500, ratePriceCents: 400, rateCostCents: 150, equipmentId: cutter!.id, sortOrder: 2 }),
    op("folding", { name: "Folding", category: "bindery", basis: "per_1000", setupPriceCents: 1500, setupCostCents: 500, ratePriceCents: 2000, rateCostCents: 600, minimumCents: 2500, equipmentId: folder!.id, sortOrder: 3 }),
    op("scoring", { name: "Scoring", category: "bindery", basis: "per_1000", setupPriceCents: 1500, setupCostCents: 500, ratePriceCents: 2500, rateCostCents: 800, minimumCents: 2500, sortOrder: 4 }),
    op("drilling", { name: "Drilling (3-hole)", category: "bindery", basis: "per_1000", setupPriceCents: 1000, setupCostCents: 300, ratePriceCents: 1000, rateCostCents: 300, minimumCents: 1500, sortOrder: 5 }),
    op("padding", { name: "Padding", category: "bindery", basis: "per_1000", setupPriceCents: 1000, setupCostCents: 300, ratePriceCents: 1500, rateCostCents: 500, minimumCents: 2000, sortOrder: 6 }),
    op("stitching", { name: "Saddle stitching", category: "bindery", basis: "per_piece", setupPriceCents: 2000, setupCostCents: 700, ratePriceCents: 12, rateCostCents: 4, minimumCents: 3000, sortOrder: 7 }),
    op("lamination", { name: "Lamination (per sheet)", category: "finishing", basis: "per_sheet", setupPriceCents: 1000, setupCostCents: 300, ratePriceCents: 75, rateCostCents: 20, minimumCents: 2000, sortOrder: 8 }),
    op("corners", { name: "Round corners", category: "finishing", basis: "per_1000", setupPriceCents: 1000, setupCostCents: 300, ratePriceCents: 1000, rateCostCents: 300, minimumCents: 1500, sortOrder: 9 }),
  ];
  const opRows: s.Operation[] = await db
    .insert(s.operations)
    .values(ops.map((o) => o.v))
    .returning();

  return {
    paper: Object.fromEntries(PAPERS.map((p, i) => [p.key, papers[i]!.id])) as StarterCatalog["paper"],
    digitalPressId: digital!.id,
    offsetPressId: offset!.id,
    op: Object.fromEntries(ops.map((o, i) => [o.key, opRows[i]!.id])) as StarterCatalog["op"],
  };
}

/** Category settings saved for sheet_fed categories. `defaultBleed` = the design usually bleeds. */
export type StarterPrintConfig = PrintConfig & { defaultBleed?: boolean };

/**
 * Print-estimating pricing for the starter print categories, keyed by category slug. Categories not
 * listed keep their own pricing.
 */
export function starterPrintCategories(c: StarterCatalog): Record<string, { config: PricingConfig; notes: string }> {
  const p = c.paper;
  const covers = [p.c2s14pt, p.gloss100cover, p.gloss80cover];
  const texts = [p.gloss100text, p.gloss80text, p.text70, p.text60, p.bond20_letter, p.bond20_tabloid, p.text70_2538, p.gloss80text_2538];
  const print = (x: StarterPrintConfig): PrintConfig => ({ bleedIn: 0.125, paperMarkupPct: 0.3, ...x });
  return {
    "business-cards": {
      config: { method: "sheet_fed", print: print({ paperIds: covers, defaultPaperId: p.c2s14pt, defaultPages: 2, defaultColorsFront: 4, defaultColorsBack: 4, defaultBleed: true, defaultOperationIds: [c.op.cutting] }) },
      notes: "3.5×2, 14pt C2S, full color both sides with bleed — 21 up on a 12×18 sheet. Add Round corners if asked. Repeat orders usually skip the proof.",
    },
    flyers: {
      config: { method: "sheet_fed", print: print({ paperIds: texts, defaultPaperId: p.gloss100text, defaultPages: 1, defaultColorsFront: 4, defaultColorsBack: 0, defaultOperationIds: [c.op.cutting] }) },
      notes: "8.5×11 on 100# gloss text, full color one side — 2 up on 12×18. Long runs (5,000+) often come out cheaper on the offset press.",
    },
    brochures: {
      config: { method: "sheet_fed", print: print({ paperIds: texts, defaultPaperId: p.gloss100text, defaultPages: 2, defaultColorsFront: 4, defaultColorsBack: 4, defaultBleed: true, defaultOperationIds: [c.op.cutting, c.op.scoring, c.op.folding] }) },
      notes: "11×8.5 tri-fold on 100# gloss text, full color both sides, scored and folded.",
    },
    "postcards-mailers": {
      config: { method: "sheet_fed", print: print({ paperIds: covers, defaultPaperId: p.c2s14pt, defaultPages: 2, defaultColorsFront: 4, defaultColorsBack: 4, defaultBleed: true, defaultOperationIds: [c.op.cutting] }), finishingOptions: [{ key: "eddm", label: "EDDM bundling & prep", basis: "per_unit", priceCents: 3 }, { key: "vdp", label: "Variable data addressing", basis: "per_unit", priceCents: 6 }] },
      notes: "4×6, 5×7 or 6×9 on 14pt C2S, full color both sides with bleed. Postage is billed separately.",
    },
    letterhead: {
      config: { method: "sheet_fed", print: print({ paperIds: texts, defaultPaperId: p.text70, defaultPages: 1, defaultColorsFront: 4, defaultColorsBack: 0, defaultOperationIds: [c.op.cutting] }) },
      notes: "8.5×11 on 70# offset text, full color one side.",
    },
  };
}
