/**
 * Labels, form validation and worked examples for the estimating catalog: paper stocks,
 * presses & equipment, bindery & services. Pure — used by the Settings forms (live hints) and
 * their Server Actions (the real check). Money is integer cents; rates may be fractions of a cent.
 */
import { operationCharge, type PrintOperation } from "@/lib/pricing/print";
import { fmtMoney, parseCount, parseInches, parseMoneyCents, parsePct, parseRateCents, parseSize } from "./parse";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
export type EquipmentKind = "digital" | "offset" | "wide_format" | "cutter" | "folder" | "bindery" | "other";
export type OperationCategory = "prepress" | "bindery" | "finishing" | "packaging" | "shipping" | "other";
export type OperationBasis = PrintOperation["basis"];

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  digital: "Digital press",
  offset: "Offset press",
  wide_format: "Wide-format printer",
  cutter: "Cutter",
  folder: "Folder",
  bindery: "Bindery machine",
  other: "Other",
};

export const EQUIPMENT_KIND_HINTS: Record<EquipmentKind, string> = {
  digital: "Toner or inkjet sheet press (Konica, Xerox, Canon, HP Indigo…). Charged per click.",
  offset: "Plate press (Heidelberg, Ryobi, AB Dick…). Charged for plates, make-ready and press time.",
  wide_format: "Roll printers for banners and signs. Signs are priced in Pricing Rules; this is for machine time.",
  cutter: "Guillotine or card cutter.",
  folder: "Paper folder.",
  bindery: "Stitcher, drill, padding press, laminator, coil binder…",
  other: "Anything else with an hourly rate.",
};

export const OPERATION_CATEGORY_LABELS: Record<OperationCategory, string> = {
  prepress: "Pre-press",
  bindery: "Bindery",
  finishing: "Finishing",
  packaging: "Packaging",
  shipping: "Shipping",
  other: "Other",
};

export const OPERATION_BASIS_LABELS: Record<OperationBasis, string> = {
  per_job: "Per job",
  per_piece: "Per piece",
  per_1000: "Per 1,000 pieces",
  per_sheet: "Per press sheet",
  per_hour: "By the hour",
};

export const OPERATION_BASIS_HINTS: Record<OperationBasis, string> = {
  per_job: "One flat charge, whatever the quantity (file prep, a proof).",
  per_piece: "Each finished piece (stitching a booklet, inserting). Fractions of a cent are OK, e.g. 3.5¢.",
  per_1000: "Each 1,000 finished pieces (cutting, folding, drilling). 2,500 pieces = 2.5 × the rate.",
  per_sheet: "Each press sheet that runs (laminating, coating). Fractions of a cent are OK.",
  per_hour: "Worked out from how many pieces an hour you do, times the hourly rate.",
};

/** What the rate box is "per", for labels: "per 1,000". */
export const RATE_UNIT: Record<OperationBasis, string> = {
  per_job: "per job",
  per_piece: "per piece",
  per_1000: "per 1,000",
  per_sheet: "per sheet",
  per_hour: "per hour",
};

export const isPress = (k: string): k is "digital" | "offset" => k === "digital" || k === "offset";

// ---------------------------------------------------------------------------
// Worked examples
// ---------------------------------------------------------------------------
/** Paper: what one sheet costs us and what we charge for it. */
export function sheetPrices(costPerMCents: number, markupPct: number | null | undefined, defaultMarkupPct = 0.3) {
  const cost = costPerMCents / 1000;
  const markup = markupPct ?? defaultMarkupPct;
  return { costPerSheetCents: cost, pricePerSheetCents: cost * (1 + markup), markupPct: markup };
}

/** Sample quantity used in the example line for each basis. */
export const EXAMPLE_QTY = 2500;
export const EXAMPLE_SHEETS = 500;

