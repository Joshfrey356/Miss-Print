/**
 * Inventory & purchasing: the arithmetic. Stock levels and status, what a job's items need from
 * stock, receiving against purchase orders, suggested reorder quantities and job costing.
 *
 * Pure: safe on the client and the server (and in unit tests). No database, no "server-only".
 */
import type { JobStatus } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Quantities & units
// ---------------------------------------------------------------------------

/** Quantities are numeric(12,2): keep two decimals and never show float noise (0.1 + 0.2). */
export const roundQty = (n: number) => Math.round(n * 100) / 100;

/** 2500 → "2,500"; 12.5 → "12.5"; -40 → "−40" */
export function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Math.abs(roundQty(n)).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n < 0 && roundQty(n) !== 0 ? `−${s}` : s;
}

/** Signed change for a ledger: "+500", "−265". */
export function fmtDelta(n: number): string {
  const r = roundQty(n);
  return r > 0 ? `+${fmtQty(r)}` : fmtQty(r);
}

const UNIT_NAMES: Record<string, [string, string]> = {
  sheet: ["sheet", "sheets"],
  sqft: ["sq ft", "sq ft"],
  each: ["each", "each"],
  roll: ["roll", "rolls"],
  ream: ["ream", "reams"],
  box: ["box", "boxes"],
  case: ["case", "cases"],
  gal: ["gal", "gal"],
  ft: ["ft", "ft"],
};

/** "sheets", "sq ft", "rolls" — for a quantity of `n` (plural unless exactly 1). */
export function unitLabel(unit: string | null | undefined, n = 2): string {
  const u = (unit ?? "").trim().toLowerCase();
  const names = UNIT_NAMES[u];
  if (!names) return u || "units";
  return roundQty(n) === 1 ? names[0] : names[1];
}

/** "2,500 sheets", "1,200 sq ft", "40 each" */
export const qtyWithUnit = (n: number | null | undefined, unit: string | null | undefined) => (n == null ? "—" : `${fmtQty(n)} ${unitLabel(unit, n)}`);

/**
 * Parse a quantity typed by a person: "2,500", "12.5", " 40 ". Null when blank or not a number.
 * Rounded to 2 decimals (the column's precision).
 */
export function parseQty(input: string | null | undefined): number | null {
  const s = (input ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? roundQty(n) : null;
}

// ---------------------------------------------------------------------------
// Stock levels & status
// ---------------------------------------------------------------------------

export type StockLevel = {
  onHand: number;
  /** Set aside for open jobs (reservations with status "reserved"). */
  reserved: number;
  /** Still to arrive on ordered / partly received purchase orders. */
  onOrder: number;
  reorderLevel: number | null;
};

export type StockStatus = "ok" | "low" | "out" | "short";

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  ok: "OK",
  low: "Low",
  out: "Out",
  short: "Short for jobs",
};

/** What's free to use: on hand minus what jobs have set aside. Can be negative (jobs need more than we have). */
export const availableOf = (l: Pick<StockLevel, "onHand" | "reserved">) => roundQty(l.onHand - l.reserved);

/** What we'll have once open orders arrive and reserved jobs are done. */
export const projectedOf = (l: Pick<StockLevel, "onHand" | "reserved" | "onOrder">) => roundQty(l.onHand - l.reserved + l.onOrder);

/**
 * One word for the stock list:
 * - short: open jobs need more than is on the shelf,
 * - out:   nothing on the shelf,
 * - low:   available is at or under the reorder level,
 * - ok.
 */
export function stockStatus(l: StockLevel): StockStatus {
  if (l.reserved > 0 && l.reserved > l.onHand) return "short";
  if (l.onHand <= 0) return "out";
  if (l.reorderLevel != null && availableOf(l) <= l.reorderLevel) return "low";
  return "ok";
}