/** "2,500 pieces → $47.50" — what the service charges on a typical job. */
export function operationExample(op: Omit<PrintOperation, "id" | "name">): string {
  const full: PrintOperation = { id: 0, name: "", ...op };
  const c = operationCharge(full, EXAMPLE_QTY, EXAMPLE_SHEETS);
  const min = op.minimumCents && c.priceCents === op.minimumCents ? " (minimum)" : "";
  switch (op.basis) {
    case "per_job":
      return `Any job → ${fmtMoney(c.priceCents)}`;
    case "per_sheet":
      return `${EXAMPLE_SHEETS.toLocaleString("en-US")} press sheets → ${fmtMoney(c.priceCents)}${min}`;
    case "per_hour": {
      const hrs = op.piecesPerHour ? EXAMPLE_QTY / op.piecesPerHour : 0;
      if (!op.piecesPerHour) return "Enter pieces per hour to work out the time.";
      return `${EXAMPLE_QTY.toLocaleString("en-US")} pieces (${Math.round(hrs * 100) / 100} hr) → ${fmtMoney(c.priceCents)}${min}`;
    }
    default:
      return `${EXAMPLE_QTY.toLocaleString("en-US")} pieces → ${fmtMoney(c.priceCents)}${min}`;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
/** Reads one trimmed form value; null when blank. */
export type Getter = (key: string) => string | null;
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Build a Getter from FormData or a plain object. */
export function getter(src: FormData | Record<string, string | null | undefined>): Getter {
  return (k) => {
    const v = src instanceof FormData ? src.get(k) : src[k];
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
  };
}

class Invalid extends Error {}
const fail = (msg: string): never => {
  throw new Invalid(msg);
};
function run<T>(fn: () => T): Checked<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

const MAX_CENTS = 100_000_000;

function money(get: Getter, key: string, label: string, opts: { required?: boolean } = {}): number | null {
  const v = parseMoneyCents(get(key));
  if (v == null) return opts.required ? fail(`Enter the ${label.toLowerCase()}.`) : null;
  if (Number.isNaN(v)) return fail(`${label} must be a dollar amount, like 12.50.`);
  if (v < 0) return fail(`${label} can't be negative.`);
  if (v > MAX_CENTS) return fail(`${label} looks too large.`);
  return v;
}

function rate(get: Getter, key: string, label: string, maxCents: number, hint: string): number | null {
  const v = parseRateCents(get(key));
  if (v == null) return null;
  if (Number.isNaN(v)) return fail(`${label} must be a price, like $0.045 or 4.5¢.`);
  if (v < 0) return fail(`${label} can't be negative.`);
  if (v > maxCents) return fail(`${label} of ${fmtMoney(Math.round(v))} looks too high. ${hint}`);
  return v;
}

function pct(get: Getter, key: string, label: string, maxPct: number): number | null {
  const v = parsePct(get(key));
  if (v == null) return null;
  if (Number.isNaN(v)) return fail(`${label} must be a percentage, like 30.`);
  if (v < 0) return fail(`${label} can't be negative.`);
  if (v > maxPct) return fail(`${label} can't be more than ${Math.round(maxPct * 100)}%.`);
  return v;
}

function count(get: Getter, key: string, label: string, max: number): number | null {
  const v = parseCount(get(key));
  if (v == null) return null;
  if (Number.isNaN(v)) return fail(`${label} must be a whole number.`);
  if (v < 0) return fail(`${label} can't be negative.`);
  if (v > max) return fail(`${label} looks too large.`);
  return v;
}

function size(get: Getter, key: string, label: string, opts: { required?: boolean; max?: number } = {}) {
  const raw = get(key);
  if (raw == null) return opts.required ? fail(`Enter the ${label.toLowerCase()}, like 12 x 18.`) : null;
  const s = parseSize(raw);
  if (!s) return fail(`${label} should be width x height in inches, like 12 x 18.`);
  const max = opts.max ?? 120;
  if (s.widthIn > max || s.heightIn > max) return fail(`${label} can't be more than ${max}" on a side.`);
  return s;
}

function text(get: Getter, key: string, label: string, max: number, opts: { required?: boolean } = {}) {
  const v = get(key);
  if (v == null) return opts.required ? fail(`Enter the ${label.toLowerCase()}.`) : null;
  if (v.length > max) return fail(`${label} is too long (${max} characters at most).`);
  return v;
}

function id(get: Getter, key: string): number | null {
  const v = get(key);
  if (v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fail("Please pick from the list.");
}

// ---- Paper ------------------------------------------------------------------
export type PaperValues = {
  name: string;
  weight: string | null;
  sheetWidthIn: number;
  sheetHeightIn: number;
  costPerMCents: number;
  /** Null = the category's default paper markup. */
  markupPct: number | null;
  vendorId: number | null;
  sku: string | null;
};

/** Fields: name, weight, sheetSize ("12 x 18"), costPerM ($ per 1,000 sheets), markupPct, vendorId, sku. */
export function validatePaper(get: Getter): Checked<PaperValues> {
  return run(() => {
    const name = text(get, "name", "Name", 120, { required: true })!;
    const sheet = size(get, "sheetSize", "Sheet size", { required: true, max: 60 })!;
    const costPerMCents = money(get, "costPerM", "Cost per 1,000 sheets", { required: true })!;
    return {
      name,
      weight: text(get, "weight", "Weight", 60),
      sheetWidthIn: sheet.widthIn,
      sheetHeightIn: sheet.heightIn,
      costPerMCents,
      markupPct: pct(get, "markupPct", "Markup", 10),
      vendorId: id(get, "vendorId"),
      sku: text(get, "sku", "SKU", 60),
    };
  });
}

// ---- Equipment --------------------------------------------------------------
export type EquipmentValues = {
  name: string;
  kind: EquipmentKind;
  locationId: number | null;
  maxSheetWidthIn: number | null;
  maxSheetHeightIn: number | null;
  minSheetWidthIn: number | null;
  minSheetHeightIn: number | null;
  gripperIn: number;
  maxColors: number;
  perfecting: boolean;
  colorClickPriceCents: number | null;
  colorClickCostCents: number | null;
  bwClickPriceCents: number | null;
  bwClickCostCents: number | null;
  platePriceCents: number | null;
  plateCostCents: number | null;
  inkCostPerMCents: number | null;
  setupMinutes: number;
  sheetsPerHour: number | null;
  hourlyPriceCents: number | null;
  hourlyCostCents: number | null;
  setupSpoilageSheets: number;
  runSpoilagePct: number;
  notes: string | null;
};

const KINDS = Object.keys(EQUIPMENT_KIND_LABELS) as EquipmentKind[];
const CLICK_HINT = "Click charges are usually a few cents — type 4.5¢ or $0.045.";

/**
 * Fields: name, kind, locationId, maxSheet, minSheet ("13 x 19"), gripperIn, maxColors, perfecting ("on"),
 * colorClickPrice, colorClickCost, bwClickPrice, bwClickCost, platePrice, plateCost, inkCostPerM,
 * setupMinutes, sheetsPerHour, hourlyPrice, hourlyCost, setupSpoilageSheets, runSpoilagePct, notes.
 * Fields that don't apply to the kind are cleared, so a cutter never carries click charges.
 */
export function validateEquipment(get: Getter): Checked<EquipmentValues> {
  return run(() => {
    const name = text(get, "name", "Name", 120, { required: true })!;
    const kind = get("kind") as EquipmentKind | null;
    if (!kind || !KINDS.includes(kind)) fail("Choose what kind of machine this is.");
    const k = kind!;
    const press = isPress(k);
    const base: EquipmentValues = {
      name,
      kind: k,
      locationId: id(get, "locationId"),
      maxSheetWidthIn: null,
      maxSheetHeightIn: null,
      minSheetWidthIn: null,
      minSheetHeightIn: null,
      gripperIn: 0.25,
      maxColors: 4,
      perfecting: false,
      colorClickPriceCents: null,
      colorClickCostCents: null,
      bwClickPriceCents: null,
      bwClickCostCents: null,
      platePriceCents: null,
      plateCostCents: null,
      inkCostPerMCents: null,
      setupMinutes: 0,
      sheetsPerHour: null,
      hourlyPriceCents: money(get, "hourlyPrice", "Hourly rate we charge"),
      hourlyCostCents: money(get, "hourlyCost", "Hourly cost to us"),
      setupSpoilageSheets: 0,
      runSpoilagePct: 0,
      notes: text(get, "notes", "Notes", 2000),
    };
    if (!press) return base;

    const max = size(get, "maxSheet", "Largest sheet", { required: true, max: 60 })!;
    const min = size(get, "minSheet", "Smallest sheet", { max: 60 });
    if (min && (min.widthIn > max.widthIn + 1e-6 || min.heightIn > max.heightIn + 1e-6) && (min.heightIn > max.widthIn + 1e-6 || min.widthIn > max.heightIn + 1e-6))
      fail("The smallest sheet is bigger than the largest sheet.");
    const gripperRaw = get("gripperIn");
    const gripper = gripperRaw == null ? null : parseInches(gripperRaw);
    if (gripperRaw != null && (gripper == null || gripper > 2)) fail('Unprintable edge must be a small number of inches, like 0.25 or 1/4.');
    const v: EquipmentValues = {
      ...base,
      maxSheetWidthIn: max.widthIn,
      maxSheetHeightIn: max.heightIn,
      minSheetWidthIn: min?.widthIn ?? null,
      minSheetHeightIn: min?.heightIn ?? null,
      gripperIn: gripper ?? 0.25,
      setupMinutes: count(get, "setupMinutes", k === "offset" ? "Make-ready minutes per plate" : "Setup minutes", 600) ?? 0,
      sheetsPerHour: count(get, "sheetsPerHour", "Sheets per hour", 100_000),
      setupSpoilageSheets: count(get, "setupSpoilageSheets", "Setup spoilage", 10_000) ?? 0,
      runSpoilagePct: pct(get, "runSpoilagePct", "Running spoilage", 0.5) ?? 0,
    };
    if (v.sheetsPerHour === 0) v.sheetsPerHour = null;
    if (k === "digital") {
      v.colorClickPriceCents = rate(get, "colorClickPrice", "Color click charge", 500, CLICK_HINT);
      v.colorClickCostCents = rate(get, "colorClickCost", "Color click cost", 500, CLICK_HINT);
      v.bwClickPriceCents = rate(get, "bwClickPrice", "Black & white click charge", 500, CLICK_HINT);
      v.bwClickCostCents = rate(get, "bwClickCost", "Black & white click cost", 500, CLICK_HINT);
      if (v.colorClickPriceCents == null && v.bwClickPriceCents == null) fail("Enter a click charge (color, black & white, or both).");
      v.maxColors = 4;
    } else {
      const colors = count(get, "maxColors", "Colors per pass", 12);
      if (colors == null || colors < 1) fail("Enter how many colors the press prints in one pass (1, 2, 4…).");
      v.maxColors = colors!;
      v.perfecting = get("perfecting") === "on" || get("perfecting") === "true";
      v.platePriceCents = money(get, "platePrice", "Plate charge");
      v.plateCostCents = money(get, "plateCost", "Plate cost");
      v.inkCostPerMCents = money(get, "inkCostPerM", "Ink cost per 1,000");
      if (!v.sheetsPerHour) fail("Enter how many sheets an hour the press runs.");
      if (v.hourlyPriceCents == null) fail("Enter the hourly rate we charge for press time.");
    }
    return v;
  });
}

// ---- Operations -------------------------------------------------------------
export type OperationValues = {
  name: string;
  category: OperationCategory;
  basis: OperationBasis;
  setupPriceCents: number;
  setupCostCents: number;
  ratePriceCents: number;
  rateCostCents: number;
  piecesPerHour: number | null;
  minimumCents: number;
  equipmentId: number | null;
};

const CATEGORIES = Object.keys(OPERATION_CATEGORY_LABELS) as OperationCategory[];
const BASES = Object.keys(OPERATION_BASIS_LABELS) as OperationBasis[];

/** Fields: name, category, basis, setupPrice, setupCost, ratePrice, rateCost, piecesPerHour, minimum, equipmentId. */
export function validateOperation(get: Getter): Checked<OperationValues> {
  return run(() => {
    const name = text(get, "name", "Name", 120, { required: true })!;
    const category = (get("category") ?? "bindery") as OperationCategory;
    if (!CATEGORIES.includes(category)) fail("Choose a category.");
    const basis = get("basis") as OperationBasis | null;
    if (!basis || !BASES.includes(basis)) fail("Choose how it's charged.");
    const b = basis!;
    const subCent = b === "per_piece" || b === "per_sheet";
    const rateOf = (key: string, label: string) =>
      subCent ? rate(get, key, label, 100_000, "") : money(get, key, label);
    const v: OperationValues = {
      name,
      category,
      basis: b,
      setupPriceCents: money(get, "setupPrice", "Setup charge") ?? 0,
      setupCostCents: money(get, "setupCost", "Setup cost") ?? 0,
      ratePriceCents: b === "per_job" ? 0 : (rateOf("ratePrice", `Charge ${RATE_UNIT[b]}`) ?? 0),
      rateCostCents: b === "per_job" ? 0 : (rateOf("rateCost", `Cost ${RATE_UNIT[b]}`) ?? 0),
      piecesPerHour: b === "per_hour" ? count(get, "piecesPerHour", "Pieces per hour", 1_000_000) : null,
      minimumCents: money(get, "minimum", "Minimum charge") ?? 0,
      equipmentId: id(get, "equipmentId"),
    };
    if (b === "per_hour" && !v.piecesPerHour) fail("Enter how many pieces an hour, so we can work out the time.");
    if (b === "per_job" && !v.setupPriceCents) fail("Enter the charge per job.");
    if (b !== "per_job" && !v.ratePriceCents && !v.setupPriceCents) fail(`Enter the charge ${RATE_UNIT[b]}.`);
    return v;
  });
}