/** Shortfall for jobs that isn't covered by what's on hand or on order (0 when covered). */
export const uncoveredOf = (l: Pick<StockLevel, "onHand" | "reserved" | "onOrder">) => Math.max(0, roundQty(l.reserved - l.onHand - l.onOrder));

/**
 * A change big enough to double-check before saving (a typo like 25000 for 2500).
 * Big = more than 5× the larger of what's on hand, the reorder level/quantity, or 100 units.
 */
export function isBigChange(delta: number, ref: { onHand: number; reorderLevel?: number | null; reorderQuantity?: number | null }): boolean {
  const scale = Math.max(Math.abs(ref.onHand), ref.reorderLevel ?? 0, ref.reorderQuantity ?? 0, 100);
  return Math.abs(delta) > 5 * scale;
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

/** Our cost for one unit, in cents (sub-cent allowed). Paper: cost per 1,000 sheets ÷ 1,000. */
export function unitCostOf(m: { unit: string; costCents: number; costPerMCents?: number | null }): number {
  if (m.unit === "sheet" && m.costPerMCents != null) return m.costPerMCents / 1000;
  return m.costCents;
}

/** Line total in whole cents. */
export const lineAmount = (quantity: number, unitCostCents: number) => Math.round(quantity * unitCostCents);

/** 8 → "8¢", 0.45 → "0.45¢", 12.5 → "12.5¢", 380 → "$3.80", 123.456 → "$1.2346" */
export function fmtUnitCost(cents: number): string {
  if (cents < 100) return `${Number(cents.toFixed(cents < 1 ? 3 : 2))}¢`;
  const d = cents / 100;
  return `$${d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** "$0.08" / "0.08" / "80" → cents with up to 4 decimals (8, 8, 8000). Null when blank or invalid. */
export function parseUnitCost(input: string | null | undefined): number | null {
  const s = (input ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const d = Number(s);
  if (!Number.isFinite(d) || d < 0) return null;
  return Math.round(d * 100 * 10000) / 10000;
}

/** cents (4dp) → dollars text for an input: 8 → "0.08", 12.5 → "0.125", 3800 → "38.00" */
export function unitCostToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const d = cents / 100;
  const s = d.toFixed(6).replace(/0+$/, "");
  const [whole, frac = ""] = s.split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

// ---------------------------------------------------------------------------
// What a job's items need from stock
// ---------------------------------------------------------------------------

export type NeedItem = {
  id: number;
  quantity: number;
  widthIn: number | null;
  heightIn: number | null;
  materialId: number | null;
  /** job_items.pricingBreakdown — print-estimated lines keep `production.paperId` + `parentSheets`. */
  pricingBreakdown: unknown;
};
export type TrackedMaterial = { id: number; unit: string };
export type Need = { materialId: number; jobItemId: number; quantity: number };

function printRun(pb: unknown): { paperId: number; parentSheets: number } | null {
  const p = (pb as { production?: { paperId?: unknown; parentSheets?: unknown } | null } | null)?.production;
  if (!p) return null;
  const paperId = Number(p.paperId);
  const sheets = Number(p.parentSheets);
  return Number.isInteger(paperId) && paperId > 0 && Number.isFinite(sheets) && sheets > 0 ? { paperId, parentSheets: sheets } : null;
}

/**
 * Stock each job line will use, for tracked materials only:
 * - printed lines estimated on a press use their parent sheets of the chosen paper;
 * - lines on a tracked material use their size × quantity (sq ft materials) or their quantity (sheets, each).
 * Other units (rolls, reams…) can't be worked out from a line, so they aren't reserved automatically.
 */
export function reservationNeeds(items: NeedItem[], tracked: Map<number, TrackedMaterial>): Need[] {
  const out: Need[] = [];
  for (const i of items) {
    const run = printRun(i.pricingBreakdown);
    if (run) {
      // The paper is the line's material too (materialId = paper), so it's counted once, here.
      if (tracked.has(run.paperId)) out.push({ materialId: run.paperId, jobItemId: i.id, quantity: Math.ceil(run.parentSheets) });
      continue;
    }
    if (!i.materialId) continue;
    const m = tracked.get(i.materialId);
    if (!m || i.quantity <= 0) continue;
    let q = 0;
    if (m.unit === "sqft") q = i.widthIn && i.heightIn ? ((i.widthIn * i.heightIn) / 144) * i.quantity : 0;
    else if (m.unit === "sheet" || m.unit === "each") q = i.quantity;
    q = roundQty(q);
    if (q > 0) out.push({ materialId: m.id, jobItemId: i.id, quantity: q });
  }
  return out;
}

/**
 * Reserved rows a job should have: its needs minus what's already been used on it (per material,
 * taken from the first lines first). Used stock is never reserved again.
 */
export function planReservations(needs: Need[], usedByMaterial: Map<number, number>): Need[] {
  const pool = new Map(usedByMaterial);
  const out: Need[] = [];
  for (const n of needs) {
    const used = pool.get(n.materialId) ?? 0;
    const take = Math.min(used, n.quantity);
    pool.set(n.materialId, roundQty(used - take));
    const rest = roundQty(n.quantity - take);
    if (rest > 0) out.push({ ...n, quantity: rest });
  }
  return out;
}

/** Same rows (ignoring order)? Lets a re-sync skip writing when nothing changed. */
export function sameReservations(a: { materialId: number; jobItemId: number | null; quantity: number }[], b: { materialId: number; jobItemId: number | null; quantity: number }[]) {
  if (a.length !== b.length) return false;
  const key = (r: { materialId: number; jobItemId: number | null; quantity: number }) => `${r.materialId}:${r.jobItemId ?? "-"}:${roundQty(r.quantity)}`;
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.every((k, i) => k === kb[i]);
}

/** Job statuses where the work has been printed/made: reserved stock is taken off the shelf (once). */
export const USE_STATUSES: JobStatus[] = ["finishing", "quality_check", "ready_pickup", "scheduled_delivery", "scheduled_install", "completed"];
/** Job statuses that give reserved stock back. */
export const RELEASE_STATUSES: JobStatus[] = ["cancelled"];

export type ReservationAction = "reserve" | "use" | "release";

/** What a job's status means for its stock. Archived jobs give everything back. */
export function reservationActionFor(status: JobStatus, archived: boolean): ReservationAction {
  if (archived || RELEASE_STATUSES.includes(status)) return "release";
  if (USE_STATUSES.includes(status)) return "use";
  return "reserve";
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export type PoStatus = "draft" | "ordered" | "partial" | "received" | "cancelled";

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  partial: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
};

/** Still to come on a line (never negative). */
export const remainingOf = (l: { quantity: number; receivedQuantity: number }) => Math.max(0, roundQty(l.quantity - l.receivedQuantity));

/** An ordered PO after receiving: everything in → received; anything in → partial; else ordered. */
export function poStatusAfterReceive(lines: { quantity: number; receivedQuantity: number }[]): "ordered" | "partial" | "received" {
  if (lines.length && lines.every((l) => l.receivedQuantity >= l.quantity)) return "received";
  if (lines.some((l) => l.receivedQuantity > 0)) return "partial";
  return "ordered";
}

export type PoLineInput = { quantity: number; unitCostCents: number };
export function poTotals(lines: PoLineInput[], shippingCents: number, taxCents: number) {
  const subtotalCents = lines.reduce((a, l) => a + lineAmount(l.quantity, l.unitCostCents), 0);
  return { subtotalCents, shippingCents, taxCents, totalCents: subtotalCents + shippingCents + taxCents };
}

/** An ordered/partly received PO past its expected date. */
export const isPoOverdue = (po: { status: string; expectedOn: string | null }, today: string) =>
  (po.status === "ordered" || po.status === "partial") && !!po.expectedOn && po.expectedOn < today;

// ---------------------------------------------------------------------------
// Reorder suggestions
// ---------------------------------------------------------------------------

export type ReorderInput = StockLevel & { unit: string; reorderQuantity: number | null };

/** Paper is bought in reams of 500: round sheet orders up to whole reams. */
export const packRound = (qty: number, unit: string) => (unit === "sheet" ? Math.ceil(qty / 500) * 500 : Math.ceil(qty));

/**
 * How much to order, or 0 when nothing's needed. Triggered when what we'll have (on hand − reserved +
 * on order) is at or under the reorder level, or when jobs need more than we'll have. Orders the
 * usual reorder quantity, or more when that isn't enough to get back above the reorder level.
 */
export function suggestedOrderQty(m: ReorderInput): number {
  const projected = projectedOf(m);
  const low = m.reorderLevel != null && projected <= m.reorderLevel;
  const short = projected < 0;
  if (!low && !short) return 0;
  // The usual order; without one set, a reorder level's worth.
  const usual = m.reorderQuantity ?? (m.reorderLevel != null && m.reorderLevel > 0 ? m.reorderLevel : 0);
  // Enough to cover the jobs and get back up to the reorder level.
  const cover = roundQty((m.reorderLevel ?? 0) - projected);
  const need = Math.max(usual, cover);
  return need > 0 ? packRound(need, m.unit) : 0;
}

// ---------------------------------------------------------------------------
// Job costing
// ---------------------------------------------------------------------------

export type CostPoLine = { materialId: number | null; quantity: number; amountCents: number };
export type CostUse = { materialId: number; quantity: number; unitCostCents: number };

/**
 * Material & outside-purchase cost for one job:
 * - purchase-order lines charged to the job count at their PO amount (stock lines → materials,
 *   free-text lines → outside services);
 * - stock used on the job counts at the material's cost, except the part covered by stock bought on
 *   the job's own PO lines (so paper bought for a job and then used on it isn't counted twice);
 * - `extrasCents` (shipping & tax of POs that are wholly for the job) → outside.
 */
export function jobPurchaseCosts(poLines: CostPoLine[], uses: CostUse[], extrasCents = 0) {
  let purchasedMaterialCents = 0;
  let outsideCents = extrasCents;
  const bought = new Map<number, number>();
  for (const l of poLines) {
    if (l.materialId == null) outsideCents += l.amountCents;
    else {
      purchasedMaterialCents += l.amountCents;
      bought.set(l.materialId, (bought.get(l.materialId) ?? 0) + l.quantity);
    }
  }
  let stockCents = 0;
  for (const u of uses) {
    const covered = bought.get(u.materialId) ?? 0;
    const take = Math.min(covered, u.quantity);
    bought.set(u.materialId, covered - take);
    stockCents += (u.quantity - take) * u.unitCostCents;
  }
  stockCents = Math.round(stockCents);
  return { stockCents, purchasedMaterialCents, outsideCents, materialCents: stockCents + purchasedMaterialCents, totalCents: stockCents + purchasedMaterialCents + outsideCents };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type InventoryAlerts = { low: number; out: number; short: number; overduePos: number };

/** Lines for the dashboard's "Needs attention" list (same shape it uses). Zero counts are left out. */
export function inventoryAttention(a: InventoryAlerts): { n: number; text: string; href: string; tone: "red" | "amber" }[] {
  const p = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    { n: a.short, text: `${p(a.short, "stock item is", "stock items are")} short for upcoming jobs`, href: "/inventory?filter=low", tone: "red" as const },
    { n: a.out, text: `${p(a.out, "stock item is", "stock items are")} out`, href: "/inventory?filter=low", tone: "red" as const },
    { n: a.low, text: `${p(a.low, "stock item is", "stock items are")} running low`, href: "/inventory/reorder", tone: "amber" as const },
    { n: a.overduePos, text: `${p(a.overduePos, "purchase order is", "purchase orders are")} late`, href: "/inventory/purchase-orders?status=late", tone: "amber" as const },
  ].filter((x) => x.n > 0);
}
